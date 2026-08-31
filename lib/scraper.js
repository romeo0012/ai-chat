const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')

class Scraper {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
    this.visited = new Set()
    this.pages = []
  }

  isSameOrigin(url) {
    return url.startsWith(this.baseUrl)
  }

  resolveUrl(href) {
    if (href.startsWith('#')) return null
    try {
      return new URL(href, this.baseUrl).href
    } catch {
      return null
    }
  }

  shouldCrawl(href) {
    const skipPatterns = [
      /\?/, /#/, /\.(pdf|zip|png|jpg|jpeg|gif|svg|ico|css|js)$/i,
      /\/blog\//, /\/category\//, /\/tag\//, /\/author\//,
      /\/feed\//, /\/wp-content\//, /wp-json/, /\/cdn-cgi\//
    ]
    return !skipPatterns.some(p => p.test(href))
  }

  extractContent($) {
    $('script, style, nav, header, footer, .sidebar, aside, .menu, .toc').remove()
    const main = $('main, article, .content, .documentation, .doc-content, .markdown-body, [role="main"]').first()
    const html = main.length ? main : $('body')
    const title = $('h1').first().text().trim() || $('title').text().trim()
    html.find('br').replaceWith('\n')
    html.find('p, div, h1, h2, h3, h4, h5, h6, li, tr, th, td, pre, blockquote').after(' ')
    const text = html.text().replace(/\s+/g, ' ').trim()
    return { title, text, html: html.html() }
  }

  chunkText(text, title, url, maxChunkSize = 1500, overlap = 200) {
    if (text.length <= maxChunkSize) {
      return [{ title, url, content: text }]
    }
    const chunks = []
    const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text]
    let current = ''
    for (const sentence of sentences) {
      if ((current + sentence).length > maxChunkSize && current.length > 0) {
        chunks.push({ title, url, content: current.trim() })
        const words = current.split(/\s+/)
        const overlapWords = words.slice(-30).join(' ')
        if (overlapWords.length < overlap) {
          current = overlapWords + sentence
        } else {
          current = words.slice(-20).join(' ') + sentence
        }
      } else {
        current += sentence
      }
    }
    if (current.trim().length > 0) {
      chunks.push({ title, url, content: current.trim() })
    }
    return chunks
  }

  async crawl(url, depth = 0, maxDepth = 3, maxPages = 200) {
    const resolved = url.startsWith('http') ? url : this.resolveUrl(url)
    if (!resolved || this.visited.has(resolved) || depth > maxDepth || this.pages.length >= maxPages) {
      return
    }
    this.visited.add(resolved)
    console.log(`[${this.pages.length + 1}] Crawling: ${resolved}`)

    try {
      const res = await axios.get(resolved, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'cs,en;q=0.9',
        }
      })
      const $ = cheerio.load(res.data)
      const { title, text } = this.extractContent($)

      if (text.length > 50) {
        const chunks = this.chunkText(text, title, resolved)
        this.pages.push(...chunks)
        console.log(`  → ${chunks.length} chunks (${text.length} chars)`)
      }

      const links = new Set()
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        const fullUrl = this.resolveUrl(href)
        if (fullUrl && this.isSameOrigin(fullUrl) && this.shouldCrawl(fullUrl)) {
          links.add(fullUrl)
        }
      })

      for (const link of links) {
        if (this.visited.has(link) || this.pages.length >= maxPages) continue
        await this.crawl(link, depth + 1, maxDepth, maxPages)
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`)
    }
  }

  async scrape(url, options = {}) {
    this.pages = []
    this.visited = new Set()
    const maxDepth = options.maxDepth || 3
    const maxPages = options.maxPages || 200
    await this.crawl(url, 0, maxDepth, maxPages)
    console.log(`\nDone. Scraped ${this.pages.length} total chunks from ${this.visited.size} pages.`)
    return this.pages
  }

  saveToFile(chunks, filepath) {
    const dir = path.dirname(filepath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filepath, JSON.stringify(chunks, null, 2), 'utf-8')
    console.log(`Saved ${chunks.length} chunks to ${filepath}`)
  }

  loadFromFile(filepath) {
    if (!fs.existsSync(filepath)) return []
    const data = fs.readFileSync(filepath, 'utf-8')
    const chunks = JSON.parse(data)
    console.log(`Loaded ${chunks.length} chunks from ${filepath}`)
    return chunks
  }
}

module.exports = Scraper
