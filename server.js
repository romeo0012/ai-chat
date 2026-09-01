require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const LLMClient = require('./lib/llm')
const RAGEngine = require('./lib/rag')

const PORT = process.env.PORT || 3000
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '')
const HELP_URL = process.env.HELP_URL
const FALLBACK_URL = process.env.FALLBACK_URL || 'http://localhost:8001'
const dataDir = path.join(__dirname, 'data')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  path: BASE_PATH + '/socket.io'
})

// Serve static assets and inject BASE_PATH into HTML.
// Always inject window.BASE_PATH and the Socket.IO client so `main.js`
// (which calls io(...)) works whether or not BASE_PATH is configured.
const publicDir = path.join(__dirname, 'public')

function serveIndex(req, res) {
  const injectedScript =
    `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)}</script>` +
    `<script src="${BASE_PATH}/socket.io/socket.io.js"></script>` +
    `<script src="${BASE_PATH}/main.js"></script>`
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8')
    .replace(/<script[^>]*src="main\.js"[^>]*><\/script>/, injectedScript)
  res.type('html').send(html)
}

if (BASE_PATH) {
  app.get(BASE_PATH + '/', serveIndex)
  app.get(BASE_PATH, (req, res) => res.redirect(BASE_PATH + '/'))
  // Other static assets (not index.html — already handled above)
  app.use(BASE_PATH, (req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') return next('route')
    express.static(publicDir)(req, res, next)
  })
} else {
  // Serve index.html with the Socket.IO client injected
  app.get('/', serveIndex)
  app.use(express.static(publicDir))
}

const VALID_LANGS = new Set(['en', 'de', 'cz'])
const LANG_INSTRUCTION = {
  cz: 'VŽDY ODPOVÍDEJ ČESKY. Používej české výrazy. Odpovídej česky na jakýkoliv dotaz bez ohledu na jazyk otázky.',
  en: 'ALWAYS ANSWER IN ENGLISH. Use English terms. Respond in English to any question regardless of the question language.',
  de: 'ANTWORTE IMMER AUF DEUTSCH. Verwende deutsche Begriffe. Antworte auf Deutsch auf jede Frage unabhängig von der Fragesprache.',
}
const LANG_LABEL = { cz: 'Čeština', en: 'English', de: 'Deutsch' }
const LANG_NAME = { cz: 'Czech', en: 'English', de: 'German' }
const COMMITTED_TRANSLATION_DIR = path.join(dataDir, 'docs_cache')
const TRANSLATION_DIR = process.env.DOCS_CACHE_DIR || COMMITTED_TRANSLATION_DIR

// If translations are shipped in the image (read-only COMMITTED_TRANSLATION_DIR)
// but the active cache lives elsewhere (DOCS_CACHE_DIR, e.g. a writable /tmp
// in CodeNOW with a read-only rootfs), seed the active dir from the committed
// data so shipped translations are available AND still writable.
if (TRANSLATION_DIR !== COMMITTED_TRANSLATION_DIR &&
    fs.existsSync(COMMITTED_TRANSLATION_DIR) &&
    !fs.existsSync(path.join(TRANSLATION_DIR, 'en'))) {
  try {
    fs.cpSync(COMMITTED_TRANSLATION_DIR, TRANSLATION_DIR, { recursive: true })
    console.log(`[docs-cache] seeded ${TRANSLATION_DIR} from committed cache`)
  } catch (e) {
    console.error(`[docs-cache] seeding failed: ${e.message}`)
  }
}

function docsUrl(lang, path) {
  return `${BASE_PATH}/docs/${lang}/${path.replace(/^\//, '')}`
}

