// Pre-cache all documentation pages (from the RAG index) in all languages.
// Mirrors server.js getTranslatedDoc / getProductTranslatedDoc cache layout:
//   virtuozzo  -> data/docs_cache/{lang}/{safeName}.html
//   product    -> data/docs_cache/product/{product}/{lang}/{safeName}.html
// EN is rendered directly from the index (no LLM), CZ/DE via LLM translation.
// Resumable: existing cache files are skipped.
const path = require('path')
const fs = require('fs')

const dataDir = path.join(__dirname, '..', 'data')
const CACHE_DIR = process.env.CACHE_DIR || path.join(dataDir, 'docs_cache')

const rag = require('../lib/rag')
const LLMClient = require('../lib/llm')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const engine = new rag(dataDir)
engine.loadIndex(path.join(dataDir, 'index.json'))

const llm = new LLMClient()
const LANG_NAME = { cz: 'Czech', en: 'English', de: 'German' }
const LANG_ATTR = { cz: 'cs', de: 'de', en: 'en' }

const V_BASE = 'https://www.virtuozzo.com/application-management-docs/'

const PRODUCT_BASE_URLS = {
  kubernetes: 'https://kubernetes.io/docs/',
  elasticsearch: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/',
  kafka: 'https://kafka.apache.org/43/',
  keycloak: [
    'https://www.keycloak.org/documentation',
    'https://www.keycloak.org/docs/',
    'https://www.keycloak.org/server/',
    'https://www.keycloak.org/guides',
    'https://www.keycloak.org/getting-started/',
    'https://www.keycloak.org/securing-apps/',
    'https://www.keycloak.org/high-availability/',
    'https://www.keycloak.org/operator/',
    'https://www.keycloak.org/app',
  ],
  vault: 'https://developer.hashicorp.com/vault/docs',
  docker: 'https://docs.docker.com/',
  gitlab: 'https://docs.gitlab.com/',
  harbor: 'https://goharbor.io/docs/',
  nexus: 'https://help.sonatype.com/repomanager3',
  argocd: 'https://argo-cd.readthedocs.io/en/stable/',
  nginx: ['https://nginx.org/en/docs/', 'https://docs.nginx.com/'],
  traefik: 'https://doc.traefik.io/traefik/',
  apache: 'https://httpd.apache.org/docs/2.4/',
  haproxy: 'https://docs.haproxy.org/',
  litespeed: 'https://docs.litespeedtech.com/',
  varnish: 'https://varnish-cache.org/docs/7.6/',
  cloudsigma: 'https://docs.cloudsigma.com/en/latest/',
}

let pageImagesMap = {}
const pagesImagesPath = path.join(dataDir, 'page-images.json')
if (fs.existsSync(pagesImagesPath)) {
  try { pageImagesMap = JSON.parse(fs.readFileSync(pagesImagesPath, 'utf-8')) } catch {}
}

function safeName(docPath) {
  const s = (docPath || '').replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
  return s.length > 100 ? s.slice(0, 100) + '_' + require('crypto').createHash('md5').update(s).digest('hex').slice(0, 8) : s
}

