const fs = require('fs')
const path = require('path')

class RAGEngine {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.chunks = []
    this.index = new Map()
    this.loaded = false
    this.SOURCES = [
      { host: 'www.virtuozzo.com', header: 'Dokumentace virtuozzo.com (Virtuozzo docs):' },
      { host: 'docs.cloudsigma.com', header: 'docs.cloudsigma.com (CloudSigma):' },
      { host: 'httpd.apache.org', header: 'httpd.apache.org (Apache):' },
      { host: 'nginx.org', header: 'nginx.org (Nginx):' },
      { host: 'kubernetes.io', header: 'kubernetes.io:' },
      { host: 'argo-cd.readthedocs.io', header: 'argo-cd.readthedocs.io (Argo CD):' },
      { host: 'docs.nginx.com', header: 'docs.nginx.com (Nginx ingress/admin):' },
      { host: 'docs.docker.com', header: 'docs.docker.com:' },
      { host: 'docs.haproxy.org', header: 'docs.haproxy.org (HAProxy):' },
      { host: 'www.keycloak.org', header: 'www.keycloak.org:' },
      { host: 'www.elastic.co', header: 'www.elastic.co (Elasticsearch):' },
      { host: 'docs.gitlab.com', header: 'docs.gitlab.com:' },
      { host: 'developer.hashicorp.com', header: 'developer.hashicorp.com (Vault):' },
      { host: 'doc.traefik.io', header: 'doc.traefik.io (Traefik):' },
      { host: 'help.sonatype.com', header: 'help.sonatype.com (Nexus):' },
      { host: 'kafka.apache.org', header: 'kafka.apache.org:' },
      { host: 'goharbor.io', header: 'goharbor.io (Harbor):' },
      { host: 'docs.litespeedtech.com', header: 'docs.litespeedtech.com:' },
      { host: 'varnish-cache.org', header: 'varnish-cache.org:' },
    ]
  }

  stemTerm(w) {
    if (w.length <= 4) return w
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
    if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3)
    if (w.endsWith('edly')) return w.slice(0, -4)
    if (w.endsWith('ed') && w.length > 5 && !w.endsWith('eed')) return w.slice(0, -2)
    if (w.endsWith('es') && w.length > 4) return w.slice(0, -2)
    if (w.endsWith('s') && w.length > 4 && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1)
    return w
  }

  cleanTitle(t) {
    if (!t) return 'Untitled'
    return t
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[\u00B6\u00A7\u2020\u2021\u2043\uF0C1\uFF5E\u2300-\u27BF\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9áčďéěíňóřšťúůýž\s-]/g, ' ')
      .split(/\s+/)
      .map(t => this.stemTerm(t))
      .filter(t => t.length > 2)
  }

  buildIndex(chunks) {
    this.index.clear()
    const docCount = chunks.length
    const df = new Map()

    for (let i = 0; i < chunks.length; i++) {
      const terms = this.tokenize(chunks[i].content)
      const unique = new Set(terms)
      for (const term of unique) {
        df.set(term, (df.get(term) || 0) + 1)
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      const terms = this.tokenize(chunks[i].content)
      const tf = new Map()
      for (const term of terms) {
        tf.set(term, (tf.get(term) || 0) + 1)
      }
      const tfidf = new Map()
      for (const [term, count] of tf) {
        const idf = Math.log(docCount / (1 + (df.get(term) || 0)))
        tfidf.set(term, (count / terms.length) * idf)
      }
      this.index.set(i, tfidf)
    }

    this.chunks = chunks
    this.loaded = true
    console.log(`RAG index built: ${chunks.length} chunks, ${df.size} unique terms`)
  }

  loadIndex(filepath) {
    const resolved = filepath || path.join(this.dataDir, 'index.json')
    if (!fs.existsSync(resolved)) {
      console.log(`No index found at ${resolved}`)
      return false
    }
    const data = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
    this.chunks = data.chunks || data
    this.loaded = this.chunks.length > 0
    if (this.chunks.length > 0) {
      this.buildIndex(this.chunks)
    }
    return this.loaded
  }

  saveIndex(filepath) {
    const resolved = filepath || path.join(this.dataDir, 'index.json')
    const dir = path.dirname(resolved)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(resolved, JSON.stringify(this.chunks, null, 2), 'utf-8')
    console.log(`Index saved: ${this.chunks.length} chunks to ${resolved}`)
  }

  translateCsEn(text) {
    const map = this._translationMap()
    let result = text.toLowerCase().replace(/[.,!?;:]+$/, '')
    for (const [cs, en] of Object.entries(map)) {
      const regex = new RegExp('(^|\\s)' + cs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'gi')
      result = result.replace(regex, '$1' + en + ' ' + cs + '$2')
    }
    return result
  }

  translateToEnglish(text) {
    const map = this._translationMap()
    let result = text.toLowerCase().replace(/[.,!?;:]+$/, '')
    for (const [cs, en] of Object.entries(map)) {
      const regex = new RegExp('(^|\\s)' + cs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'gi')
      result = result.replace(regex, '$1' + en + '$2')
    }
    return result
  }

  _translationMap() {
    return {
      'vytvořit': 'create install', 'vytvořím': 'create install', 'vytvoříš': 'create install', 'vytvoří': 'create install', 'vytvoříme': 'create install',
      'vytvoření': 'creation', 'tvořit': 'create',
      'prostředí': 'environment setup', 'nastavení': 'setting configuration setup',
      'nastavit': 'set configure', 'nastavím': 'set configure', 'nastavíte': 'set configure', 'nastavili': 'set configure', 'nastavovat': 'set configure',
      'nasadit': 'deploy', 'nasazení': 'deploy deployment',
      'webový': 'web', 'webová': 'web', 'webové': 'web', 'aplikace': 'application', 'aplikaci': 'application',
      'stránka': 'page site', 'stránky': 'page site',
      'doména': 'domain', 'domény': 'domain', 'doménu': 'domain', 'domén': 'domain domains',
      'přístup': 'access', 'přihlásit': 'login', 'přihlášení': 'login',
      'uživatel': 'user', 'uživatele': 'user', 'heslo': 'password', 'klíč': 'key',
      'škálování': 'scaling scal', 'škálovat': 'scale scaling scal', 'zdroje': 'resources resource',
      'paměť': 'memory', 'ram': 'ram memory', 'cpu': 'cpu processor',
      'disk': 'disk storage', 'výkon': 'performance',
      'kontejner': 'container', 'kontejneru': 'container',
      'databáze': 'database', 'databázi': 'database',
      'bezpečnost': 'security', 'zabezpečení': 'security secure', 'certifikát': 'certificate', 'certifikáty': 'certificates', 'certifikátu': 'certificate', 'ssl': 'ssl',
      'síť': 'network', 'port': 'port', 'adresa': 'address', 'ip': 'ip',
      'monitorování': 'monitoring', 'monitorovat': 'monitor', 'sledování': 'monitoring tracking',
      'log': 'log', 'logy': 'log', 'chyba': 'error', 'chyby': 'error',
      'záloha': 'backup', 'zálohu': 'backup', 'zálohování': 'backup', 'obnova': 'restore recovery',
      'cena': 'price pricing', 'ceny': 'price pricing', 'platba': 'payment billing',
      'cloudlet': 'cloudlet', 'cloudlety': 'cloudlet',
      'dokumentace': 'documentation docs', 'nápověda': 'help documentation',
      'topologie': 'topology', 'průvodce': 'wizard guide',
      'load': 'load', 'balancer': 'balancer', 'loadbalancer': 'load balancer',
      'cluster': 'cluster', 'clusteru': 'cluster',
      'vertikální': 'vertical', 'horizontální': 'horizontal',
      'spustit': 'run start launch', 'spuštění': 'run start launch', 'běží': 'running',
      'smazat': 'delete remove', 'odstranit': 'delete remove',
      'přidat': 'add', 'přidání': 'add addition', 'změnit': 'change modify update', 'změna': 'change modify',
      'migrovat': 'migrate', 'migrace': 'migration migrate',
      'nainstalovat': 'install', 'instalace': 'installation install', 'instalovat': 'install', 'instaluji': 'install', 'instaluje': 'install', 'instalují': 'install', 'nainstaluji': 'install', 'nainstaluje': 'install',
      'nakonfigurovat': 'configure', 'konfigurace': 'configuration configure', 'nakonfiguruji': 'configure', 'nakonfiguruje': 'configure',
      'povolit': 'enable allow', 'zakázat': 'disable', 'povolím': 'enable allow', 'povolí': 'enable allow',
      'restartovat': 'restart', 'restart': 'restart', 'restartuji': 'restart',
      'připojit': 'connect attach', 'připojení': 'connection', 'připojím': 'connect', 'připojí': 'connect',
      'zobrazit': 'show view display', 'najít': 'find search', 'zobrazím': 'show', 'zobrazí': 'show',
      'fungovat': 'work function', 'funguje': 'work working',
      'vývojář': 'developer', 'vývojáře': 'developer', 'vývojářů': 'developer', 'vývojáři': 'developer',
      'zpřístupnit': 'expose make accessible', 'zpřístupním': 'expose make accessible', 'zpřístupní': 'expose make accessible', 'zpřístupníte': 'expose make accessible', 'zpřístupnění': 'exposing access',
      'přístupný': 'accessible available', 'přístupné': 'accessible available',
      'nachází': 'located find', 'nacházet': 'located',
      'umístit': 'place locate', 'uložit': 'save store',
      'soubor': 'file', 'soubory': 'files', 'cesta': 'path directory',
      'adresář': 'directory folder', 'složka': 'folder directory',
      'node': 'node', 'nodů': 'node', 'nody': 'node',
      'funkce': 'feature function',
      'službu': 'service', 'služba': 'service', 'služby': 'service services', 'službě': 'service',
      'aplikacní': 'application', 'aplikacni': 'application',
      'vystavit': 'expose', 'vystavím': 'expose', 'vystavíš': 'expose', 'vystaví': 'expose', 'vystavujeme': 'expose', 'vystavovat': 'expose',
      'přesměrování': 'redirect redirection', 'přesměrovat': 'redirect',
      'veřejný': 'public', 'veřejná': 'public',
    }
  }

  getDocText(chunk) {
    const url = chunk.url || ''
    const urlPath = decodeURIComponent(url.replace(/\/$/, ''))
    const urlTerms = urlPath.split(/[/-]/).filter(t => t.length > 2)
    return chunk.content + ' ' + urlTerms.join(' ')
  }

  search(query, topK = 5) {
    if (!this.loaded || this.chunks.length === 0) {
      return []
    }

    const enriched = this.translateCsEn(query)
    const queryTokens = this.tokenize(enriched)
    const uniqueQuery = [...new Set(queryTokens)]

    if (uniqueQuery.length === 0) return []

    const productDomains = {
      nginx: ['nginx.org', 'docs.nginx.com'],
      kubernetes: ['kubernetes.io', 'k8s.io'],
      traefik: ['doc.traefik.io'],
      apache: ['httpd.apache.org'],
      haproxy: ['docs.haproxy.org'],
      varnish: ['varnish-cache.org'],
      litespeed: ['docs.litespeedtech.com'],
      docker: ['docs.docker.com'],
      elasticsearch: ['elastic.co'],
      gitlab: ['docs.gitlab.com'],
      vault: ['hashicorp.com'],
      harbor: ['goharbor.io'],
      keycloak: ['keycloak.org'],
      nexus: ['sonatype.com'],
      kafka: ['kafka.apache.org'],
      argocd: ['argo-cd.readthedocs.io'],
      cloudsigma: ['docs.cloudsigma.com'],
    }

    const queryLower = query.toLowerCase()
    const matchedDomains = new Set()
    for (const [product, domains] of Object.entries(productDomains)) {
      if (uniqueQuery.includes(product) || queryLower.includes(product)) {
        for (const d of domains) matchedDomains.add(d)
      }
    }

    const docCount = this.chunks.length
    const docTexts = this.chunks.map(c => this.getDocText(c))

    const df = new Map()
    for (let i = 0; i < docCount; i++) {
      const terms = new Set(this.tokenize(docTexts[i]))
      for (const t of terms) {
        df.set(t, (df.get(t) || 0) + 1)
      }
    }

    const avgDocLen = docTexts.reduce((s, t) => s + this.tokenize(t).length, 0) / docCount
    const k1 = 1.5
    const b = 0.75

    const scores = []
    for (let i = 0; i < docCount; i++) {
      const docTerms = this.tokenize(docTexts[i])
      const docLen = docTerms.length
      let score = 0

      const termFreq = new Map()
      for (const t of docTerms) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1)
      }

      const urlPath = this.chunks[i].url || ''
      const urlTokens = new Set(urlPath.split(/[/-]/).filter(t => t.length > 2))

      for (const term of uniqueQuery) {
        const tf = termFreq.get(term) || 0
        if (tf === 0) continue
        const idf = Math.log(1 + (docCount - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5))
        let termScore = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))))
        if (urlTokens.has(term)) {
          termScore *= 2
        }
        score += termScore
      }

      if (score > 0) {
        scores.push({ index: i, score })
      }
    }

    // Boost scores for product-relevant domains
    if (matchedDomains.size > 0) {
      const boost = matchedDomains.size > 1 ? 2.5 : 2.0
      for (const s of scores) {
        const chunkUrl = this.chunks[s.index].url || ''
        if ([...matchedDomains].some(d => chunkUrl.includes(d))) {
          s.score *= boost
        }
      }
      if (matchedDomains.size > 1) {
        const virtDomains = ['www.virtuozzo.com']
        for (const s of scores) {
          const chunkUrl = this.chunks[s.index].url || ''
          if (virtDomains.some(d => chunkUrl.includes(d))) {
            s.score *= 1.3
          }
        }
      }
      scores.sort((a, b) => b.score - a.score)
      // Ensure at least one result from each matched domain appears in the final topK
      for (const domain of matchedDomains) {
        const domainResult = scores.find(s => this.chunks[s.index].url && this.chunks[s.index].url.includes(domain))
        if (domainResult && !scores.slice(0, topK).includes(domainResult)) {
          // Swap it in at position topK-1
          const insertAt = Math.min(topK - 1, scores.length - 1)
          const existingIdx = scores.indexOf(domainResult)
          if (existingIdx > insertAt) {
            scores.splice(existingIdx, 1)
            scores.splice(insertAt, 0, domainResult)
          }
        }
      }
    }

    scores.sort((a, b) => b.score - a.score)
    const top = scores.slice(0, topK)

    return top.map(s => ({
      ...this.chunks[s.index],
      score: s.score
    }))
  }

  formatContext(results) {
    if (!results || results.length === 0) return ''
    return results
      .map((r, i) => `[${i + 1}] ${this.cleanTitle(r.title)}\nURL: ${r.url || 'N/A'}\n${r.content.slice(0, 2000)}`)
      .join('\n\n---\n\n')
  }

  // Search each documentation source (domain) independently and return results
  // grouped by source, in the fixed SOURCES order (as in the answer template).
  searchPerSource(query, topKPerSource = 3, maxSources = 8, opts = {}) {
    if (!this.loaded || this.chunks.length === 0) return []

    const enriched = this.translateCsEn(query)
    const queryStop = new Set(['jak', 'jaký', 'jaká', 'jaké', 'jakuděl', 'který', 'která', 'které', 'se', 'si', 'pro', 'na', 'do', 'z', 'od', 's', 'v', 'a', 'o', 'i', 'u', 'je', 'jsou', 'nebo', 'ale', 'když', 'lze', 'můžu', 'může', 'budu', 'bude', 'jakto', 'co', 'jakse', 'jak_nastavit', 'jak_deploy', 'jak_skalovat', 'application', 'applic', 'app', 'resource', 'resourc', 'resources', 'setup', 'how', 'do', 'use', 'what', 'why', 'the', 'and', 'oran', 'are', 'can', 'with', 'for', 'into', 'where', 'when', 'which', 'this', 'that', 'these', 'those'])
    let uniqueQuery = [...new Set(this.tokenize(enriched))].filter(t => !queryStop.has(t))
    if (uniqueQuery.length === 0) return []

    const docCount = this.chunks.length
    const docTexts = this.chunks.map(c => this.getDocText(c))

    const df = new Map()
    for (let i = 0; i < docCount; i++) {
      const terms = new Set(this.tokenize(docTexts[i]))
      for (const t of terms) {
        df.set(t, (df.get(t) || 0) + 1)
      }
    }

    const avgDocLen = docTexts.reduce((s, t) => s + this.tokenize(t).length, 0) / docCount
    const k1 = 1.5
    const b = 0.75

    let groups = []
    let globalBest = 0
    for (const source of this.SOURCES) {
      const idxs = []
      for (let i = 0; i < docCount; i++) {
        const url = this.chunks[i].url || ''
        if (url.includes(source.host)) idxs.push(i)
      }
      if (idxs.length === 0) continue

      const scored = []
      for (const i of idxs) {
        const docTerms = this.tokenize(docTexts[i])
        const docLen = docTerms.length
        const termFreq = new Map()
        for (const t of docTerms) {
          termFreq.set(t, (termFreq.get(t) || 0) + 1)
        }
        const urlPath = this.chunks[i].url || ''
        const urlTokens = new Set(urlPath.split(/[/-]/).filter(t => t.length > 2))
        const titleTokens = new Set(this.tokenize(this.cleanTitle(this.chunks[i].title) || ''))
        let score = 0
        for (const term of uniqueQuery) {
          const tf = termFreq.get(term) || 0
          if (tf === 0) continue
          const idf = Math.log(1 + (docCount - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5))
          let termScore = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))))
          if (urlTokens.has(term)) {
            termScore *= 2
          }
          if (titleTokens.has(term)) {
            termScore *= 2.5
          }
          score += termScore
        }
        if (score > 0 && score > globalBest) globalBest = score
        if (score > 0) scored.push({ index: i, score })
      }
      if (scored.length === 0) continue

      scored.sort((a, b) => b.score - a.score)
      // Deduplicate by URL (keep the highest-scoring chunk of each page)
      const seen = new Set()
      const unique = []
      for (const s of scored) {
        const url = (this.chunks[s.index].url || '').replace(/\/$/, '')
        if (seen.has(url)) continue
        seen.add(url)
        unique.push(s)
        if (unique.length >= topKPerSource) break
      }
      groups.push({ source: source.host, label: source.header, results: unique.map(s => {
        const chunk = this.chunks[s.index]
        return { ...chunk, score: s.score, title: this.cleanTitle(chunk.title), __index: s.index }
      }) })
    }

    // Reorder into the fixed SOURCES order (Virtuozzo first, then CloudSigma, ...)
    const order = new Map(this.SOURCES.map((s, i) => [s.host, i]))
    groups.sort((a, b) => (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99))
    groups = groups.filter(g => g.results.length > 0)

    // Drop irrelevant sources: relative score floor against the global best match.
    const floor = Math.max(opts.minScore || 3, globalBest * 0.25)
    groups = groups.filter(g => g.results[0].score >= floor)

    // Expand each kept result into a window across its page: the scored chunk is often a
    // mid-page fragment, so pull in the previous and next chunks to get the real procedure
    // text ("open the topology wizard and use '+'/'−'…") into the model's context.
    const windowChars = opts.windowChars || 2200
    const byUrl = new Map()
    for (let i = 0; i < docCount; i++) {
      const u = (this.chunks[i].url || '').replace(/\/$/, '')
      if (!u) continue
      if (!byUrl.has(u)) byUrl.set(u, [])
      byUrl.get(u).push(i)
    }
    const expandChunk = (r) => {
      const u = (r.url || '').replace(/\/$/, '')
      const samePage = byUrl.get(u) || []
      const pos = samePage.indexOf(r.__index)
      let windowText = r.content || ''
      if (samePage.length > 1 && pos >= 0) {
        const start = Math.max(0, pos - 1)
        const end = Math.min(samePage.length, pos + 2)
        windowText = samePage.slice(start, end).map(i => this.chunks[i].content || '').join('\n')
      }
      return { ...r, title: this.cleanTitle(r.title), content: windowText.slice(0, windowChars) }
    }
    const result = []
    for (const g of groups) {
      const expanded = (g.results || []).map(r => {
        const e = expandChunk({ ...r, __index: r.__index })
        delete e.__index
        return e
      }).filter(r => (r.content || '').length > 0)
      result.push({ source: g.source, label: g.label, results: expanded })
    }
    groups = result.filter(g => g.results.length > 0)

    return groups.slice(0, maxSources)
  }

  // Format per-source search results into numbered sections, one per source,
  // in the fixed SOURCES order. Sources without hits get an explicit placeholder.
  // Truncated to honor the model's context window (drops whole trailing sources so
  // numbering stays aligned with the flat searchResults used for URL validation).
  formatSourceContext(groups, opts = {}) {
    const charsPerDoc = opts.charsPerDoc || 700
    const maxChars = opts.maxChars || 10000
    if (!this.SOURCES || this.SOURCES.length === 0) return ''
    const byHost = new Map((groups || []).map(g => [g.source, g]))
    let numbering = 0
    const sections = []
    let total = 0
    for (const source of this.SOURCES) {
      const g = byHost.get(source.host)
      const bodyParts = []
      if (g && g.results.length > 0) {
        for (const r of g.results) {
          const content = r.content ? r.content.slice(0, charsPerDoc) : ''
          const block = `[${numbering + 1}] ${r.title || 'Untitled'}\nURL: ${r.url || 'N/A'}\n${content}`
          bodyParts.push(block)
          numbering += 1
        }
      } else {
        bodyParts.push('(žádné dokumenty pro tento dotaz)')
      }
      const section = `${source.header}\n${bodyParts.join('\n\n')}`
      const glue = total === 0 ? 0 : 3
      if (total + glue + section.length > maxChars && total > 0) break
      sections.push(section)
      total += glue + section.length
    }
    return sections.join('\n\n---\n\n')
  }
}

module.exports = RAGEngine
