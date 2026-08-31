const path = require('path')
const fs = require('fs')
const axios = require('axios')
const cheerio = require('cheerio')

const dataDir = path.join(__dirname, '..', 'data')
const imageDir = path.join(__dirname, '..', 'public', 'images', 'docs')
const mappingFile = path.join(dataDir, 'page-images.json')

async function fetchHtml(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        }
      })
      return res.data
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

function extractImages(html) {
  const $ = cheerio.load(html)
  const selectors = ['main', 'article', '.content', '.documentation', '.doc-content', '[role="main"]']
  let main = null
  for (const sel of selectors) {
    const el = $(sel).first()
    if (el.length) { main = el; break }
  }
  if (!main) main = $('body')

  const urls = new Set()
  main.find('img').each((_, el) => {
    const src = $(el).attr('src')
    if (src) urls.add(src)
  })
  main.find('source').each((_, el) => {
    const srcset = $(el).attr('srcset')
    if (srcset) {
      srcset.split(',').forEach(s => {
        const url = s.trim().split(/\s+/)[0]
        if (url) urls.add(url)
      })
    }
  })

  return [...urls].filter(u => u.startsWith('https://static.virtuozzo.com/application-management-docs/'))
}

function pickBestImage(imageUrls) {
  // Group by base name (before the first underscore after the sequence number)
  const groups = {}
  for (const url of imageUrls) {
    const parts = url.split('/')
    const filename = parts.pop()
    // Base name is everything up to the first _hu or _ (for Hugo-processed images)
    const baseMatch = filename.match(/^((\d+-)?[a-z0-9_-]+?)(?:_hu[0-9a-f]+|_\d|\.\w+)/)
    const baseName = baseMatch ? baseMatch[1] : filename.replace(/\.\w+$/, '')
    if (!groups[baseName]) groups[baseName] = []
    groups[baseName].push(url)
  }

  const picked = []
  for (const [baseName, urls] of Object.entries(groups)) {
    // Prefer .png, then .webp; prefer the full-size variant
    const png = urls.find(u => u.endsWith('.png'))
    const webp = urls.find(u => u.includes('0x0_q75'))
    const anyWebp = urls.find(u => u.endsWith('.webp'))
    picked.push(png || webp || anyWebp || urls[0])
  }
  return picked
}

async function downloadImage(imageUrl, referer, destPath) {
  const dir = path.dirname(destPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(destPath)) return false

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.get(imageUrl, {
        timeout: 30000,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Referer': referer,
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        }
      })
      const writer = fs.createWriteStream(destPath)
      res.data.pipe(writer)
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
      return true
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

async function main() {
  const rag = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf-8'))
  const urls = [...new Set(rag.map(c => c.url))].filter(u => u.startsWith('http'))
  console.log(`Found ${urls.length} valid documentation pages\n`)

  const mapping = {}
  let totalImages = 0
  let totalDownloaded = 0
  let totalSkipped = 0

  for (let i = 0; i < urls.length; i++) {
    const pageUrl = urls[i].replace(/\/$/, '')
    let pageName
    try {
      pageName = new URL(pageUrl).pathname.replace(/\/$/, '').split('/').pop()
    } catch {
      pageName = `page-${i}`
    }
    process.stdout.write(`[${i + 1}/${urls.length}] ${pageName}... `)

    try {
      const html = await fetchHtml(pageUrl)
      const allImgs = extractImages(html)
      const bestImgs = pickBestImage(allImgs)

      mapping[pageUrl] = bestImgs

      let dlCount = 0, skipCount = 0
      for (const imgUrl of bestImgs) {
        const parts = imgUrl.split('/')
        const subdir = parts[parts.length - 2]
        const filename = parts[parts.length - 1]
        const destPath = path.join(imageDir, subdir, filename)
        if (!fs.existsSync(destPath)) {
          await downloadImage(imgUrl, pageUrl + '/', destPath)
          dlCount++
        } else {
          skipCount++
        }
      }
      totalDownloaded += dlCount
      totalSkipped += skipCount
      totalImages += bestImgs.length
      process.stdout.write(`${bestImgs.length} images (new ${dlCount}, cached ${skipCount})\n`)
    } catch (err) {
      process.stdout.write(`ERR: ${err.message.slice(0, 60)}\n`)
      mapping[pageUrl] = []
    }
  }

  fs.writeFileSync(mappingFile, JSON.stringify(mapping, null, 2), 'utf-8')
  console.log(`\n=== Complete ===`)
  console.log(`Pages: ${Object.keys(mapping).length}`)
  console.log(`Total unique images: ${totalImages}`)
  console.log(`Downloaded: ${totalDownloaded}`)
  console.log(`Cached: ${totalSkipped}`)
  console.log(`Mapping: ${mappingFile}`)
  console.log(`Images: ${imageDir}`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
