# AI Chat – PaaS Docs Assistant

Interaktivní AI chat s **RAG** (retrieval-augmented generation) nad oficiální dokumentací Virtuozzo Application Platform / PaaS, s vícejazyčnými odpověďmi (**CZ/EN/DE**) a lookupem do dokumentací třetích stran (Kubernetes, Nginx, Apache, CloudSigma, HAProxy, Traefik, Varnish, LiteSpeed, Elasticsearch, GitLab, Vault, Nexus, Keycloak, Kafka, Harbor, Docker, ArgoCD).

Rozhraní je webová aplikace: **Node.js + Express + Socket.IO** backend, statický frontend (`public/`). Odpovědi se generují přes OpenAI-kompatibilní LLM endpoint (Mistral), s volitelným fallbackem na **ChatGPT (GPT-5.5)** přes FastAPI službu.

---

## Funkční popis

### Chat a odpovědi

- Uživatel pošle dotaz (WebSocket `message` s `{ text, lang }`).
- Server přeloží dotaz do angličtiny, spustí **RAG search** v indexu dokumentace (topK=5) a zabuduje nalezené pasáže do systémového promptu jako kontext.
- LLM generuje odpověď v jazyce rozhraní (CZ/EN/DE) a streamuje ji po chuncích do UI (`assistant-start` / `assistant-chunk` / `assistant-end`).
- Pokud RAG nalezne relevantní kontext, přidá se navíc blok **„Odpověď ChatGPT"** z FastAPI fallbacku.
- Pokud RAG nic nenajde, použije se buď FastAPI fallback, nebo (při jeho nedostupnosti) Mistral s promptem, který výslovně zakazuje vymýšlet si informace.

### Multilingvita

- Tři jazyky: **čeština (cz)**, **angličtina (en)**, **němčina (de)** — přepíná se vlaječkami v headeru.
- Jazyk se posílá s každou zprávou a řídí jazyk odpovědi i text dokumentací (`/docs/{lang}/…`).
- Při změně jazyka se **přeloží uživatelské dotazy v historii chatu** i **dotazy v FAQ panelu** (přes dedikovaný `translateQuestionWithLLM`, který vrací jen otázku, ne odpověď).

### FAQ panel

- „Nejčastější dotazy" — server si eviduje dotazy uživatelů (`updateFaq` / `broadcastFaq`, max 12 nejčastějších) a posílá je do UI (`faq-update`).
- Kliknutí na FAQ otázku ji vloží do vstupu a odešle jako běžný dotaz.
- Při změně jazyka se FAQ přeloží.

### Odkazy v odpovědích (dokumentace)

- Virtuozzo URL v odpovědi se přepisují na lokální proxy `/docs/{lang}/…` (server `getTranslatedDoc`):
  - Z načtené stránky se vyextrahuje HTML obsah, vloží se obrázky (`injectImages`, lokální cesty `/images/docs/…`) a stránka se **přeloží on-demand** pomocí LLM (dávkově po chuncích).
  - Překlad se **cacheuje na disk** do `docs_cache` (v produkci do writable `/tmp/docs_cache` — viz sekce CodeNow).
  - Odpověď zahrnuje jen odkazy, které skutečně existují v uvedeném kontextu (falešné URL se mažou).
- Odkazy na dokumentace produktů se přepisují na `/p/{lang}/{product}/…` (`getProductTranslatedDoc`) přes `PRODUCT_BASE_URLS` — např. `nginx.org` + `docs.nginx.com`, CloudSigma apod.
- Produktové dokumenty se také překládají a cacheují stejným mechanismem.

### Filtrování obsahu

- Specifická pravidla potlačují nežádoucí zmínky (např. WordPress/PHP v irelevantních odpovědích) a čistí odpověď od falešných/nedůvěryhodných URL (LLM občas generuje odkazy, které v kontextu nejsou — ty se odstraňují, případně se `[N]` reference mění na klikatelné odkazy na skutečné zdroje).

---

## Architektura

