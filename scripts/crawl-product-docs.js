const Scraper = require('../lib/scraper')
const RAGEngine = require('../lib/rag')
const fs = require('fs')
const path = require('path')

const products = [
  { name: 'kubernetes', url: 'https://kubernetes.io/docs/', maxPages: 50, maxDepth: 3 },
  { name: 'elasticsearch', url: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/', maxPages: 30, maxDepth: 3 },
  { name: 'kafka', url: 'https://kafka.apache.org/documentation/', maxPages: 20, maxDepth: 2 },
  { name: 'keycloak', url: 'https://www.keycloak.org/documentation', maxPages: 20, maxDepth: 2 },
  { name: 'vault', url: 'https://developer.hashicorp.com/vault/docs', maxPages: 30, maxDepth: 3 },
  { name: 'docker', url: 'https://docs.docker.com/', maxPages: 30, maxDepth: 3 },
  { name: 'gitlab', url: 'https://docs.gitlab.com/', maxPages: 30, maxDepth: 3 },
  { name: 'harbor', url: 'https://goharbor.io/docs/', maxPages: 15, maxDepth: 2 },
  { name: 'nexus', url: 'https://help.sonatype.com/repomanager3', maxPages: 15, maxDepth: 2 },
  { name: 'argocd', url: 'https://argo-cd.readthedocs.io/en/stable/', maxPages: 15, maxDepth: 2 },
]

const dataDir = path.join(__dirname, '..', 'data', 'product-docs')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

async function crawlProduct(product) {
  console.log(`\n========== Crawling ${product.name} ==========`)
  console.log(`URL: ${product.url}`)
  console.log(`Max pages: ${product.maxPages}, Max depth: ${product.maxDepth}`)

  const scraper = new Scraper(product.url)
  const chunks = await scraper.scrape(product.url, {
    maxDepth: product.maxDepth,
    maxPages: product.maxPages,
  })

  const filepath = path.join(dataDir, `${product.name}.json`)
  scraper.saveToFile(chunks, filepath)
  console.log(`Done: ${product.name} → ${chunks.length} chunks`)
  return { name: product.name, chunks, filepath }
}

async function main() {
  const allResults = []
  for (const product of products) {
    try {
      const result = await crawlProduct(product)
      allResults.push(result)
    } catch (err) {
      console.error(`FAILED ${product.name}: ${err.message}`)
    }
  }

  console.log('\n========== ALL DONE ==========')
  for (const r of allResults) {
    console.log(`${r.name}: ${r.chunks.length} chunks`)
  }

  // Merge into main index (keep all chunks, no URL dedup)
  console.log('\n========== Merging into RAG index ==========')
  const indexPath = path.join(__dirname, '..', 'data', 'index.json')
  let mainIndex = { chunks: [] }
  if (fs.existsSync(indexPath)) {
    const existing = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    mainIndex.chunks = existing.chunks || existing
  }

  let added = 0
  for (const r of allResults) {
    for (const chunk of r.chunks) {
      mainIndex.chunks.push(chunk)
      added++
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify({ chunks: mainIndex.chunks }, null, 2), 'utf-8')
  console.log(`Merged: ${added} new chunks, total: ${mainIndex.chunks.length}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
