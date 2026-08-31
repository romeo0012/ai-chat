const fs = require('fs')
const path = require('path')

class RAGEngine {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.chunks = []
    this.index = new Map()
    this.loaded = false
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9áčďéěíňóřšťúůýž\s-]/g, ' ')
      .split(/\s+/)
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
      'škálování': 'scaling', 'škálovat': 'scale', 'zdroje': 'resources resource',
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
      .map((r, i) => `[${i + 1}] ${r.title || 'Untitled'}\nURL: ${r.url || 'N/A'}\n${r.content.slice(0, 2000)}`)
      .join('\n\n---\n\n')
  }
}

module.exports = RAGEngine
