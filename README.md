# GHL Voice AI Observability Copilot

A HighLevel marketplace app that gives AI-powered call analytics directly inside the GHL UI — no tab switching, no external dashboards.

---

## What it does

| Feature | Details |
|---|---|
| **Call sync** | Pulls call logs from the HighLevel API for every installed location |
| **AI analysis** | Sends each call's transcript to Chutes AI (Minimax M2.5) and stores structured JSON: score, failures, recommendations, sentiment, empathy, script adherence, action items |
| **Overview dashboard** | KPI grid, agent performance table, score trend sparkline, top failures, missed opportunities, AI recommendations — all in one embedded card |
| **Agent deep-dive** | Per-agent view with score bar, dynamic data-collection and action-execution rates based on what *that* agent actually does |
| **Call drawer** | Click any call row → slide-in drawer with full analysis, transcript chat bubbles, and an "Analyze Now" button for un-analyzed calls |
| **Background scheduler** | Auto-syncs and analyzes every 6 hours across all installed locations with zero manual intervention |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       GHL Marketplace                        │
│   OAuth 2.0 install → POST /oauth/callback → token stored   │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────▼────────────────┐
          │         Express Server           │
          │  server.js  ·  src/routes/       │
          │                                  │
          │  /oauth/*          auth flow      │
          │  /api/locations/*  REST API       │
          │  /public/*         embed assets   │
          └──┬───────────────────────────────┘
             │
    ┌────────┴──────────┐
    │   PostgreSQL DB    │
    │                    │
    │  installations     │  OAuth tokens per location
    │  voice_agents      │  synced from GHL
    │  call_logs         │  raw + analyzed calls
    └────────────────────┘
             │
    ┌────────┴──────────────────────┐
    │     src/services/             │
    │                               │
    │  voiceAgents.js   GHL API     │
    │  callLogs.js      GHL API     │
    │  analysis.js      Chutes AI   │
    │  dashboard.js     DB queries  │
    │  scheduler.js     setInterval │
    └───────────────────────────────┘
             │
    ┌────────┴──────────────────────────────┐
    │         Embed (Vue 3 + Vite)           │
    │                                        │
    │  src/embed/main.js    IIFE bootstrap   │
    │  src/embed/App.vue    provide/inject   │
    │  src/embed/views/     route views      │
    │  src/embed/components/ reusable UI     │
    │  src/embed/composables/ reactive state │
    └────────────────────────────────────────┘
```

### Embed injection

GHL's `<script>` tag loads `ghl-voice-ai-observability-embed.js` from your server. The IIFE:

1. Checks `window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__` — exits if already mounted
2. Creates a `<div>` mount point in the page
3. Calls `createApp(App, { config })` — config carries `appId`, `apiBase`, `refreshMs`
4. All views share state via Vue `provide`/`inject`; the drawer uses `Teleport to="body"` to escape any overflow clip

### Multi-tenancy

Every API route is guarded by `requireLocationAccess` middleware which validates the `x-ghl-context` JWT (obtained via GHL's `exposeSessionDetails`) against the requesting location. All DB queries are scoped to `location_id`. A location never sees another location's data.

### Background scheduler

`src/services/scheduler.js` runs a `setInterval` every 6 hours (`.unref()` so it doesn't block process exit). On each tick it:
- Fetches all active installations from the DB
- For each location: syncs agents → syncs calls → analyzes pending calls

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Web server | Express 4 |
| Database | PostgreSQL (pg driver) |
| GHL integration | GHL OAuth 2.0 + REST API v2 |
| AI analysis | Chutes AI — Minimax M2.5 |
| Frontend | Vue 3 (Composition API, `<script setup>`) |
| Build | Vite 6 lib mode → single IIFE JS + CSS |
| Container | Docker multi-stage build |

---

## API routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth/install` | Redirect to GHL OAuth consent screen |
| `GET` | `/oauth/callback` | Exchange code for tokens, store installation |
| `GET` | `/api/locations/:id/dashboard` | Aggregated dashboard data (overview, agent breakdown, trends, recommendations, extraction rates, action execution rates) |
| `GET` | `/api/locations/:id/calls` | List calls; `?sync=true` pulls latest from GHL first |
| `GET` | `/api/locations/:id/calls/:callId` | Single call detail |
| `GET` | `/api/locations/:id/calls/:callId/analysis` | AI analysis for a call |
| `POST` | `/api/locations/:id/calls/:callId/analyze` | Run AI analysis on demand |
| `POST` | `/api/locations/:id/analyze-pending` | Analyze all un-analyzed calls |
| `GET` | `/api/locations/:id/agents` | List agents; `?sync=true` syncs from GHL |

All routes require a valid `x-ghl-context` token matching the location.

---

## Data model

### `call_logs`

| Column | Type | Description |
|---|---|---|
| `call_id` | text PK | GHL call ID |
| `location_id` | text | Tenant identifier |
| `agent_id` | text | Which voice AI agent handled the call |
| `started_at` | timestamptz | Call start time |
| `duration_seconds` | int | Call duration |
| `transcript_text` | text | Raw transcript |
| `transcript` | jsonb | Structured transcript `[{role, content}]` |
| `extracted_data` | jsonb | Agent-collected data fields (dynamic per agent) |
| `executed_actions` | jsonb | Actions the agent ran `[{actionType, ...}]` |
| `score` | int | 0-100 AI score |
| `summary` | text | One-sentence AI summary |
| `analysis_json` | jsonb | Full AI analysis blob |
| `analyzed_at` | timestamptz | When AI analysis ran |

---

## Dynamic agent metrics

Each agent is configured differently — one may collect `emailAddress` and `appointmentDate`; another may trigger `sendSms` and `bookAppointment`. The dashboard computes:

**Extraction rates** — for each `extracted_data` key seen across calls, what percentage of calls had that field populated. Computed with `CROSS JOIN LATERAL jsonb_object_keys()`.

**Action execution rates** — for each `actionType` seen across `executed_actions`, how many calls triggered it vs. total calls. Computed with `CROSS JOIN LATERAL jsonb_array_elements()`.

These appear in the **Agent Goals & Data Collection** section on both the overview and agent deep-dive views.

---

## Running locally

```bash
# Install all dependencies (including Vite/Vue devDeps)
npm install

# Build the embed — compiles src/embed/ → public/ (gitignored, created on build)
npm run build:embed

# Start the server
npm start
```

> `public/` is not committed to the repo. `npm run build:embed` creates it. You must run this before `npm start` or the embed assets won't be served.

Environment variables required (copy `.env.example`):

```
GHL_CLIENT_ID=...
GHL_CLIENT_SECRET=...
GHL_APP_ID=...
DATABASE_URL=postgres://...
CHUTES_API_KEY=...
SESSION_SECRET=...
APP_BASE_URL=https://your-domain.com
```

---

## Docker

```bash
docker build -t ghl-voice-ai-copilot .
docker run -p 3000:3000 --env-file .env ghl-voice-ai-copilot
```

The Dockerfile uses a two-stage build:
- **Builder** — installs all deps (including Vite/Vue), compiles `src/embed/` → `public/`
- **Runtime** — production deps only; `public/` is copied from the builder, never from the repo

The `public/` directory is gitignored and only ever exists as a build artifact.

---

## Ownership

Built solo as a take-home assignment. Every layer — OAuth flow, database schema, AI integration, background scheduler, Vue embed, CSS — was designed and implemented by one person.

### What is real vs. mocked

| | Status |
|---|---|
| GHL OAuth 2.0 flow | Real — full install/callback/token refresh |
| GHL API call sync | Real — pulls live call data via GHL v2 API |
| AI analysis (Chutes/Minimax) | Real — live LLM calls, structured JSON output |
| PostgreSQL persistence | Real — production schema, multi-tenant |
| Background scheduler | Real — `setInterval` auto-runs across all installations |
| GHL UI embed | Real — injects into GHL via marketplace `<script>` tag |

No data is mocked or hardcoded. The app requires a real GHL OAuth installation and a live database to function.