function mapUrl(url) {
  const clean = url.split('#')[0]
  const vRoot = 'https://www.virtuozzo.com/application-management-docs'
  if (clean === vRoot || clean === vRoot + '/') {
    return { kind: 'virt', docPath: '' }
  }
  if (clean.startsWith(V_BASE)) {
    return { kind: 'virt', docPath: clean.slice(V_BASE.length).replace(/\/$/, '') }
  }
  for (const [pname, bases] of Object.entries(PRODUCT_BASE_URLS)) {
    const list = Array.isArray(bases) ? bases : [bases]
    for (const base of list) {
      const b = base.replace(/\/$/, '')
      if (clean === b || clean.startsWith(b + '/')) {
        return { kind: 'product', product: pname, docPath: clean.slice(b.length).replace(/^\//, '').replace(/\/$/, '') }
      }
    }
  }
  return null
}

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

function renderContentToHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<pre><code class="lang-${lang || ''}">${escaped.replace(/\n$/, '')}</code></pre>`
  })
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^---+$/gm, '<hr>')
  html = html.replace(/(?:^|\n)(\d+)\.\s+(.+?)(?=\n(?:\d+\.|$)|$)/gms, (match) => {
    const items = match.trim().split(/\n(?=\d+\.\s)/).map(line => {
      const content = line.replace(/^\d+\.\s+/, '').trim()
      return content ? `<li>${content}</li>` : ''
    }).filter(Boolean)
    return items.length ? `<ol>\n${items.join('\n')}\n</ol>` : match
  })
  html = html.replace(/(?:^|\n)[-\*]\s+(.+?)(?=\n(?:[-\*]\s|$))/gms, (match) => {
    const items = match.trim().split(/\n(?=[-\*]\s)/).map(line => {
      const content = line.replace(/^[-\*]\s+/, '').trim()
      return content ? `<li>${content}</li>` : ''
    }).filter(Boolean)
    return items.length ? `<ul>\n${items.join('\n')}\n</ul>` : match
  })
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/\n(?!<\/?(?:ol|ul|li|pre|code|h[1-6]|hr))/g, '<br>')
  if (!/^<(?:ol|ul|pre|h[1-6]|hr)/.test(html)) {
    html = '<p>' + html + '</p>'
  }
  return html
}

const DOC_TEMPLATE = (title, bodyHtml, lang) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#1a1a1a;--surface:#222;--surface2:#333;--accent:#e20074;--text:#eee;--text-dim:#999;--radius:12px;--max-w:800px}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.7;font-size:15px}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:12px 20px;background:linear-gradient(135deg,#1a1a1a,#222);border-bottom:2px solid #e20074;flex-shrink:0}
header h1{font-size:16px;font-weight:600}
header .home-btn{margin-left:auto;color:var(--accent);text-decoration:none;font-size:13px;padding:4px 12px;border:1px solid var(--accent);border-radius:6px;transition:background .15s}
header .home-btn:hover{background:rgba(226,0,116,.15)}
main{flex:1;max-width:var(--max-w);width:100%;margin:0 auto;padding:24px 20px;overflow-y:auto}
main::-webkit-scrollbar{width:6px}
main::-webkit-scrollbar-thumb{background:var(--surface2);border-radius:3px}
h1{font-size:24px;font-weight:700;margin-bottom:20px;color:#fff}
h2{font-size:18px;font-weight:600;margin:24px 0 12px;color:var(--accent);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.08)}
h3{font-size:15px;font-weight:600;margin:20px 0 8px;color:#ddd}
p{margin-bottom:12px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:4px;font-size:13px;font-family:'JetBrains Mono','Fira Code',monospace}
pre{background:rgba(0,0,0,.3);padding:16px;border-radius:8px;overflow-x:auto;margin:12px 0;font-size:13px;font-family:'JetBrains Mono','Fira Code',monospace;line-height:1.5;border:1px solid rgba(255,255,255,.05)}
pre code{background:none;padding:0;font-size:inherit}
ul,ol{padding-left:24px;margin:8px 0 12px}
li{margin-bottom:4px}
hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:20px 0}
strong{font-weight:600}
.doc-image{margin:16px 0;text-align:center}
.doc-image img{max-width:100%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.1)}
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <a class="home-btn" href="/">← Chat</a>
</header>
<main>
${bodyHtml}
</main>
</body>
</html>`

function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text]
  const paragraphs = text.split(/\n\n+/)
  const chunks = []
  let current = ''
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLen && current.length > 0) {
      chunks.push(current)
      current = para
    } else {
      current += (current ? '\n\n' : '') + para
    }
  }
  if (current) chunks.push(current)
  if (chunks.some(c => c.length > maxLen)) {
    const sentenceSplit = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text]
    chunks.length = 0
    current = ''
    for (const sent of sentenceSplit) {
      if (current.length + sent.length > maxLen && current.length > 0) {
        chunks.push(current)
        current = sent
      } else {
        current += sent
      }
    }
    if (current) chunks.push(current)
  }
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)]
}

