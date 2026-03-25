# HighLevel Voice AI Observability Copilot

A "Validation Flywheel" that integrates with GHL Marketplace via OAuth, syncs Voice Agents and Call Logs, and autonomously analyses call transcripts against agent-specific KPIs using Chutes AI (Minimax M2.5) to surface actionable recommendations.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser (Vue 3 SPA)                       │
│  KPI Cards │ Score Trend │ Agent Filter │ Analyses Grid │ Modal  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ REST / JSON
┌─────────────────────────▼───────────────────────────────────────┐
│                  Express.js  (Node 20, single process)           │
│                                                                  │
│  /install-url            OAuth install link                      │
│  /oauth/callback         Token exchange + session persist        │
│  /webhooks/ghl           INSTALL / UNINSTALL (HMAC verified)     │
│  /api/locations/:id/     Agents, Calls, Analyses, Dashboard      │
│  /health                 Liveness + DB connectivity check        │
└──────┬────────────────────────┬───────────────────────────────┘
       │                        │
┌──────▼──────────┐    ┌────────▼──────────────────────────────┐
│  GHL SDK v2.2   │    │          PostgreSQL 15                  │
│  voiceAi.*      │    │  ghl_sessions  │ locations             │
│  OAuth tokens   │    │  voice_agents  │ call_logs             │
│  Webhook HMAC   │    │  call_analyses (JSONB insights)        │
└─────────────────┘    └───────────────────────────────────────┘
                                 │
                       ┌─────────▼──────────────┐
                       │  Chutes AI  (Minimax M2.5)│
                       │  POST /v1/chat/completions│
                       │  Structured JSON output   │
                       │  Retry on 5xx errors      │
                       └──────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Vue 3 CDN (no build step) | Deploy as a single container — zero CI/CD complexity for SPA bundling |
| PostgreSQL session storage | Overrides GHL SDK's in-memory default → survives restarts, multi-instance safe |
| `ON CONFLICT DO UPDATE` everywhere | Idempotent resyncs — safe to hit "Fetch Calls" repeatedly without duplication |
| Chutes Minimax M2.5 @ temp=0.15 | Low temperature forces deterministic JSON; M2.5 produces reliably parseable outputs |
| Concurrency=3 batch analysis | Balances Chutes API rate limits against throughput for pending call batches |
| Retry on LLM 5xx / ECONNRESET | Transient Chutes infrastructure hiccups shouldn't fail an entire batch |

---

## Core Observability Loop

```
[GHL Voice Agent call ends]
         │
         ▼
  "Fetch Latest Calls"  ──►  GHL SDK voiceAi.getCallLogs()
         │                   Upserted into call_logs table
         ▼
  "Analyze Now"         ──►  For each unanalysed call:
         │                     1. Load transcript + agent context from DB
         │                     2. Build structured prompt (goals, KPIs, transcript)
         │                     3. POST to Chutes Minimax M2.5
         │                     4. Parse + validate JSON response
         │                     5. Upsert into call_analyses
         ▼
  Dashboard refresh     ──►  7 SQL queries (parallel):
         │                     • Overview KPIs (total, analysed, success rate, avg score, avg duration)
         │                     • Per-agent breakdown (score, pass rate)
         │                     • Top recurring failure themes (JSONB aggregation)
         │                     • Recent analyses (with agent name)
         │                     • 7-day daily score trend (sparkline data)
         ▼
  [Analyst acts on recommendations]
```

---

## Features

- **OAuth & Webhooks** — Standard GHL Marketplace OAuth flow with PostgreSQL-backed session storage for multi-tenancy. Webhook INSTALL/UNINSTALL events processed with HMAC signature verification.
- **Voice Agent Sync** — Pulls agents via `highLevel.voiceAi.getAgents()`. Goals and KPIs extracted from `agentPrompt` for analysis context.
- **Call Log Sync** — Pulls call logs via `highLevel.voiceAi.getCallLogs()`. Transcripts normalised to `[{role, content}]` format.
- **Autonomous LLM Analysis** — Minimax M2.5 evaluates each transcript against its agent's KPIs and returns a 7-field structured analysis: `success`, `score`, `failures`, `missed_opportunities`, `use_actions`, `prompt_recommendations`, `script_recommendations`.
- **Concurrent Batch Analysis** — Pending calls analysed 3 at a time via `Promise.allSettled`.
- **Unified Dashboard** — Six KPI cards, 7-day score sparkline, per-agent drill-down (click to filter), top recurring failure aggregation, paginated analysis cards with agent name + call duration.
- **Full Insight Modal** — All five LLM insight categories shown (failures, required actions, missed opportunities, prompt improvements, script improvements). Re-analyze without closing the modal.
- **Auto-Refresh** — Optional 30-second polling for live environments.
- **Health Endpoint** — `GET /health` verifies DB connectivity and reports `db: ok/error` for load balancer health checks.

---

## Team of One Ownership

