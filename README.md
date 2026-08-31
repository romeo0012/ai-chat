# AI Chat (PaaS Docs Assistant)

AI chat with RAG (retrieval-augmented generation) over Virtuozzo Application Platform / PaaS help documentation, with multilingual answers (EN/DE/CZ) and product-documentation lookup for third-party tools.

## Požadavky

- Node.js (testováno na v26)
- Python 3 + FastAPI/uvicorn (pouze pro volitelný GPT fallback)

## Instalace a spuštění

```bash
npm ci && npm start
```

Aplikace běží na `http://localhost:3000`. Přepíšeš přes `PORT` env.

Za reverzní proxy s base path (např. `/paasasistent`):

```bash
BASE_PATH=/paasasistent npm start
```

Poté je app na `http://localhost:3000/paasasistent/`.

## Konfigurace (`.env`)

Kopíruj ze šablony: `cp .env.example .env`

| Proměnná | Význam | Default |
|---|---|---|
| `PORT` | port serveru | `3002` |
| `BASE_PATH` | prefix base path za reverzní proxy | — |
| `LLM_ENDPOINT` | OpenAI-kompatibilní LLM endpoint | `http://193.85.150.110:8000` |
| `LLM_MODEL` | název modelu | `mistralai/Mistral-7B-Instruct-v0.3` |
| `LLM_API_KEY` | API klíč LLM endpointu | — |
| `HELP_URL` | dokumentace ke scrapování | virtuozzo.com app docs |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | GPT fallback (FastAPI) | — / `gpt-5.5` |
| `FALLBACK_URL` | adresa FastAPI služby | `http://localhost:8001` |

> Nikdy nekomitovat `.env` s reálnými klíči — viz `.gitignore`.

## Deployment na CodeNow

Projekt používá CodeNow (Kubernetes platforma) se stejným vzorem jako `iaas-api-mgmt`:

- `.codenow.yaml` — definice CI/CD (Dockerfile + helm descriptor)
- `codenow/config/environment-variables` — runtime environment proměnné aplikace (mirror `.env.example`)
- `Dockerfile` — produkční image (node:20-alpine, ne-root `USER 1000`, port `3002`)
- `helm/ai-chat/` — Helm chart (Deployment, Service, Secret, ConfigMap, Istio VirtualService)

Environment proměnné aplikace žijí v `codenow/config/environment-variables`. Reálné API klíče vkládej v CI/CD pipeline, ne commitovat.

- Exponovaný port aplikace: `3002` (shodně `.codenow.yaml runtime.port`, `Dockerfile EXPOSE`, `values.yaml service.port`)
- Externí endpoint přes `codenow.domainName` v Istio VirtualService

## Struktura

| Cesta | Význam |
|---|---|
| `server.js` | Entrypoint — Express + Socket.IO |
| `lib/` | `rag.js` (RAG engine), `llm.js` (LLM klient), `scraper.js` |
| `data/index.json` | RAG index (commitovaný) |
| `data/product-docs/` | raw dokumentace produktů (commitovaná) |
| `fallback/fastapi_app.py` | FastAPI GPT fallback |
| `public/` | statické client soubory |
