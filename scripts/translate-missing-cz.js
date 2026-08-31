require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const RAGEngine = require('../lib/rag')
const LLMClient = require('../lib/llm')

const dataDir = path.join(__dirname, '..', 'data')
const TRANSLATION_DIR = path.join(dataDir, 'docs_cache')
const cacheDir = path.join(TRANSLATION_DIR, 'cz')

const llm = new LLMClient()
const rag = new RAGEngine(dataDir)
rag.loadIndex(path.join(dataDir, 'index.json'))

const pageImagesMap = JSON.parse(fs.readFileSync(path.join(dataDir, 'page-images.json'), 'utf-8'))

function injectImages(bodyHtml, pageUrl) {
  const images = pageImagesMap[pageUrl]
  if (!images || images.length === 0) return bodyHtml
  const parts = bodyHtml.split(/(<p>.*?<\/p>)/gs)
  if (parts.length < 3) return bodyHtml
  let imgIdx = 0, paraCount = 0
  const result = []
  for (const part of parts) {
    result.push(part)
    if (part.startsWith('<p>') || part.startsWith('<h')) paraCount++
    if (paraCount > 0 && paraCount % 3 === 0 && imgIdx < images.length) {
      const p2 = images[imgIdx].split('/')
      const subdir = p2[p2.length - 2], filename = p2[p2.length - 1]
      result.push(`<div class="doc-image"><img src="/images/docs/${subdir}/${filename}" alt="${filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')}" loading="lazy"></div>`)
      imgIdx++
    }
  }
  while (imgIdx < images.length) {
    const p2 = images[imgIdx].split('/')
    const subdir = p2[p2.length - 2], filename = p2[p2.length - 1]
    result.push(`<div class="doc-image"><img src="/images/docs/${subdir}/${filename}" alt="${filename.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')}" loading="lazy"></div>`)
    imgIdx++
  }
  return result.join('')
}

function renderContentToHtml(text) {
  let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code class="lang-${l||''}">${c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n$/,'')}</code></pre>`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^---+$/gm, '<hr>')
  html = html.replace(/(?:^|\n)(\d+)\.\s+(.+?)(?=\n(?:\d+\.|$)|$)/gms, m => {
    const items = m.trim().split(/\n(?=\d+\.\s)/).map(l => { const c = l.replace(/^\d+\.\s+/, '').trim(); return c ? `<li>${c}</li>` : '' }).filter(Boolean)
    return items.length ? `<ol>\n${items.join('\n')}\n</ol>` : m
  })
  html = html.replace(/(?:^|\n)[-\*]\s+(.+?)(?=\n(?:[-\*]\s|$))/gms, m => {
    const items = m.trim().split(/\n(?=[-\*]\s)/).map(l => { const c = l.replace(/^[-\*]\s+/, '').trim(); return c ? `<li>${c}</li>` : '' }).filter(Boolean)
    return items.length ? `<ul>\n${items.join('\n')}\n</ul>` : m
  })
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/\n(?!<\/?(?:ol|ul|li|pre|code|h[1-6]|hr))/g, '<br>')
  if (!/^<(?:ol|ul|pre|h[1-6]|hr)/.test(html)) html = '<p>' + html + '</p>'
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
.doc-image img{max-width:100%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.10)}
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

async function translateWithLLM(text, targetLang) {
  const langName = { cz: 'Czech', en: 'English', de: 'German' }[targetLang]
  const body = {
    model: llm.model,
    messages: [
      { role: 'system', content: 'You are a professional technical translator.' },
      { role: 'user', content: `Translate the following text from English to ${langName}. Only translate prose text. Keep technical terms, commands, paths, URLs as they are. Preserve paragraph structure.\n\nTEXT:\n${text}` }
    ],
    temperature: 0.1, max_tokens: 4096,
  }
  const headers = { 'Content-Type': 'application/json' }
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(`${llm.endpoint}/v1/chat/completions`, body, { headers, timeout: 120000 })
      return res.data.choices?.[0]?.message?.content || text
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

async function main() {
  const urls = [...new Set(rag.chunks.map(c => c.url))].filter(u => u.startsWith('http'))
  const existing = new Set(fs.readdirSync(cacheDir).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, '')))
  console.log(`Existing CZ cache: ${existing.size} files`)

  for (let i = 0; i < urls.length; i++) {
    const pageUrl = urls[i].replace(/\/$/, '')
    const docPath = pageUrl.replace('https://www.virtuozzo.com/application-management-docs/', '').replace(/\/$/, '')
    const safeName = docPath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
    const finalName = safeName.length > 100 ? safeName.slice(0, 100) + '_' + require('crypto').createHash('md5').update(safeName).digest('hex').slice(0, 8) : safeName

    if (existing.has(finalName)) continue

    const pageChunks = rag.chunks.filter(c => c.url.replace(/\/$/, '') === pageUrl)
    const title = pageChunks[0]?.title || docPath
    const bodyText = pageChunks.map(c => c.content).join('\n\n')

    process.stdout.write(`[${i+1}/${urls.length}] ${title}... `)
    try {
      const maxChunkLen = 2000
      let translatedBody
      if (bodyText.length <= maxChunkLen) {
        translatedBody = await translateWithLLM(bodyText, 'cz')
      } else {
        const chunks = splitIntoChunks(bodyText, maxChunkLen)
        const translated = []
        for (let j = 0; j < chunks.length; j++) {
          process.stdout.write(` chunk ${j+1}/${chunks.length}... `)
          translated.push(await translateWithLLM(chunks[j], 'cz'))
          process.stdout.write('done')
        }
        translatedBody = translated.join('\n\n')
      }

      const bodyHtml = renderContentToHtml(translatedBody)
      const bodyWithImages = injectImages(bodyHtml, pageUrl)
      const html = DOC_TEMPLATE(title, bodyWithImages, 'cs')

      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
      const cacheFile = path.join(cacheDir, finalName + '.html')
      fs.writeFileSync(cacheFile, html, 'utf-8')
      process.stdout.write(' ✓\n')
    } catch (err) {
      process.stdout.write(` ERR: ${err.message.slice(0, 60)}\n`)
    }
  }
  console.log(`\nDone. CZ cache: ${fs.readdirSync(cacheDir).filter(f => f.endsWith('.html')).length} files`)
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