### Product
Scoped strictly to the two observability loops defined in the brief: Monitor (ingest + identify deviations) and Analyse (actionable recommendations). No scope creep into agent editing or CRM features. Each dashboard section maps directly to a decision a Voice AI manager would make: "Which agent is underperforming?", "What's the trending failure?", "What should I change in this agent's prompt?"

### Design
Dark-mode glassmorphism aesthetic chosen for visual hierarchy in dense data contexts. Color-coded scoring (green/yellow/red) provides instant health status at a glance. The modal uses a split-pane layout so transcript and insights are simultaneously readable without scrolling. Agent cards are clickable filters — discovery of this feature is intentional (hover reveals cursor + tooltip).

### Engineering
- **No raw SQL strings scattered through routes** — all queries live in service functions (`services/`) with typed return shapes
- **No secrets in code** — all config via environment variables, validated at startup
- **Idempotency by default** — every sync operation is safe to re-run
- **Error boundaries** — LLM parse failures, SDK errors, and DB errors all return structured `{ ok: false, error }` responses; no unhandled rejections crash the process
- **Structured logging** — every module has a named logger (`createLogger('module-name')`) with level filtering via `LOG_LEVEL` env var

### QA
- LLM outputs are schema-validated and bounds-checked (score clamped 0-100, all array fields defaulted)
- JSON extraction handles both raw JSON and markdown-fenced responses from the LLM
- OAuth edge cases (no token, expired session) surface as `401` with clear messages rather than silent failures

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness + DB check |
| `GET` | `/install-url` | Returns GHL OAuth install URL |
| `GET` | `/oauth/callback` | Exchanges code for token, persists session |
| `POST` | `/webhooks/ghl` | GHL INSTALL/UNINSTALL webhook receiver |
| `GET` | `/api/locations` | List installed locations |
| `GET` | `/api/locations/:id/agents?sync=true` | List (or sync) voice agents |
| `GET` | `/api/locations/:id/calls?sync=true&limit=50` | List (or sync) call logs |
| `GET` | `/api/locations/:id/calls/:callId` | Get single call detail |
| `POST` | `/api/locations/:id/calls/:callId/analyze` | Analyse a specific call |
| `GET` | `/api/locations/:id/calls/:callId/analysis` | Get stored analysis |
| `POST` | `/api/locations/:id/analyze-pending?limit=20` | Batch-analyse unanalysed calls |
| `GET` | `/api/locations/:id/dashboard?limit=10` | Dashboard summary (all KPIs) |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_SSL` | No | `false` / `true` / `require` / `verify` |
| `HIGHLEVEL_CLIENT_ID` | Yes* | GHL OAuth client ID |
| `HIGHLEVEL_CLIENT_SECRET` | Yes* | GHL OAuth client secret |
| `HIGHLEVEL_REDIRECT_URI` | Yes* | OAuth callback URL |
| `HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN` | Yes* | Alternative to OAuth — PIT auth |
| `CHUTES_API_KEY` | Yes | Chutes AI API key |
| `CHUTES_BASE_URL` | No | Defaults to `https://llm.chutes.ai/v1` |
| `CHUTES_MINIMAX_MODEL` | No | Defaults to `minimaxai/Minimax-M2.5` |
| `PORT` | No | Express port (default `3000`) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default `info`) |

*Either PIT **or** all three OAuth vars must be set.

---

## Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, HIGHLEVEL_* OAuth vars, CHUTES_API_KEY

# 3. Start (initialises DB schema automatically on first run)
npm start
```

Visit `http://localhost:3000`. Navigate to `/install-url` to begin the OAuth install flow for your GHL sandbox location.

### Docker Compose

```bash
docker-compose up --build
```

Starts both the app (port 3000) and a PostgreSQL 15 instance. The app waits for the DB health check before starting.

### Deploy to Dokploy

1. Create an App in Dokploy, link this Git repository.
2. Add a PostgreSQL database, copy the connection string to `DATABASE_URL` in the environment tab.
3. Set all required env vars.
4. Deploy — the `Dockerfile` handles the rest.

---

## What Is Real vs Mocked

| Feature | Status | Notes |
|---|---|---|
| GHL OAuth token exchange | **Real** | Full PKCE-style code→token flow |
| Webhook HMAC verification | **Real** | SDK's `WebhookManager` validates signatures |
| Voice Agent sync | **Real** | `voiceAi.getAgents()` via SDK |
| Call Log sync | **Real** | `voiceAi.getCallLogs()` via SDK |
| LLM transcript analysis | **Real** | Calls `llm.chutes.ai/v1/chat/completions` |
| Dashboard aggregation | **Real** | Live SQL across all linked tables |
| Real-time call ingestion | **Pull-based** | Calls must be fetched via UI trigger (no push webhook per-call in sandbox) |
| Audio transcription | **Not implemented** | Transcripts consumed as-is from GHL (no Whisper/STT layer needed) |
