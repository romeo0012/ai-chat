const path = require('path')
const fs = require('fs')

const dataDir = path.join(__dirname, '..', 'data')
const cacheDir = path.join(dataDir, 'docs_cache')

const pageImagesMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'page-images.json'), 'utf-8'))

const LANG_NAMES = { de: 'German', cz: 'Czech' }

function injectImages(bodyHtml, pageUrl) {
  const images = pageImagesMap[pageUrl]
  if (!images || images.length === 0) return bodyHtml

  const parts = bodyHtml.split(/(<p>.*?<\/p>)/gs)
  if (parts.length < 3) return bodyHtml

  let imgIdx = 0
  let paraCount = 0
  const result = []
  for (const part of parts) {
    result.push(part)
    if (part.startsWith('<p>') || part.startsWith('<h')) paraCount++
    if (paraCount > 0 && paraCount % 3 === 0 && imgIdx < images.length) {
      const parts2 = images[imgIdx].split('/')
      const subdir = parts2[parts2.length - 2]
      const filename = parts2[parts2.length - 1]
      const localPath = `/images/docs/${subdir}/${filename}`
      const alt = filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')
      result.push(`<div class="doc-image"><img src="${localPath}" alt="${alt}" loading="lazy"></div>`)
      imgIdx++
    }
  }
  while (imgIdx < images.length) {
    const parts2 = images[imgIdx].split('/')
    const subdir = parts2[parts2.length - 2]
    const filename = parts2[parts2.length - 1]
    const localPath = `/images/docs/${subdir}/${filename}`
    const alt = filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')
    result.push(`<div class="doc-image"><img src="${localPath}" alt="${alt}" loading="lazy"></div>`)
    imgIdx++
  }
  return result.join('')
}

async function main() {
  for (const lang of ['de', 'cz']) {
    const langDir = path.join(cacheDir, lang)
    if (!fs.existsSync(langDir)) {
      console.log(`${lang}: no cache directory`)
      continue
    }
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.html'))
    console.log(`${lang}: ${files.length} cached files`)

    let updated = 0
    for (const file of files) {
      const filePath = path.join(langDir, file)
      const html = fs.readFileSync(filePath, 'utf-8')

      // Extract page URL from the cache filename (reverse the safeName logic)
      const safeName = file.replace(/\.html$/, '').replace(/_[a-f0-9]{8}$/, '')
      // The safeName is derived from docPath which is the URL path
      // We need to reconstruct: each page has a URL like /some-page/
      // Try to match against page-images-map keys
      let pageUrl = null
      for (const url of Object.keys(pageImagesMap)) {
        const urlPath = url.replace('https://www.virtuozzo.com/application-management-docs/', '').replace(/\/$/, '')
        const expectedSafe = urlPath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
        if (expectedSafe === safeName) {
          pageUrl = url
          break
        }
      }

      if (!pageUrl) continue

      const images = pageImagesMap[pageUrl]
      if (!images || images.length === 0) continue

      // Extract body from <main>...</main>
      const mainMatch = html.match(/<main>([\s\S]*)<\/main>/)
      if (!mainMatch) continue

      const bodyHtml = mainMatch[1]
      const newBody = injectImages(bodyHtml, pageUrl)
      if (newBody === bodyHtml) continue

      const newHtml = html.replace(/<main>([\s\S]*)<\/main>/, `<main>${newBody}</main>`)
      fs.writeFileSync(filePath, newHtml, 'utf-8')
      updated++
    }
    console.log(`  Updated: ${updated} files with images`)
  }
  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
