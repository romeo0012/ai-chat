const path = require('path')
const fs = require('fs')
const axios = require('axios')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const dataDir = path.join(__dirname, '..', 'data')
const RAG = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf-8'))
const IMG_MAP = JSON.parse(fs.readFileSync(path.join(dataDir, 'page-images.json'), 'utf-8'))
const CACHE = path.join(dataDir, 'docs_cache', 'cz')
const LLM = { endpoint: process.env.LLM_ENDPOINT || 'http://193.85.150.110:8000', apiKey: process.env.LLM_API_KEY || '' }

const urls = [...new Set(RAG.map(c => c.url))].filter(u => u.startsWith('http'))
const existing = new Set(fs.readdirSync(CACHE).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, '')))

async function llmTranslate(text, lang) {
  const body = {
    model: 'mistralai/Mistral-7B-Instruct-v0.3',
    messages: [
      { role: 'system', content: 'You are a professional technical translator.' },
      { role: 'user', content: `Translate from English to ${lang === 'cz' ? 'Czech' : 'German'}. Keep technical terms, commands, paths, URLs as they are. Preserve paragraph structure.\n\nTEXT:\n${text}` }
    ],
    temperature: 0.1, max_tokens: 4096,
  }
  const headers = { 'Content-Type': 'application/json' }
  if (LLM.apiKey) headers['Authorization'] = `Bearer ${LLM.apiKey}`
  for (let i = 0; i < 5; i++) {
    try {
      const res = await axios.post(`${LLM.endpoint}/v1/chat/completions`, body, { headers, timeout: 120000 })
      return res.data.choices?.[0]?.message?.content || text
    } catch (e) {
      if (i === 4) throw e
      console.log(`  [retry ${i + 1}/5]`)
      await new Promise(r => setTimeout(r, 5000 * (i + 1)))
    }
  }
}

