# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install   # install dependencies
npm start     # start the server on http://localhost:3344
```

No build step, no test runner — plain Node.js + vanilla JS. Smoke-test modules with
`node --check <file>` and curl the `/api/*` endpoints against a running server.

## What this is

**Cowork LLM local**: a Node/Express app that is a chat-first "cowork" running entirely on
the user's machine. It routes between **free-only** models across providers (autonomously by
task type + provider health, or manually), keeps **Claude-style persistent memory** on disk,
supports **skills** and **artifacts**, and **auto-discovers new free models weekly**.
API keys live only in `.env` and never reach the browser.

## Architecture

**Server** (`server.js`) — wires the `lib/` modules and exposes the API. Builds the *effective
catalog* = base `catalog.js` + discovery overrides. Schedules weekly discovery (runs on startup
if >7 days since last run).

**`lib/` modules** (one responsibility each):
- `providers.js` — declarative `PROVIDERS` map; `callProvider` (anthropic/gemini/openai styles)
  and `listModels` (for discovery). All API keys read here. Add a provider = one entry here + one in `catalog.js`.
- `router.js` — **autonomous routing**. `classify()` buckets the message (code/vision/reasoning/fast)
  by heuristics (no LLM call); `pickAutoChain()` ranks the free-model pool by fit + recency, drops
  providers in cooldown, diversifies providers across fallback slots. Provider health persisted in `data/health.json`.
- `memory.js` — **persistent memory** in `data/memory/` (`MEMORY.md` index + one `.md` per fact with
  frontmatter). `recall()` keyword-scores memories; `processModelOutput()` extracts `<memory .../>` and
  `<forget .../>` tags the model emits and strips them from the visible reply.
- `skills.js` — **skills** in `data/skills/<name>/SKILL.md` (frontmatter + body). List injected into the
  system prompt; model invokes with `<skill name="..."/>` → server re-runs once with the skill body injected.
- `conversations.js` — chat history, one JSON per conversation in `data/conversations/`.
- `discovery.js` — weekly **free-model discovery**. Hits each provider's `/models`, removes curated free
  models that vanished, auto-adds new free ones where price is verifiable (OpenRouter `:free`/pricing 0,
  Gemini flash free tier). Writes `data/catalog.overrides.json` + `data/discovery-report.md`.
- `projects.js` — **connected folders**. A project = `{id, name, folder}` (in `data/projects.json`).
  `tree/readFile/writeFile` are confined to the root via `safeResolve` (no path traversal). The cowork
  reads/writes files in the folder through the agentic loop in `/api/chat`.
- `providers.generateImage()` — **free image gen**: Gemini `gemini-2.5-flash-image` (often 429 "limit:0"
  on free tier) → falls back to **Pollinations** (no key). Saved to `data/images/`, served at `/generated/`.
- `analyzer.js` + `pdfreport.js` — **folder analyzer** (deterministic, no LLM). `POST /api/projects/:id/analyze`
  walks the connected folder: size ranking, type classification, REAL duplicate detection (sha256 on
  size-colliding files, with per-file/budget caps to avoid downloading OneDrive online-only files),
  duplicate-folder detection by file-hash signature. Generates a real PDF (pdfkit) saved to
  `data/reports/`, served at `/reports/`. Frontend: "🔍 Analisar pasta" button in the Project panel.
- `rag.js` — **chat with your documents** (RAG). Free embeddings via Gemini `gemini-embedding-001`
  (`providers.embedTexts`, 768-dim, normalized). `POST /api/projects/:id/index` chunks+embeds text files
  → `data/rag/<id>.json`; chat retrieves top-k by cosine and injects them as cited sources. Frontend:
  "📚 Indexar p/ busca" button; "📚 N fontes" chip on answers.
- `websearch.js` — **free web search/fetch** (DuckDuckGo HTML, no key). Model emits `<websearch>`/`<webfetch>`;
  the agentic loop runs them when `web:true`. Toggle 🌐 in the input bar; answers list consulted links.
- `office.js` — **real .xlsx/.docx/.pptx** (exceljs/docx/pptxgenjs). Model emits `<xlsx name>CSV</xlsx>`,
  `<docx name>markdown</docx>`, `<pptx name>slides em markdown (--- separa slides)</pptx>`; `processOfficeTags`
  builds the file → `data/files/`, served at `/files/`, shown as a download card.
- `git.js` — **Git integration** for projects (status/diff/log/commit/init via child_process). Endpoints under
  `/api/projects/:id/git/*`; commit requires a user message (human approval). Frontend: "🔱 Git" modal (status,
  click-to-diff, commit box, history). Repo status is injected into the project system prompt.

**Streaming**: `providers.callProviderStream` (3 styles) + `POST /api/chat/stream` (SSE). Used when there's
no project/image/web; `stripForStream` hides control tags while streaming. Project/image/web use the blocking
`/api/chat` (agentic loop). **Vision**: messages may carry `images:[dataUrl]` → multimodal payload, routed to a
vision-capable model. **Diff/approval**: in a project, writes/commands become `pendingActions` (LCS diff) for the
user to approve via `/api/projects/:id/apply` and `/exec`; commands NEVER auto-run. **Context compaction**:
`compactMessages` summarizes old turns when history is long. Smoke tests: `npm test` (`test/smoke.js`, no network).

**Agentic file loop** (in `/api/chat`, only when `projectId` is set): the model emits `<listfiles/>`,
`<readfile path/>`, `<writefile path>…</writefile>`. Writes auto-apply (within the folder); reads/lists
feed back into a follow-up pass (up to 5 iterations) until the model gives a final text answer.
**Routing rationale**: `pickAutoChain` returns a human `reason` (e.g. "demanda simples — priorizei
velocidade") surfaced in the message meta and status chips. Image requests are detected by `classify()`
→ `image_gen`, or forced via the 🎨 button (`forceImage`).

**Frontend** (`public/`) — chat-first single screen:
- `index.html` — `.app` grid: sidebar (mode toggle, manual chain builder, conversation list,
  Memory/Skills/Models buttons) / chat / artifacts panel. Plus a generic modal.
- `app.js` — all logic. Auto/manual mode, sends to `/api/chat`, renders code blocks, opens **artifacts**
  (code blocks with a filename or `html` → side panel with code/preview/download), modals for
  memory/skills/discovery.
- `styles.css` — dark "operator panel" theme; vars for palette; fonts Space Grotesk / IBM Plex Sans / Mono.

**`catalog.js`** — base catalog (curated metadata: pricing, release dates, notes). The discovery
overrides correct/extend it at runtime, so stale IDs here are filtered out of the *effective* catalog.

## Key conventions

- **Free-only**: a model is free when `input === 0 && output === 0`. Manual builder and auto router only
  ever offer free models. Paid models stay in the catalog for reference but are never auto-selected.
- Chat request: `{conversationId?, messages, mode: "auto"|"manual", manualChain?, hasImage?}`.
- Chat response: `{ok, text, conversationId, usedProvider, usedModelId, usedName, usedFallbackLevel,
  category, mode, chain, attempts[], savedMemories[], forgotten[], invokedSkills[]}`.
- `usedFallbackLevel === 0` = principal responded; `>0` = a fallback answered.
- All runtime user data lives under `data/` (gitignored): `memory/`, `skills/`, `conversations/`,
  `catalog.overrides.json`, `health.json`, `discovery-report.md`.
- Model-emitted control tags (invisible to the user): `<memory name type desc>…</memory>`,
  `<forget name/>`, `<skill name/>`.

## Roadmap note (scope: "pessoal agora, Positivo depois")

Built lean for personal local use, but modular so it can later be adapted to Positivo IT standards
(approved stack, OpenTelemetry/Langfuse observability, layered security, human approval for destructive
AI actions). See the corporate skills (`stack-positivo`, `observabilidade-llm`, `seguranca-positivo`,
`adequacao-app-positivo`) when that adaptation is requested.
