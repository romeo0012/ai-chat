const Scraper = require('../lib/scraper')
const RAGEngine = require('../lib/rag')
const fs = require('fs')
const path = require('path')

const SERVER_DOCS_URL = 'https://www.virtuozzo.com/server-docs/9.0/'
const dataDir = path.join(__dirname, '..', 'data')
const indexFile = path.join(dataDir, 'index.json')
const saveFile = path.join(dataDir, 'product-docs', 'vz-server.json')

async function main() {
  if (!fs.existsSync(path.dirname(saveFile))) {
    fs.mkdirSync(path.dirname(saveFile), { recursive: true })
  }

  const maxPages = parseInt(process.env.SCRAPE_PAGES || '500')
  const maxDepth = parseInt(process.env.SCRAPE_DEPTH || '4')

  console.log(`Crawling: ${SERVER_DOCS_URL}`)
  console.log(`Max pages: ${maxPages}, max depth: ${maxDepth}`)

  const scraper = new Scraper(SERVER_DOCS_URL)
  const chunks = await scraper.scrape(SERVER_DOCS_URL, { maxDepth, maxPages })
  scraper.saveToFile(chunks, saveFile)

  console.log(`\nMerging ${chunks.length} chunks into ${indexFile}`)
  let mainIndex = { chunks: [] }
  if (fs.existsSync(indexFile)) {
    const existing = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
    mainIndex.chunks = existing.chunks || existing
  }

  const existingUrls = new Set(mainIndex.chunks.map(c => c.url.replace(/\/$/, '')))
  const existingKeys = new Set(mainIndex.chunks.map(c => `${c.url}||${c.content.slice(0, 80)}`))
  let added = 0
  for (const chunk of chunks) {
    const u = (chunk.url || '').replace(/\/$/, '')
    const key = `${u}||${(chunk.content || '').slice(0, 80)}`
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    mainIndex.chunks.push(chunk)
    added++
  }

  fs.writeFileSync(indexFile, JSON.stringify({ chunks: mainIndex.chunks }, null, 2), 'utf-8')
  console.log(`Merged: +${added} new chunks, total: ${mainIndex.chunks.length}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})