function localUrl(lang, url) {
  const vUrl = 'https://www.virtuozzo.com/application-management-docs/'
  if (url.startsWith(vUrl)) {
    const docPath = url.replace(vUrl, '').replace(/\/$/, '')
    return docsUrl(lang, docPath)
  }
  for (const [pname, bases] of Object.entries(PRODUCT_BASE_URLS)) {
    const list = Array.isArray(bases) ? bases : [bases]
    for (const base of list) {
      const b = base.replace(/\/$/, '')
      if (url.startsWith(b)) {
        const docPath = url.slice(b.length).replace(/^\//, '')
        return `${BASE_PATH}/p/${lang}/${pname}/${docPath}`
      }
    }
  }
  return url
}

const PRODUCT_BASE_URLS = {
  kubernetes: 'https://kubernetes.io/docs/',
  elasticsearch: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/',
  kafka: 'https://kafka.apache.org/43/',
  keycloak: 'https://www.keycloak.org/documentation',
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
const VALID_PRODUCTS = new Set(Object.keys(PRODUCT_BASE_URLS))
// Map domain → product name for URL rewriting
const DOMAIN_TO_PRODUCT = {}
for (const [name, urls] of Object.entries(PRODUCT_BASE_URLS)) {
  const list = Array.isArray(urls) ? urls : [urls]
  for (const url of list) {
    try {
      const host = new URL(url).hostname
      DOMAIN_TO_PRODUCT[host] = name
    } catch (e) {}
  }
}

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
  const res = await axios.post(`${llm.endpoint}/v1/chat/completions`, body, { headers, timeout: 120000 })
  return res.data.choices?.[0]?.message?.content || text
}

async function translateQuestionWithLLM(text, targetLang) {
  const langName = LANG_NAME[targetLang]
  const systemMsg = `You translate a short FAQ question into ${langName}. Return ONLY the translated question itself. Do not answer it. Do not add explanations, tips, steps, code, or any other text. Output just the single translated question.`
  const body = {
    model: llm.model,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: `Translate this question to ${langName} (concise, question only):\n${text}` }
    ],
    temperature: 0.1,
    max_tokens: 128,
  }
  const headers = { 'Content-Type': 'application/json' }
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`
  const res = await axios.post(`${llm.endpoint}/v1/chat/completions`, body, { headers, timeout: 60000 })
  let out = res.data.choices?.[0]?.message?.content || text
  out = out.split('\n')[0].replace(/^\s*(Question[:：]?\s*)?/i, '').replace(/[.。]+$/, '?').trim()
  return out || text
}

function renderContentToHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<pre><code class="lang-${lang || ''}">${escaped.replace(/\n$/, '')}</code></pre>`
  })
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // headings (lines starting with ###, ##, #)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // separators
  html = html.replace(/^---+$/gm, '<hr>')
  // numbered lists
  html = html.replace(/(?:^|\n)(\d+)\.\s+(.+?)(?=\n(?:\d+\.|$)|$)/gms, (match) => {
    const items = match.trim().split(/\n(?=\d+\.\s)/).map(line => {
      const content = line.replace(/^\d+\.\s+/, '').trim()
      return content ? `<li>${content}</li>` : ''
    }).filter(Boolean)
    return items.length ? `<ol>\n${items.join('\n')}\n</ol>` : match
  })
  // bullet lists
  html = html.replace(/(?:^|\n)[-\*]\s+(.+?)(?=\n(?:[-\*]\s|$))/gms, (match) => {
    const items = match.trim().split(/\n(?=[-\*]\s)/).map(line => {
      const content = line.replace(/^[-\*]\s+/, '').trim()
      return content ? `<li>${content}</li>` : ''
    }).filter(Boolean)
    return items.length ? `<ul>\n${items.join('\n')}\n</ul>` : match
  })
  // paragraphs (double newline)
  html = html.replace(/\n\n+/g, '</p><p>')
  // single newlines within paragraphs
  html = html.replace(/\n(?!<\/?(?:ol|ul|li|pre|code|h[1-6]|hr))/g, '<br>')
  // wrap in <p> if not starting with a block tag
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

// Page images mapping (loaded from page-images.json)
let pageImagesMap = {}
const pageImagesPath = path.join(dataDir, 'page-images.json')
if (fs.existsSync(pageImagesPath)) {
  try {
    pageImagesMap = JSON.parse(fs.readFileSync(pageImagesPath, 'utf-8'))
    console.log(`Page images map loaded: ${Object.keys(pageImagesMap).length} pages`)
  } catch (e) {
    console.error('Failed to load page-images.json:', e.message)
  }
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
      const localPath = `${BASE_PATH}/images/docs/${subdir}/${filename}`
      const alt = filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')
      result.push(`<div class="doc-image"><img src="${localPath}" alt="${alt}" loading="lazy"></div>`)
      imgIdx++
    }
  }
  while (imgIdx < images.length) {
    const parts2 = images[imgIdx].split('/')
    const subdir = parts2[parts2.length - 2]
    const filename = parts2[parts2.length - 1]
    const localPath = `${BASE_PATH}/images/docs/${subdir}/${filename}`
    const alt = filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')
    result.push(`<div class="doc-image"><img src="${localPath}" alt="${alt}" loading="lazy"></div>`)
    imgIdx++
  }
  return result.join('')
}