function renderHtml(text) {
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code class="lang-${l||''}">${c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n$/,'')}</code></pre>`)
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  h = h.replace(/^---+$/gm, '<hr>')
  h = h.replace(/(?:^|\n)(\d+)\.\s+(.+?)(?=\n(?:\d+\.|$)|$)/gms, m => {
    const items = m.trim().split(/\n(?=\d+\.\s)/).map(l => { const c = l.replace(/^\d+\.\s+/, '').trim(); return c ? `<li>${c}</li>` : '' }).filter(Boolean)
    return items.length ? `<ol>\n${items.join('\n')}\n</ol>` : m
  })
  h = h.replace(/(?:^|\n)[-\*]\s+(.+?)(?=\n(?:[-\*]\s|$))/gms, m => {
    const items = m.trim().split(/\n(?=[-\*]\s)/).map(l => { const c = l.replace(/^[-\*]\s+/, '').trim(); return c ? `<li>${c}</li>` : '' }).filter(Boolean)
    return items.length ? `<ul>\n${items.join('\n')}\n</ul>` : m
  })
  h = h.replace(/\n\n+/g, '</p><p>')
  h = h.replace(/\n(?!<\/?(?:ol|ul|li|pre|code|h[1-6]|hr))/g, '<br>')
  if (!/^<(?:ol|ul|pre|h[1-6]|hr)/.test(h)) h = '<p>' + h + '</p>'
  return h
}

function injectImages(body, url) {
  const imgs = IMG_MAP[url]
  if (!imgs?.length) return body
  const parts = body.split(/(<p>.*?<\/p>)/gs)
  if (parts.length < 3) return body
  let idx = 0, cnt = 0
  const r = []
  for (const p of parts) {
    r.push(p)
    if (p.startsWith('<p>') || p.startsWith('<h')) cnt++
    if (cnt > 0 && cnt % 3 === 0 && idx < imgs.length) {
      const p2 = imgs[idx].split('/'), sd = p2[p2.length - 2], fn = p2[p2.length - 1]
      r.push(`<div class="doc-image"><img src="/images/docs/${sd}/${fn}" alt="${fn.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')}" loading="lazy"></div>`)
      idx++
    }
  }
  while (idx < imgs.length) {
    const p2 = imgs[idx].split('/'), sd = p2[p2.length - 2], fn = p2[p2.length - 1]
    r.push(`<div class="doc-image"><img src="/images/docs/${sd}/${fn}" alt="${fn.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/[_-]/g, ' ')}" loading="lazy"></div>`)
    idx++
  }
  return r.join('')
}

const TEMPLATE = (t, b, l) => `<!DOCTYPE html>
<html lang="${l}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${t}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#1a1a1a;--surface:#222;--surface2:#333;--accent:#e20074;--text:#eee;--max-w:800px}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.7;font-size:15px}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:12px 20px;background:linear-gradient(135deg,#1a1a1a,#222);border-bottom:2px solid #e20074}
header h1{font-size:16px;font-weight:600}
header .home-btn{margin-left:auto;color:var(--accent);text-decoration:none;font-size:13px;padding:4px 12px;border:1px solid var(--accent);border-radius:6px}
header .home-btn:hover{background:rgba(226,0,116,.15)}
main{flex:1;max-width:var(--max-w);width:100%;margin:0 auto;padding:24px 20px;overflow-y:auto}
h1{font-size:24px;font-weight:700;margin-bottom:20px;color:#fff}
h2{font-size:18px;font-weight:600;margin:24px 0 12px;color:var(--accent);border-bottom:1px solid rgba(255,255,255,.08)}
h3{font-size:15px;font-weight:600;margin:20px 0 8px;color:#ddd}
p{margin-bottom:12px}
a{color:var(--accent)}
code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:4px;font-size:13px;font-family:monospace}
pre{background:rgba(0,0,0,.3);padding:16px;border-radius:8px;overflow-x:auto;margin:12px 0;font-size:13px;font-family:monospace;border:1px solid rgba(255,255,255,.05)}
pre code{background:none;padding:0}
ul,ol{padding-left:24px;margin:8px 0 12px}
li{margin-bottom:4px}
hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:20px 0}
strong{font-weight:600}
.doc-image{margin:16px 0;text-align:center}
.doc-image img{max-width:100%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.1)}
</style></head><body>
<header><h1>${t}</h1><a class="home-btn" href="/">← Chat</a></header>
<main>${b}</main></body></html>`

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text]
  const paras = text.split(/\n\n+/), chunks = []
  let cur = ''
  for (const p of paras) {
    if (cur.length + p.length + 2 > maxLen && cur.length > 0) { chunks.push(cur); cur = p }
    else cur += (cur ? '\n\n' : '') + p
  }
  if (cur) chunks.push(cur)
  if (chunks.some(c => c.length > maxLen)) {
    const sents = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text]
    chunks.length = 0; cur = ''
    for (const s of sents) {
      if (cur.length + s.length > maxLen && cur.length > 0) { chunks.push(cur); cur = s }
      else cur += s
    }
    if (cur) chunks.push(cur)
  }
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)]
}

async function main() {
  const remaining = []
  for (const url of urls) {
    const docPath = url.replace('https://www.virtuozzo.com/application-management-docs/', '').replace(/\/$/, '')
    const safeName = docPath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').replace(/^_+|_+$/g, '') || 'index'
    const finalName = safeName.length > 100 ? safeName.slice(0, 100) + '_' + require('crypto').createHash('md5').update(safeName).digest('hex').slice(0, 8) : safeName
    if (!existing.has(finalName)) remaining.push({ url, docPath, finalName })
  }

  console.log(`Remaining: ${remaining.length} CZ pages\n`)

  for (let i = 0; i < remaining.length; i++) {
    const { url, docPath, finalName } = remaining[i]
    const pageUrl = url.replace(/\/$/, '')
    const chunks = RAG.filter(c => c.url.replace(/\/$/, '') === pageUrl)
    const title = chunks[0]?.title || docPath
    const text = chunks.map(c => c.content).join('\n\n')

    process.stdout.write(`[${i + 1}/${remaining.length}] ${title}... `)
    try {
      const maxLen = 2000
      let translated
      if (text.length <= maxLen) {
        translated = await llmTranslate(text, 'cz')
      } else {
        const parts = chunkText(text, maxLen)
        const results = []
        for (let j = 0; j < parts.length; j++) {
          process.stdout.write(`c${j + 1}/${parts.length} `)
          results.push(await llmTranslate(parts[j], 'cz'))
        }
        translated = results.join('\n\n')
      }

      const body = injectImages(renderHtml(translated), pageUrl)
      fs.writeFileSync(path.join(CACHE, finalName + '.html'), TEMPLATE(title, body, 'cs'), 'utf-8')
      process.stdout.write('✓\n')
    } catch (e) {
      process.stdout.write(`✗ ${e.message.slice(0, 50)}\n`)
    }
  }

  const total = fs.readdirSync(CACHE).filter(f => f.endsWith('.html')).length
  console.log(`\nDone. CZ: ${total}/136`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