```
┌──────────────┐  WebSocket (Socket.IO)  ┌─────────────────────────────┐
│  Frontend    │ ───────────────────────▶ │  server.js (Express+Socket.IO)│
│  public/     │ ◀─────────────────────── │  - RAG engine (lib/rag.js)   │
│  index.html  │                          │  - předávání kontextu do LLM │
│  main.js     │                          │  - /docs a /p proxy          │
│  style.css   │                          │  - FAQ, jazykové překlady     │
└──────────────┘                          └───────────┬─────────────────┘
                                                    │
                        ┌───────────────┬────────────┴───────────┐
                        ▼               ▼                        ▼
              ┌────────────────┐  ┌────────────────┐   ┌─────────────────────┐
              │ LLM (vLLM/TGI) │  │ RAG index      │   │ FastAPI fallback    │
              │ Mistral-7B     │  │ data/index.json│   │ (fallback/…)        │
              │ /v1/chat/...   │  │ 2800 chunků    │   │ GPT-5.5 (OpenAI)    │
              └────────────────┘  └────────────────┘   └─────────────────────┘
```

### Komponenty

| Komponenta | Popis |
|---|---|
| `server.js` | Entrypoint. Express (HTTP + REST) + Socket.IO (real-time chat, stream), správa jazyka, RAG, překlady dokumentací, FAQ, deployment proxy `/docs` a `/p`. |
| `lib/llm.js` | Klient OpenAI-kompatibilního LLM endpointu (`LLMClient`) — JSON i streaming (`/v1/chat/completions`), bearer auth volitelně. |
| `lib/rag.js` | `RAGEngine` — načítání indexu, `search()` s doménovým boostem (2.0× jednoprodukt, 2.5× multiprodukt, Virtuozzo 1.3× na multiprodukt; garantuje aspoň 1 výsledek z každé domény v topK), `translateCsEn()`/`translateToEnglish()`, formátování kontextu. |
| `lib/scraper.js` | Scraper na sběr dokumentace (robustní resolve relativních URL). |
| `fallback/fastapi_app.py` | FastAPI služba, která volá OpenAI GPT-5.5, když RAG nemá odpověď. |
| `public/` | Statický frontend (index.html, main.js, style.css, vlaječky, obrázky screenshotů). |

### RAG index a data

- `data/index.json` — **2800 chunků, 16386 unikátních termínů** ze 19 domén.
- `data/product-docs/*.json` — surové dokumentace produktů (rebuild indexu).
- `data/docs_cache/` — přeložené stránky dokumentace (commitované, seedují se do writable cache).
- `data/page-images.json` — mapa obrázků stránek (regenerovatelná, gitignored).

**Domény v indexu:** virtualoozzo.com (526), docs.cloudsigma.com (575), httpd.apache.org (423), nginx.org (398), kubernetes.io (156), argo-cd.readthedocs.io (122), docs.nginx.com (93), docs.docker.com (87), docs.haproxy.org (74), www.keycloak.org (60), www.elastic.co (58), docs.gitlab.com (41), developer.hashicorp.com (38), doc.traefik.io (36), help.sonatype.com (35), kafka.apache.org (22), docs.litespeedtech.com (22), goharbor.io (20), varnish-cache.org (14).

### REST / Socket.IO rozhraní

| Endpoint | Význam |
|---|---|
| `GET /` | index.html (s injektovaným Socket.IO clientem a `window.BASE_PATH`) |
| `GET /docs/{lang}/{path}` | přeložená Virtuozzo dokumentační stránka |
| `GET /p/{lang}/{product}/{path}` | přeložená produktová dokumentační stránka |
| `GET /api/...` | REST (nevlastní, hlavní komunikace je přes Socket.IO) |
| Socket `message` | odeslání dotazu, stream odpovědi |
| Socket `set-language` | změna jazyka → překlad historie + FAQ |
| Socket `clear` | smazání konverzace |
| Socket `faq-update` | broadcast FAQ seznamu |

---

## Požadavky

- Node.js (testováno na v26)
- Python 3 + FastAPI/uvicorn (jen pro volitelný OpenAI/GPT fallback)

## Instalace a spuštění

```bash
npm ci && npm start
```

Aplikace běží na `http://localhost:3000` (přepíšeš přes `PORT` env).

Za reverzní proxy s base path (např. `/paasasistent`):

```bash
BASE_PATH=/paasasistent npm start
```

Poté je app na `http://localhost:3000/paasasistent/`. Funguje se Socket.IO (auto-konfigurace path) i `/docs/` proxy.

### FastAPI fallback (volitelně)

```bash
python3 -m uvicorn fallback.fastapi_app:app --host 0.0.0.0 --port 8001
```