async function getTranslatedDoc(lang, docPath) {
  const cacheDir = path.join(TRANSLATION_DIR, lang)
  const safeName = docPath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
  const finalName = safeName.length > 100 ? safeName.slice(0, 100) + '_' + require('crypto').createHash('md5').update(safeName).digest('hex').slice(0, 8) : safeName
  const cacheFile = path.join(cacheDir, finalName + '.html')

  if (fs.existsSync(cacheFile)) {
    let html = fs.readFileSync(cacheFile, 'utf-8')
    if (BASE_PATH) {
      html = html.replace(/src="\/images\/docs\//g, `src="${BASE_PATH}/images/docs/`)
    }
    return html
  }

  // Reconstruct page from RAG index
  const pageUrl = `https://www.virtuozzo.com/application-management-docs/${docPath}`.replace(/\/+$/, '')
  const pageChunks = rag.chunks.filter(c => {
    const cu = c.url.replace(/\/$/, '')
    return cu === pageUrl
  })
  if (pageChunks.length === 0) {
    throw new Error(`Page not found in RAG index: ${pageUrl}`)
  }

  const title = pageChunks[0].title || safeName
  const bodyText = pageChunks.map(c => c.content).join('\n\n')
  const langAttr = { cz: 'cs', de: 'de', en: 'en' }
  const htmlLang = langAttr[lang] || lang

  // For EN, serve directly from RAG
  if (lang === 'en') {
    const bodyHtml = renderContentToHtml(bodyText)
    const bodyWithImages = injectImages(bodyHtml, pageUrl)
    const enHtml = DOC_TEMPLATE(title, bodyWithImages, 'en')
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(cacheFile, enHtml, 'utf-8')
    return enHtml
  }

  // Translate via LLM
  const maxChunkLen = 2000
  let translatedBody
  if (bodyText.length <= maxChunkLen) {
    translatedBody = await translateWithLLM(bodyText, lang)
  } else {
    const chunks = splitIntoChunks(bodyText, maxChunkLen)
    const translated = []
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[translate] ${lang}/${safeName} chunk ${i + 1}/${chunks.length}`)
      translated.push(await translateWithLLM(chunks[i], lang))
    }
    translatedBody = translated.join('\n\n')
  }

  const bodyHtml = renderContentToHtml(translatedBody)
  const bodyWithImages = injectImages(bodyHtml, pageUrl)
  const html = DOC_TEMPLATE(title, bodyWithImages, htmlLang)

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cacheFile, html, 'utf-8')
  console.log(`[translate] cached ${lang}/${safeName}`)
  return html
}

async function getProductTranslatedDoc(lang, product, docPath) {
  const productCacheDir = path.join(TRANSLATION_DIR, 'product', product, lang)
  const safeName = docPath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
  const finalName = safeName.length > 100 ? safeName.slice(0, 100) + '_' + require('crypto').createHash('md5').update(safeName).digest('hex').slice(0, 8) : safeName
  const cacheFile = path.join(productCacheDir, finalName + '.html')

  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile, 'utf-8')
  }

  const baseUrl = PRODUCT_BASE_URLS[product].replace(/\/$/, '')
  const pageUrl = `${baseUrl}/${docPath}`.replace(/\/+$/, '')
  const pageChunks = rag.chunks.filter(c => {
    const cu = c.url.replace(/\/$/, '')
    return cu === pageUrl
  })
  if (pageChunks.length === 0) {
    throw new Error(`Page not found for ${product}: ${pageUrl}`)
  }

  const title = pageChunks[0].title || safeName
  const bodyText = pageChunks.map(c => c.content).join('\n\n')
  const langAttr = { cz: 'cs', de: 'de', en: 'en' }
  const htmlLang = langAttr[lang] || lang

  if (lang === 'en') {
    const bodyHtml = renderContentToHtml(bodyText)
    const html = DOC_TEMPLATE(title, bodyHtml, 'en')
    if (!fs.existsSync(productCacheDir)) fs.mkdirSync(productCacheDir, { recursive: true })
    fs.writeFileSync(cacheFile, html, 'utf-8')
    return html
  }

  const maxChunkLen = 2000
  let translatedBody
  if (bodyText.length <= maxChunkLen) {
    translatedBody = await translateWithLLM(bodyText, lang)
  } else {
    const chunks = splitIntoChunks(bodyText, maxChunkLen)
    const translated = []
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[translate] ${product}/${lang}/${safeName} chunk ${i + 1}/${chunks.length}`)
      translated.push(await translateWithLLM(chunks[i], lang))
    }
    translatedBody = translated.join('\n\n')
  }

  const bodyHtml = renderContentToHtml(translatedBody)
  const html = DOC_TEMPLATE(title, bodyHtml, htmlLang)

  if (!fs.existsSync(productCacheDir)) fs.mkdirSync(productCacheDir, { recursive: true })
  fs.writeFileSync(cacheFile, html, 'utf-8')
  console.log(`[translate] product cached ${product}/${lang}/${safeName}`)
  return html
}

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

app.get(BASE_PATH + '/docs/:lang([a-z]{2})/:path(*)', async (req, res) => {
  const lang = req.params.lang
  if (!VALID_LANGS.has(lang)) {
    return res.status(404).send(`<h1>Stránka nenalezena</h1><p>Neznámý jazyk: ${lang}.</p><a href="/">Zpět na chat</a>`)
  }
  try {
    const html = await getTranslatedDoc(lang, req.params.path)
    res.send(html)
  } catch (err) {
    console.error(`[docs error] ${err.message}`)
    res.status(502).send(`<h1>Chyba při načítání dokumentace</h1><p>${err.message}</p><a href="/">Zpět na chat</a>`)
  }
})

app.get(BASE_PATH + '/p/:lang([a-z]{2})/:product/:path(*)', async (req, res) => {
  const lang = req.params.lang
  const product = req.params.product
  if (!VALID_LANGS.has(lang)) {
    return res.status(404).send(`<h1>Stránka nenalezena</h1><p>Neznámý jazyk: ${lang}.</p><a href="/">Zpět na chat</a>`)
  }
  if (!VALID_PRODUCTS.has(product)) {
    return res.status(404).send(`<h1>Stránka nenalezena</h1><p>Neznámý produkt: ${product}.</p><a href="/">Zpět na chat</a>`)
  }
  try {
    const html = await getProductTranslatedDoc(lang, product, req.params.path || '')
    res.send(html)
  } catch (err) {
    console.error(`[product-docs error] ${err.message}`)
    res.status(502).send(`<h1>Chyba při načítání dokumentace</h1><p>${err.message}</p><a href="/">Zpět na chat</a>`)
  }
})

app.get(BASE_PATH + '/p/:lang([a-z]{2})/:product/:path(*)', async (req, res) => {
  const lang = req.params.lang
  const product = req.params.product
  if (!VALID_LANGS.has(lang)) {
    return res.status(404).send(`<h1>Stránka nenalezena</h1><p>Neznámý jazyk: ${lang}.</p><a href="/">Zpět na chat</a>`)
  }
  if (!VALID_PRODUCTS.has(product)) {
    return res.status(404).send(`<h1>Stránka nenalezena</h1><p>Neznámý produkt: ${product}.</p><a href="/">Zpět na chat</a>`)
  }
  try {
    const html = await getProductTranslatedDoc(lang, product, req.params.path || '')
    res.send(html)
  } catch (err) {
    console.error(`[product-docs error] ${err.message}`)
    res.status(502).send(`<h1>Chyba při načítání dokumentace</h1><p>${err.message}</p><a href="/">Zpět na chat</a>`)
  }
})

const llm = new LLMClient()
const rag = new RAGEngine(dataDir)

let systemPromptBase = 'Jsi asistent pro platformu Virtuozzo Application Platform (dříve Jelastic).\n\nPRAVIDLA:\n1. ODPOVÍDEJ STEJNÝM JAZYKEM JAKO UŽIVATEL – česky na český dotaz, anglicky na anglický dotaz.\n2. VŽDY POUŽÍVEJ POUZE DOKUMENTACI Z KONTEXTU – nepiš z vlastních znalostí. Pokud kontext obsahuje relevantní info, použij HO. Pokud ne, napiš že v dokumentaci nic není.\n3. NEVYMÝŠLEJ SI URL – používej jen URL které jsi dostal v kontextu. Nikdy nevytvářej falešné URL adresy.\n4. KE KAŽDÉMU ZDROJI UVEĎ ODKAZ S NÁZVEM STRÁNKY – použij formát [název stránky](url), například:\n   [PHP Extensions](https://www.virtuozzo.com/application-management-docs/php-extensions/)\n   [Java Versions](https://www.virtuozzo.com/application-management-docs/java-versions/)\n   Odkazy vkládej PŘÍMO DO ODPOVĚDI (inline) u relevantní informace, nebo na konec. NEPOUŽÍVEJ formát "(URL: ...)" ani holé URL bez markdown syntaxe. NEPOUŽÍVEJ číslované reference typu [1], [2] atd. VŽDY použij název stránky z kontextu jako text odkazu.\n5. KDYŽ SE UŽIVATEL PTÁ NA POSTUP (jak něco udělat, zprovoznit, nainstalovat, nastavit), DEJ MU KONKRÉTNÍ KROK ZA KROKEM – číslovaný seznam kroků. U každého kroku uveď co je potřeba udělat a pokud jsou potřeba nějaké parametry (doména, IP adresa, verze, port, název účtu, heslo atd.), zeptej se na ně. Než začneš psát postup, zeptej se na chybějící parametry, pokud jsou z kontextu zřejmé nebo pokud je uživatel neuvedl.\n6. POKUD SE DOTAZ NETÝKÁ WORDPRESSU, NEZMIŇUJ WORDPRESS – nezmiňuj WordPress v odpovědi, pokud na to není uživatelův dotaz přímo zaměřený.\n7. ODPOVÍDEJ POUZE NA KONKRÉTNÍ DOTAZ – nepřidávej kroky ani informace o konfiguracích (PHP engine, databáze, škálování atd.), na které se uživatel neptal. Pokud se ptá na SSL/certifikát, nepiš o PHP ani o databázi.'
if (HELP_URL) {
  systemPromptBase += `\n\nYour knowledge source is: ${HELP_URL}`
}

rag.loadIndex(path.join(dataDir, 'index.json'))

// FAQ tracker – global across all sessions
const faqCounts = new Map()
const seedFaq = [
  'Jak přidat PHP rozšíření?',
  'Jak nastavit SSL certifikát?',
  'Jak škálovat zdroje aplikace?',
  'Jak vytvořit databázi?',
  'Jak nastavit doménu?',
  'Jak provést zálohu aplikace?',
  'Jak monitorovat výkon?',
  'Jak nakonfigurovat databázi?',
]
// Seed FAQs with initial count so they appear before real usage
for (const q of seedFaq) {
  faqCounts.set(q, 1)
}

function normalizeQuestion(text) {
  return text.toLowerCase().replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim()
}

function updateFaq(text) {
  // Words too generic to count toward a match
  const skipWords = new Set(['jak', 'pro', 'se', 'si', 'na', 'do', 'je', 'za', 'od', 's', 'v', 'a', 'i', 'o', 'u', 'k', 'z', 'jaký', 'jaká', 'jaké', 'nebo', 'ale', 'proto', 'tedy', 'pak'])
  const norm = normalizeQuestion(text)
  const normWords = norm.split(/\s+/).filter(w => !skipWords.has(w))
  if (normWords.length === 0) return
  // Find best match among existing FAQs (exact, then partial word match)
  let bestKey = null
  let bestScore = 0
  for (const key of faqCounts.keys()) {
    const keyNorm = normalizeQuestion(key)
    if (keyNorm === norm) { bestKey = key; break }
    const keyWords = keyNorm.split(/\s+/).filter(w => !skipWords.has(w))
    const intersection = normWords.filter(w => keyWords.includes(w)).length
    const union = new Set([...normWords, ...keyWords]).size
    const score = intersection / union
    if (score > bestScore && intersection >= 2 && score >= 0.4) {
      bestScore = score
      bestKey = key
    }
  }
  if (bestKey) {
    faqCounts.set(bestKey, faqCounts.get(bestKey) + 1)
  } else {
    faqCounts.set(text, 1)
  }
}

function getTopFaq(n) {
  return [...faqCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([q]) => q)
}

function broadcastFaq() {
  const top = getTopFaq(12)
  io.emit('faq-update', top)
}

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address
  // Send current FAQ list to new client
  socket.emit('faq-update', getTopFaq(12))
  socket.language = 'cz'
  let history = []

  socket.on('set-language', async (lang) => {
    if (!VALID_LANGS.has(lang)) return
    socket.language = lang
    console.log(`[lang] ${clientIp} → ${lang}`)
    // Re-translate already-asked user questions to the new language
    const translations = []
    for (let i = 0; i < history.length; i++) {
      const m = history[i]
      if (m.role === 'user') {
        try {
          const translated = await translateQuestionWithLLM(m.content, lang)
          history[i] = { ...m, content: translated }
          translations.push(translated)
        } catch (e) {
          translations.push(m.content)
          console.error(`[translate-history] ${e.message}`)
        }
      }
    }
    if (translations.length > 0) {
      socket.emit('history-translated', { lang, translations })
    }
    // Re-translate the FAQ panel questions to the new language
    try {
      const faqList = getTopFaq(12)
      const translatedFaq = []
      for (const q of faqList) {
        try {
          translatedFaq.push(await translateQuestionWithLLM(q, lang))
        } catch (e) {
          translatedFaq.push(q)
        }
      }
      socket.emit('faq-update', translatedFaq)
    } catch (e) {
      console.error(`[translate-faq] ${e.message}`)
    }
  })

  socket.on('message', async (msg) => {
    let userMsg, msgLang
    if (typeof msg === 'object' && msg !== null) {
      userMsg = (msg.text || '').trim()
      msgLang = msg.lang
    } else {
      userMsg = (msg || '').trim()
    }
    if (!userMsg) return
    const lang = msgLang || socket.language || 'cz'

    console.log(`[msg] ${clientIp} "${userMsg.slice(0, 100)}" (${lang})`)
    // Track FAQ
    updateFaq(userMsg)
    broadcastFaq()
    history.push({ role: 'user', content: userMsg })
    socket.emit('user-message', userMsg)

    const englishQuery = rag.translateToEnglish(userMsg)
    const searchResults = rag.search(englishQuery, 5)
    const isWpQuery = englishQuery.toLowerCase().includes('wordpress') || /\bwp\b/.test(englishQuery.toLowerCase())
    if (!isWpQuery) {
      const filtered = searchResults.filter(r => {
        if (r.url.includes('/wp-lets-encrypt/')) return true
        return !r.url.match(/\/wp-|\/wordpress/)
      })
      searchResults.splice(0, searchResults.length, ...filtered)
    }
    let hasContext = searchResults.length > 0
    let contextStr = ''
    if (hasContext) {
      // Reject if user named a specific topic not reflected in any top result
      const generic = new Set(['jak','pro','se','si','na','do','je','za','od','s','v','a','i','o','u','k','z','mít','být','může','jsou','bude','který','která','které','jaký','jaká','jaké','tento','tato','toto','nebo','ale','proto','tedy','ovšem','také','jen','již','už','když','tedy','pak','nasadit','nasazení','vytvořit','vytvoření','tvořit','nastavit','nastavím','nastavíte','nastavili','nastavení','nastavovat','prostředí','aplikace','aplikaci','webový','webová','webové','stránka','doména','přístup','přihlásit','uživatel','heslo','škálování','zdroje','paměť','disk','kontejner','databáze','bezpečnost','certifikát','síť','port','adresa','monitorování','log','chyba','záloha','obnova','cena','ceny','platba','cloudlet','dokumentace','nápověda','topologie','průvodce','spustit','běží','smazat','přidat','změnit','použít','použití'])
      const techTerms = englishQuery.toLowerCase().replace(/[.,!?;:]+/g, '').split(/\s+/).filter(w => w.length > 2 && !generic.has(w))
      if (techTerms.length > 0) {
        const topResults = searchResults.slice(0, 5).map(r => (r.url + ' ' + r.title + ' ' + (r.content || '').slice(0, 500)).toLowerCase()).join(' ')
        hasContext = techTerms.some(t => topResults.includes(t))
      }
      if (hasContext) {
        contextStr = rag.formatContext(searchResults)
      } else {
        searchResults.length = 0
      }
    }

    let systemPrompt = LANG_INSTRUCTION[lang] + '\n\n' + systemPromptBase
    if (hasContext) {
      console.log(`[RAG] ${clientIp} ${searchResults.length} výsledků: "${userMsg.slice(0, 50)}"`)
      searchResults.forEach(r => console.log(`[RAG] score=${r.score.toFixed(4)} ${r.url}`))
      systemPrompt += `\n\n=== DOKUMENTACE Z NÁPOVĚDY ===\nNásledující text je z oficiální dokumentace. POUŽIJ HO pro odpověď:\n\n${contextStr}`
    } else {
      const noDocsMsg = {
        cz: 'V dokumentaci k tomuto tématu nic není.',
        en: 'There is nothing about this topic in the documentation.',
        de: 'Zu diesem Thema gibt es nichts in der Dokumentation.',
      }
      systemPrompt += `\n\n=== ŽÁDNÁ DOKUMENTACE ===\nV dokumentaci není o tomto tématu vůbec nic. Odpověz POUZE touto jedinou větou (a nic víc): "${noDocsMsg[lang]}" NEVYMÝŠLEJ SI žádné URL adresy. NEODPOVÍDEJ z vlastních znalostí. Pokud nevíš, NAPIŠ pouze tu jednu větu a nic jiného.`
    }

    let fullResponse = ''
    socket.emit('assistant-start')

    const validUrls = new Set(searchResults.map(r => r.url.replace(/\/$/, '')))

    try {
      if (!hasContext) {
        // Fallback to GPT via FastAPI, then Mistral
        try {
          const fallbackHistory = history.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
          const resp = await axios.post(`${FALLBACK_URL}/fallback`, {
            query: userMsg,
            history: fallbackHistory,
            language: lang,
          }, {
            responseType: 'stream',
            timeout: 60000,
          })
          const chunks = []
          for await (const chunk of resp.data) {
            const text = chunk.toString()
            chunks.push(text)
            socket.emit('assistant-chunk', text)
          }
          fullResponse = chunks.join('')
        } catch (fallbackErr) {
          console.error(`[fallback error] ${fallbackErr.message}`)
          fullResponse = await llm.generate(systemPrompt, history, (chunk) => {
            socket.emit('assistant-chunk', chunk)
          })
        }
      } else {
        fullResponse = await llm.generate(systemPrompt, history, (chunk) => {
          socket.emit('assistant-chunk', chunk)
        })
        // Also fetch ChatGPT response
        const chatGptLabel = { cz: 'Odpověď ChatGPT:', en: 'ChatGPT response:', de: 'ChatGPT-Antwort:' }
        socket.emit('assistant-chunk', '\n\n---\n**' + chatGptLabel[lang] + '**\n\n')
        try {
          const fallbackHistory = history.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
          const resp = await axios.post(`${FALLBACK_URL}/fallback`, {
            query: userMsg,
            history: fallbackHistory,
            language: lang,
          }, {
            responseType: 'stream',
            timeout: 60000,
          })
          const chatChunks = []
          for await (const chunk of resp.data) {
            const text = chunk.toString()
            chatChunks.push(text)
            socket.emit('assistant-chunk', text)
          }
          fullResponse += '\n\n---\n**' + chatGptLabel[lang] + '**\n\n' + chatChunks.join('')
        } catch (fallbackErr) {
          console.error(`[fallback error] ${fallbackErr.message}`)
        }
      }
      // Strip fake URLs not present in context
      let responseText = fullResponse
        // Remove markdown links with fake URLs (keep text, drop link)
        .replace(
          /\[([^\]]*)\]\(https?:\/\/www\.virtuozzo\.com\/application-management-docs\/([^)]+)\)/g,
          (match, text, path) => validUrls.has(`https://www.virtuozzo.com/application-management-docs/${path.replace(/\/$/, '')}`) ? match : text
        )
        // Remove bare fake URLs
        .replace(
          /https?:\/\/www\.virtuozzo\.com\/application-management-docs\/([^\s.,!?;:)\]>]+)/g,
          (match, path) => validUrls.has(`https://www.virtuozzo.com/application-management-docs/${path.replace(/\/$/, '')}`) ? match : ''
        )
        // Remove markdown links to non-virtuozzo domains and raw HTML <a> tags
        .replace(
          /\[([^\]]*)\]\(https?:\/\/(?!www\.virtuozzo\.com\/application-management-docs)[^\s)]+\)/g,
          (match, text) => text.trim() || ''
        )
        // Remove raw HTML anchor tags (LLM sometimes generates these) – must run before bare URL removal
        .replace(
          /<a\s+[^>]*href="https?:\/\/[^"]+"[^>]*>[^<]*<\/a>/gi,
          (match) => match.replace(/<[^>]+>/g, '').trim() || ''
        )
        // Remove bare non-virtuozzo URLs (stop at HTML/URL delimiters)
        .replace(
          /https?:\/\/(?!www\.virtuozzo\.com\/application-management-docs)[^\s<>"'\)]+/g,
          ''
        )
      // Convert [N] reference patterns to clickable markdown links
      const sourceByNum = new Map(searchResults.map((r, i) => [i + 1, r]))
      // Pattern: [N] Title (url)  or  [N] Title - url  or  [N] Title\nURL: url
      // Also handles <URL> wrapping
      responseText = responseText.replace(
        /\[(\d+)\]\s*([^\n]+?)\s*(?:\(<?https?:\/\/www\.virtuozzo\.com\/application-management-docs\/[^>\s]+>?\)|[-–]\s*<?https?:\/\/www\.virtuozzo\.com\/application-management-docs\/[^>\s]+|\n\s*URL:\s*https?:\/\/www\.virtuozzo\.com\/application-management-docs\/[^\s]+)/g,
        (match, num, title) => {
          const src = sourceByNum.get(parseInt(num))
          if (src) return `[${title.trim()}](${src.url})`
          return match
        }
      )
      // Unwrap <URL> to URL (LLM sometimes wraps URLs in angle brackets)
      responseText = responseText.replace(/<https?:\/\/www\.virtuozzo\.com\/application-management-docs\/[^>]+>/g, (m) => m.slice(1, -1))
      // Lookup map: URL → title for link text replacement
      const urlToTitle = new Map(searchResults.map(r => [r.url.replace(/\/$/, ''), r.title]))
      // Rewrite markdown links pointing to virtuozzo docs (must happen before punctuation cleanup)
      // If the link text is generic (tady, zde, odkaz, link, etc.), replace with page title
      const genericLabels = new Set(['tady', 'zde', 'sem', 'odkaz', 'link', 'this page', 'this link', 'more info', 'více', 'více info', 'details', 'zde', 'here'])
      responseText = responseText.replace(
        /\[([^\]]+)\]\(https?:\/\/www\.virtuozzo\.com\/application-management-docs\/([^)]*)\)/g,
        (match, text, path) => {
          const cleanPath = path.replace(/[.,!?;:)>]+$/, '')
          const fullUrl = `https://www.virtuozzo.com/application-management-docs/${cleanPath}`.replace(/\/$/, '')
          const title = urlToTitle.get(fullUrl)
          const label = (title && genericLabels.has(text.toLowerCase().trim())) ? title : text
          return cleanPath ? `[${label}](${docsUrl(lang, cleanPath)})` : match
        }
      )
      // Remove trailing punctuation from any remaining bare URLs
      responseText = responseText.replace(/https?:\/\/\S+/g, (url) => url.replace(/[.,!?;:>]+$/, ''))

      // Strip (URL: ...) wrappers around valid URLs
      responseText = responseText.replace(
        /\(URL:\s*(https?:\/\/www\.virtuozzo\.com\/application-management-docs\/[^\s)]+)\)/g,
        '$1'
      )
      // Wrap bare virtuozzo.com URLs in markdown links with page titles
      responseText = responseText.replace(
        /https?:\/\/www\.virtuozzo\.com\/application-management-docs\/([^\s.,!?;:)>]+)/g,
        (match, path) => {
          const cleanPath = path.replace(/[.,!?;:)>]+$/, '')
          const fullUrl = `https://www.virtuozzo.com/application-management-docs/${cleanPath}`.replace(/\/$/, '')
          const title = urlToTitle.get(fullUrl)
          const text = title || match
          return `[${text}](${docsUrl(lang, cleanPath)})`
        }
      )
      // Clean up empty bullet points that may appear in lists
      responseText = responseText.replace(/^[\s]*\*[\s]*$/gm, '')
      // Convert remaining [N] references to links with page titles
      responseText = responseText.replace(
        /\[(\d+)\](?!\()/g,
        (match, num) => {
          const src = sourceByNum.get(parseInt(num))
          if (src) {
            return `<a href="${localUrl(lang, src.url)}" target="_blank">${src.title}</a>`
          }
          return match
        }
      )
      fullResponse = responseText
      const sorryMsgs = new Set(['Omlouvám se', 'I am sorry', 'Es tut mir leid'])
      if (fullResponse && ![...sorryMsgs].some(m => fullResponse.startsWith(m))) {
        if (hasContext) {
          const seen = new Set()
          const sources = searchResults
            .filter(r => validUrls.has(r.url.replace(/\/$/, '')))
            .filter(r => { const u = r.url.replace(/\/$/, ''); return seen.has(u) ? false : seen.add(u) })
          if (sources.length > 0) {
            const sourcesLabel = { cz: 'Zdroje (dokumentace):', en: 'Sources (documentation):', de: 'Quellen (Dokumentation):' }
            fullResponse += '\n\n---\n**' + sourcesLabel[lang] + '**\n' +
              sources.map(r => {
                const url = r.url.replace(/\/$/, '')
                const vUrl = 'https://www.virtuozzo.com/application-management-docs/'
                if (url.startsWith(vUrl)) {
                  const docPath = url.replace(vUrl, '')
                  return `- [${r.title}](${docsUrl(lang, docPath)})`
                }
                for (const [pname, bases] of Object.entries(PRODUCT_BASE_URLS)) {
                  const list = Array.isArray(bases) ? bases : [bases]
                  for (const base of list) {
                    const b = base.replace(/\/$/, '')
                    if (url.startsWith(b)) {
                      const docPath = url.slice(b.length).replace(/^\//, '')
                      return `- [${r.title}](${BASE_PATH}/p/${lang}/${pname}/${docPath})`
                    }
                  }
                }
                return `- ${r.title}`
              }).join('\n')
          }
        } else {
          fullResponse += '\n\n---\n*Zdroj: ChatGPT*'
        }
      }
      if (hasContext) console.log(`[response] ${fullResponse.slice(0, 200)}`)
    } catch (err) {
      console.error(`[error] ${err.message}`)
      socket.emit('assistant-error', `Chyba: ${err.message}`)
      fullResponse = ''
    }

    socket.emit('assistant-end', fullResponse)

    if (fullResponse) {
      history.push({ role: 'assistant', content: fullResponse })
    }
    if (history.length > 50) {
      history = history.slice(-50)
    }
  })

  socket.on('clear', () => {
    history = []
    socket.emit('cleared')
  })

  socket.on('disconnect', () => {
  })
})

server.listen(PORT, () => {
  console.log(`AI Chat server running on http://localhost:${PORT}`)
  console.log(`LLM endpoint: ${llm.endpoint}`)
  console.log(`Model: ${llm.model}`)
  console.log(`Help URL: ${HELP_URL || 'not set'}`)
  console.log(`RAG index: ${rag.loaded ? 'loaded (' + rag.chunks.length + ' chunks)' : 'not loaded'}`)
  console.log(`Data dir: ${dataDir}`)
})
