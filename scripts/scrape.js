require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const Scraper = require('../lib/scraper')
const RAGEngine = require('../lib/rag')
const path = require('path')

const helpUrl = process.env.HELP_URL
if (!helpUrl) {
  console.error('ERROR: Set HELP_URL in .env file')
  console.error('Example: HELP_URL=https://docs.jelastic.com/')
  process.exit(1)
}

const dataDir = path.join(__dirname, '..', 'data')

async function main() {
  const scraper = new Scraper(helpUrl)
  const maxDepth = parseInt(process.env.SCRAPE_DEPTH || '3')
  const maxPages = parseInt(process.env.SCRAPE_PAGES || '200')

  console.log(`Scraping: ${helpUrl}`)
  console.log(`Max depth: ${maxDepth}, max pages: ${maxPages}`)
  console.log('---')

  const chunks = await scraper.scrape(helpUrl, { maxDepth, maxPages })

  const rag = new RAGEngine(dataDir)
  rag.buildIndex(chunks)
  rag.saveIndex(path.join(dataDir, 'index.json'))

  console.log('\nScraping complete!')
  console.log(`Total chunks: ${chunks.length}`)
  console.log(`Index saved to: ${path.join(dataDir, 'index.json')}`)

  if (chunks.length > 0) {
    console.log('\nSample chunks:')
    chunks.slice(0, 3).forEach((c, i) => {
      console.log(`\n--- Chunk ${i + 1} ---`)
      console.log(`Title: ${c.title}`)
      console.log(`URL: ${c.url}`)
      console.log(`Content: ${c.content.slice(0, 200)}...`)
    })
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
