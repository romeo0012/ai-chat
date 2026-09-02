const axios = require('axios')
const path = require('path')

class LLMClient {
  constructor(config = {}) {
    this.endpoint = config.endpoint || process.env.LLM_ENDPOINT || 'http://localhost:8000'
    this.model = config.model || process.env.LLM_MODEL || 'meta-llama/Meta-Llama-3-70B-Instruct'
    this.temperature = parseFloat(config.temperature || process.env.LLM_TEMPERATURE || '0.3')
    this.maxTokens = parseInt(config.maxTokens || process.env.LLM_MAX_TOKENS || '2048')
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || ''
  }

  buildPrompt(systemPrompt, messages) {
    const conversation = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
    conversation.unshift({ role: 'system', content: systemPrompt })
    return conversation
  }

  async generate(systemPrompt, messages, onStream) {
    const conversation = this.buildPrompt(systemPrompt, messages)
    const body = {
      model: this.model,
      messages: conversation,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: !!onStream
    }

    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    if (onStream) {
      return this.streamResponse(body, headers, onStream)
    }
    return this.jsonResponse(body, headers)
  }

  async jsonResponse(body, headers) {
    const res = await axios.post(`${this.endpoint}/v1/chat/completions`, body, {
      headers,
      timeout: 120000
    })
    return res.data.choices?.[0]?.message?.content || ''
  }

  async streamResponse(body, headers, onStream) {
    let res
    try {
      res = await axios.post(`${this.endpoint}/v1/chat/completions`, body, {
        headers,
        responseType: 'stream',
        timeout: 300000
      })
    } catch (err) {
      // Attach response body (e.g. vLLM "context length exceeded" 400) for diagnostics.
      if (err.response && err.response.data) {
        err.message = `${err.message} :: ${JSON.stringify(err.response.data).slice(0, 500)}`
      }
      throw err
    }

    let full = ''
    const decoder = new (require('string_decoder').StringDecoder)('utf-8')
    let buffer = ''

    return new Promise((resolve, reject) => {
      res.data.on('data', chunk => {
        buffer += decoder.write(chunk)
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            if (delta) {
              full += delta
              onStream(delta)
            }
          } catch {}
        }
      })
      res.data.on('end', () => {
        if (buffer.trim()) {
          const trimmed = buffer.trim()
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6)
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data)
                const delta = parsed.choices?.[0]?.delta?.content || ''
                if (delta) {
                  full += delta
                  onStream(delta)
                }
              } catch {}
            }
          }
        }
        resolve(full)
      })
      res.data.on('error', reject)
    })
  }
}

module.exports = LLMClient