Musí běžet, pokud chcete ChatGPT odpovědi; jinak fallback tiše přeskakne.

## Konfigurace (`.env`)

Kopíruj ze šablony: `cp .env.example .env`

| Proměnná | Význam | Default |
|---|---|---|
| `PORT` | port serveru | `3002` |
| `BASE_PATH` | prefix base path za reverzní proxy | — |
| `LLM_ENDPOINT` | OpenAI-kompatibilní LLM endpoint | `http://193.85.150.110:8000` |
| `LLM_MODEL` | název modelu | `mistralai/Mistral-7B-Instruct-v0.3` |
| `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | parametry LLM | `0.3` / `2048` |
| `LLM_API_KEY` | API klíč LLM endpointu | — |
| `DOCS_CACHE_DIR` | kam se cacheují překlady dokumentací (auto-fallback na `/tmp`) | `data/docs_cache` |
| `HELP_URL` | dokumentace ke scrapování | virtuozzo.com app docs |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | ChatGPT fallback (FastAPI) | — / `gpt-5.5` |
| `FALLBACK_URL` | adresa FastAPI služby | `http://localhost:8001` |

> Nikdy nekomitovat `.env` s reálnými klíči — viz `.gitignore`.

---

## Deployment na CodeNow

Projekt používá CodeNow (Kubernetes platforma) se stejným vzorem jako `iaas-api-mgmt`:

- `.codenow.yaml` — definice CI/CD (Dockerfile + helm descriptor; build image `node:20.18.1`, runtime port `3002`)
- `codenow/config/environment-variables` — runtime environment proměnné aplikace (mirror `.env.example`)
- `Dockerfile` — produkční image (node:20-alpine, ne-root `USER 1000`, port `3002`)
- `helm/ai-chat/` — Helm chart (Deployment, Service, Secret, ConfigMap, Istio VirtualService)

### Důležité provozní poznámky pro CodeNow

- **Socket.IO client** se do index.html injektuje vždy (i bez `BASE_PATH`), takže odeslání dotazu funguje na root path.
- **Read-only rootfs** v podu: app automaticky zjistí, že `data/docs_cache` není zapisovatelná, a spadne na **writable `/tmp/docs_cache`** (tmpfs, který helm mountuje na `/tmp`). Commitované překlady se na startu seedují z `data/docs_cache` do `/tmp`.
- **Reálné API klíče** (`LLM_API_KEY`, `OPENAI_API_KEY`) se **necommitují** (repo je veřejné) — nastavují se jako **secret v CodeNow platformě/CI**; blank hodnoty jsou v `environment-variables` zakomentované, aby nepřepsaly platformí secret.
- Externí endpoint přes `codenow.domainName` v Istio VirtualService (např. `tmobile-demo.codenow.com`).

---

## Struktura

| Cesta | Význam |
|---|---|
| `server.js` | Entrypoint — Express + Socket.IO, RAG, překlady, FAQ, proxy `/docs` + `/p` |
| `lib/llm.js` | LLM klient (OpenAI-kompatibilní, JSON + stream) |
| `lib/rag.js` | RAG engine (index, search s doménovým boostem, překlad dotazu) |
| `lib/scraper.js` | Scraper dokumentace |
| `data/index.json` | RAG index (commitovaný, 2800 chunků) |
| `data/product-docs/` | surové dokumentace produktů (commitované) |
| `data/docs_cache/` | přeložené dokumentační stránky (commitované, seedují se do writable cache) |
| `fallback/__init__.py`, `fallback/fastapi_app.py` | FastAPI GPT fallback |
| `public/` | statický frontend (index.html, main.js, style.css, obrázky) |
| `codenow/` | CodeNow deployment config (`.codenow.yaml`, `config/environment-variables`) |
| `helm/ai-chat/` | Helm chart pro CodeNow |
| `scripts/` | batch scripty (scrape, translate, inject-images, crawl product docs) |

## Poznámky a omezení

- `docs_cache` a `page-images.json` jsou regenerovatelné cache; `docs_cache` je nyní committing (kvůli read-only produkci), `page-images.json` zůstává gitignored.
- `/tmp/docs_cache` (seed z obrazu) se po restartu podu ztratí a znovu naplní z commitovaných dat.
- RAG topK=5; relevantnost se dál filtruje porovnáním technických termínů z dotazu proti obsahu výsledků.