const axios = require('axios')
async function translateWithLLM(text, targetLang) {
  const langName = LANG_NAME[targetLang]
  const systemMsg = 'You are a professional technical translator. Translate the given text accurately while preserving all code, commands, and formatting.'
  const userMsg = `Translate the following text from English to ${langName}. Only translate prose text. Keep technical terms, code blocks, commands, file paths, and URLs exactly as they are. Preserve paragraph structure.\n\nTEXT:\n${text}`
  const body = {
    model: llm.model,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.1,
    max_tokens: 4096,
  }
  const headers = { 'Content-Type': 'application/json' }
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(`${llm.endpoint}/v1/chat/completions`, body, { headers, timeout: 120000 })
      return res.data.choices?.[0]?.message?.content || text
    } catch (err) {
      if (attempt === 3) throw err
      const delay = attempt * 8000
      process.stdout.write(`(retry ${attempt}/3 in ${delay / 1000}s: ${err.message.slice(0, 80)}) `)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

function cachePathFor(entry, lang) {
  const name = safeName(entry.docPath)
  if (entry.kind === 'virt') {
    return path.join(CACHE_DIR, lang, name + '.html')
  }
  return path.join(CACHE_DIR, 'product', entry.product, lang, name + '.html')
}

function pageChunksFor(entry) {
  let pageUrl
  if (entry.kind === 'virt') {
    pageUrl = entry.docPath ? `${V_BASE}${entry.docPath}` : 'https://www.virtuozzo.com/application-management-docs'
  } else {
    const bases = Array.isArray(PRODUCT_BASE_URLS[entry.product]) ? PRODUCT_BASE_URLS[entry.product] : [PRODUCT_BASE_URLS[entry.product]]
    const candidates = bases.map(b => {
      const bb = b.replace(/\/$/, '')
      return entry.docPath ? `${bb}/${entry.docPath}`.replace(/\/+$/, '') : bb
    })
    const match = candidates.find(pu => engine.chunks.some(ch => ch.url.replace(/\/$/, '').split('#')[0] === pu))
    pageUrl = match || candidates[0]
  }
  return {
    pageUrl,
    chunks: engine.chunks.filter(ch => ch.url.replace(/\/$/, '').split('#')[0] === pageUrl),
  }
}

async function buildPage(entry, lang) {
  const target = cachePathFor(entry, lang)
  if (fs.existsSync(target)) return { skipped: true, entry, lang, target }

  const { pageUrl, chunks } = pageChunksFor(entry)
  if (chunks.length === 0) throw new Error(`No index chunk for ${pageUrl}`)
  const title = chunks[0].title || safeName(entry.docPath)
  const bodyText = chunks.map(c => c.content).join('\n\n')
  const htmlLang = LANG_ATTR[lang] || lang

  if (lang === 'en') {
    const bodyHtml = renderContentToHtml(bodyText)
    const bodyWithImages = entry.kind === 'virt' ? injectImages(bodyHtml, pageUrl) : bodyHtml
    const html = DOC_TEMPLATE(title, bodyWithImages, 'en')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, html, 'utf-8')
    return { skipped: false, entry, lang, target }
  }

  const maxChunkLen = 2000
  let translatedBody
  if (bodyText.length <= maxChunkLen) {
    translatedBody = await translateWithLLM(bodyText, lang)
  } else {
    const parts = splitIntoChunks(bodyText, maxChunkLen)
    const translated = []
    for (let i = 0; i < parts.length; i++) {
      translated.push(await translateWithLLM(parts[i], lang))
    }
    translatedBody = translated.join('\n\n')
  }

  const bodyHtml = renderContentToHtml(translatedBody)
  const bodyWithImages = entry.kind === 'virt' ? injectImages(bodyHtml, pageUrl) : bodyHtml
  const html = DOC_TEMPLATE(title, bodyWithImages, htmlLang)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, html, 'utf-8')
  return { skipped: false, entry, lang, target }
}

const ALL_LANGS = ['en', 'cz', 'de']
async function main() {
  const langFilter = process.env.LANGS ? process.env.LANGS.split(',') : ALL_LANGS
  const pages = new Map()
  for (const chunk of engine.chunks) {
    const u = (chunk.url || '').split('#')[0].replace(/\/$/, '')
    if (!u || u.includes('/_sources/')) continue
    if (!pages.has(u)) pages.set(u, { title: chunk.title || '', content: chunk.content })
    else pages.get(u).content += '\n\n' + chunk.content
  }

  const entries = []
  for (const [url] of pages) {
    const map = mapUrl(url)
    if (!map) { console.log('UNMAPPED:', url); continue }
    entries.push({ ...map, url })
  }

  console.log(`Found ${entries.length} pages to cache into ${CACHE_DIR}`)
  const stats = { done: 0, skipped: 0, failed: 0 }
  for (const lang of langFilter) {
    console.log(`\n=== Language ${LANG_NAME[lang]} (${lang}) ===`)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const label = entry.kind === 'virt' ? `virt/${entry.docPath}` : `product/${entry.product}/${entry.docPath}`
      process.stdout.write(`[${lang}] ${i + 1}/${entries.length} ${label} ... `)
      try {
        const r = await buildPage(entry, lang)
        if (r.skipped) { stats.skipped++; process.stdout.write('cached\n') }
        else { stats.done++; process.stdout.write('✓\n') }
      } catch (e) {
        stats.failed++
        console.log(`FAILED: ${e.message}`)
      }
      await new Promise(r => setTimeout(r, 300))
    }
  }
  console.log('\n=== DONE ===', stats)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })