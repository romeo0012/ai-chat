const bp = window.BASE_PATH || ''
const socket = io('/', { path: bp + '/socket.io' })
const chat = document.getElementById('chat')
const input = document.getElementById('input')
const sendBtn = document.getElementById('send-btn')
const clearBtn = document.getElementById('clear-btn')

let waiting = false
let currentLang = 'cz'
let messageLog = []

const i18n = {
  cz: {
    'page-title': 'AI Chat – PaaS Help',
    'subtitle': 'PaaS Cloud Help',
    'faq-header': 'Nejčastější dotazy',
    'faq-toggle': 'Přepnout FAQ',
    'clear-title': 'Smazat historii',
    'input-placeholder': 'Napiš zprávu...',
    'clear-confirm': 'Smazat celou konverzaci?',
    'msg-you': 'Ty',
    'msg-ai': 'AI',
  },
  en: {
    'page-title': 'AI Chat – PaaS Help',
    'subtitle': 'PaaS Cloud Help',
    'faq-header': 'Frequently Asked Questions',
    'faq-toggle': 'Toggle FAQ',
    'clear-title': 'Clear history',
    'input-placeholder': 'Type a message...',
    'clear-confirm': 'Clear entire conversation?',
    'msg-you': 'You',
    'msg-ai': 'AI',
  },
  de: {
    'page-title': 'AI Chat – PaaS Help',
    'subtitle': 'PaaS Cloud Help',
    'faq-header': 'Häufig gestellte Fragen',
    'faq-toggle': 'FAQ umschalten',
    'clear-title': 'Verlauf löschen',
    'input-placeholder': 'Nachricht schreiben...',
    'clear-confirm': 'Gesamte Unterhaltung löschen?',
    'msg-you': 'Du',
    'msg-ai': 'KI',
  },
}

function translateUI(lang) {
  const t = i18n[lang] || i18n.cz
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (t[key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = t[key]
      } else {
        el.textContent = t[key]
      }
    }
  })
  // update title attribute on clear button
  if (t['clear-title']) clearBtn.title = t['clear-title']
  // update document title
  if (t['page-title']) document.title = t['page-title']
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    currentLang = btn.dataset.lang
    translateUI(currentLang)
    reRenderHistory()
    socket.emit('set-language', currentLang)
  })
})

function scrollToBottom() {
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight })
}

function escapeHtml(text) {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function renderMarkdown(text) {
  let html = escapeHtml(text)
  html = html.replace(/\n/g, '<br>')
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.replace(/\n$/, ''))
    return `<pre><code class="lang-${lang || ''}">${escaped}</code></pre>`
  })
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:1.2em">$1</strong>')
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:1.3em">$1</strong>')
  html = html.replace(/^- (.+)$/gm, '• $1')
  html = html.replace(/^\d+\. (.+)$/gm, (m) => m)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (m) => { const u = m.replace(/&gt;+$/, ''); return `<a href="${u}" target="_blank" rel="noopener">${u}</a>` })
  html = html.replace(/<br>\•/g, '<br>•')
  return html
}

function addMessage(role, content) {
  const div = document.createElement('div')
  div.className = `msg ${role}`
  const t = i18n[currentLang] || i18n.cz
  const label = role === 'user' ? t['msg-you'] : t['msg-ai']
  div.innerHTML = `<div class="msg-header">${label}</div><div class="msg-body">${renderMarkdown(content)}</div>`
  chat.appendChild(div)
  scrollToBottom()
  return div
}

function recordMessage(role, content, el) {
  messageLog.push({ role, content, el })
}

function reRenderHistory() {
  chat.innerHTML = ''
  messageLog.forEach(m => {
    const div = document.createElement('div')
    div.className = `msg ${m.role}`
    const t = i18n[currentLang] || i18n.cz
    const label = m.role === 'user' ? t['msg-you'] : t['msg-ai']
    div.innerHTML = `<div class="msg-header">${label}</div><div class="msg-body">${renderMarkdown(m.content)}</div>`
    chat.appendChild(div)
    m.el = div
  })
  scrollToBottom()
}

function showTyping() {
  const div = document.createElement('div')
  div.className = 'msg assistant'
  div.id = 'typing-msg'
  div.innerHTML = `<div class="msg-header">AI</div><div class="msg-body"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`
  chat.appendChild(div)
  scrollToBottom()
}

