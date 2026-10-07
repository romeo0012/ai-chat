// Crawl the full Virtuozzo Application Management documentation from its
// sitemap (555 URLs) and merge every page into the RAG index. The earlier
// BFS crawl (scrape.js, HELP_URL) only reached 135 pages; this script uses
// the sitemap directly so no page is missed.
const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')
const dataDir = path.join(__dirname, '..', 'data')
const indexPath = path.join(dataDir, 'index.json')
const SITEMAP = 'https://www.virtuozzo.com/application-management-docs/sitemap.xml'
const SNAPSHOT = path.join(dataDir, 'product-docs', 'paas.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const CONCURRENCY = 8

function chunkText(text, title, url, maxChunkSize = 1500, overlap = 200) {
  if (text.length <= maxChunkSize) return [{ title, url, content: text }]
  const chunks = []
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text]
  let current = ''
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChunkSize && current.length > 0) {
      chunks.push({ title, url, content: current.trim() })
      const words = current.split(/\s+/)
      const overlapWords = words.slice(-30).join(' ')
      current = overlapWords.length < overlap ? overlapWords + sentence : words.slice(-20).join(' ') + sentence
    } else {
      current += sentence
    }
  }
  if (current.trim().length > 0) chunks.push({ title, url, content: current.trim() })
  return chunks
}

function extractContent($) {
  $('script, style, nav, header, footer, .sidebar, aside, .menu, .toc').remove()
  const main = $('main, article, .content, .documentation, .doc-content, .markdown-body, [role="main"]').first()
  const html = main.length ? main : $('body')
  const title = $('h1').first().text().trim() || $('title').text().trim()
  html.find('br').replaceWith('\n')
  html.find('p, div, h1, h2, h3, h4, h5, h6, li, tr, th, td, pre, blockquote').after(' ')
  const text = html.text().replace(/\s+/g, ' ').trim()
  return { title, text }
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': UA, 'Accept-Language': 'cs,en;q=0.9' },
      maxRedirects: 5,
    })
    return res
  } catch (err) {
    console.error(`  ✗ ${url} -> ${err.message}`)
    return null
  }
}

async function run() {
  const sitemapRes = await axios.get(SITEMAP, { timeout: 20000, headers: { 'User-Agent': UA } })
  const urls = [...new Set([...sitemapRes.data.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1].replace(/\/$/, ''))
    .filter(u => u.includes('application-management-docs') && !/\/search/.test(u)))]

  // Resume support: skip URLs already captured in the last snapshot
  let existing = new Map()
  if (fs.existsSync(SNAPSHOT)) {
    try { existing = new Map(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf-8')).map(c => [c.url.replace(/\/$/, ''), c])) } catch {}
  }
  const todo = urls.filter(u => !existing.has(u))
  console.log(`Sitemap: ${urls.length} URLs; already in snapshot: ${existing.size}; to crawl: ${todo.length}`)

  const allChunks = [...existing.values()]
  let done = 0
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (u) => {
      const res = await fetchPage(u)
      if (!res) return []
      const $ = cheerio.load(res.data)
      const { title, text } = extractContent($)
      if (text.length <= 50) {
        console.error(`  ✗ ${u} -> empty content`)
        return []
      }
      const parsed = new URL(u)
      const page = `${parsed.origin}${parsed.pathname}`
      const chunks = chunkText(text, title, page)
      console.log(`  ✓ ${title} (${u}) -> ${chunks.length} chunks`)
      return chunks
    }))
    for (const chunks of results.flat()) allChunks.push(chunks)
    done += batch.length
    console.log(`Progress: ${done}/${todo.length} (total chunks so far: ${allChunks.length})`)
    // Save snapshot after every batch so an interrupted run can resume
    fs.writeFileSync(SNAPSHOT, JSON.stringify(allChunks, null, 1), 'utf-8')
  }

  // Merge into main index: replace old PaaS chunks with these fresh ones
  const mainIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  const paasHost = 'www.virtuozzo.com/application-management-docs'
  const others = mainIndex.chunks.filter(c => !c.url.includes(paasHost))
  const merged = [...others, ...allChunks]
  fs.writeFileSync(indexPath, JSON.stringify({ chunks: merged }, null, 2), 'utf-8')
  console.log(`\nDONE. PaaS chunks: ${allChunks.length}, total index: ${merged.length}`)
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1) })