function removeTyping() {
  const el = document.getElementById('typing-msg')
  if (el) el.remove()
}

function showCursor(container) {
  const cursor = document.createElement('span')
  cursor.className = 'cursor'
  cursor.id = 'cursor'
  container.querySelector('.msg-body').appendChild(cursor)
  scrollToBottom()
}

function removeCursor() {
  const cursor = document.getElementById('cursor')
  if (cursor) cursor.remove()
}

let assistantMsgEl = null

function sendMessage() {
  const text = input.value.trim()
  if (!text || waiting) return
  input.value = ''
  input.style.height = 'auto'
  sendBtn.disabled = true
  waiting = true

  addMessage('user', text)
  recordMessage('user', text, chat.lastElementChild)
  showTyping()

  socket.emit('message', { text, lang: currentLang })
}

socket.on('user-message', () => {})

socket.on('assistant-start', () => {
  removeTyping()
  const div = document.createElement('div')
  div.className = 'msg assistant'
  div.innerHTML = `<div class="msg-header">AI</div><div class="msg-body"></div>`
  chat.appendChild(div)
  assistantMsgEl = div
  showCursor(div)
  scrollToBottom()
})

socket.on('assistant-chunk', (chunk) => {
  if (!assistantMsgEl) return
  const body = assistantMsgEl.querySelector('.msg-body')
  const text = body.textContent
  body.innerHTML = renderMarkdown(text + chunk)
  showCursor(assistantMsgEl)
  scrollToBottom()
})

socket.on('assistant-end', (full) => {
  if (!assistantMsgEl) return
  removeCursor()
  const body = assistantMsgEl.querySelector('.msg-body')
  body.innerHTML = renderMarkdown(full)
  recordMessage('assistant', full, assistantMsgEl)
  assistantMsgEl = null
  waiting = false
  sendBtn.disabled = false
  input.focus()
  scrollToBottom()
})

socket.on('assistant-error', (err) => {
  removeTyping()
  removeCursor()
  const div = document.createElement('div')
  div.className = 'error-msg'
  div.textContent = err
  chat.appendChild(div)
  assistantMsgEl = null
  waiting = false
  sendBtn.disabled = false
  scrollToBottom()
})

socket.on('cleared', () => {
  chat.innerHTML = ''
  messageLog = []
  waiting = false
  sendBtn.disabled = false
  assistantMsgEl = null
  input.focus()
})

socket.on('history-translated', (data) => {
  const translations = data.translations || []
  let userIdx = 0
  messageLog.forEach(m => {
    if (m.role === 'user') {
      if (userIdx < translations.length) m.content = translations[userIdx]
      userIdx++
    }
  })
  reRenderHistory()
})

input.addEventListener('input', () => {
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 200) + 'px'
  sendBtn.disabled = !input.value.trim() || waiting
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

clearBtn.addEventListener('click', () => {
  const t = i18n[currentLang] || i18n.cz
  if (confirm(t['clear-confirm'])) {
    socket.emit('clear')
  }
})

// FAQ toggle
const faq = document.getElementById('faq')
const faqToggle = document.getElementById('faq-toggle')
const faqHeader = document.getElementById('faq-header')
const faqBody = document.getElementById('faq-body')
faqHeader.addEventListener('click', () => {
  faq.classList.toggle('faq-collapsed')
})
// Live FAQ update from server
socket.on('faq-update', (questions) => {
  const oldQ = faqBody.querySelector('.faq-q')
  faqBody.innerHTML = ''
  questions.forEach(q => {
    const btn = document.createElement('button')
    btn.className = 'faq-q'
    btn.setAttribute('data-q', q)
    btn.textContent = q
    btn.addEventListener('click', () => {
      if (!q || waiting) return
      input.value = q
      sendMessage()
    })
    faqBody.appendChild(btn)
  })
  // If collapsed and we have no prior buttons, auto-expand on first load
  if (!oldQ && faq.classList.contains('faq-collapsed')) {
    faq.classList.remove('faq-collapsed')
  }
})

sendBtn.addEventListener('click', sendMessage)
sendBtn.disabled = true
input.focus()
