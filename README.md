# HighLevel Voice AI Observability Copilot

A complete Voice AI observability suite designed to act as a "Validation Flywheel." It integrates seamlessly via GHL Marketplace OAuth, syncs active Voice Agents and Call Logs, and autonomously analyzes transcripts against agent-specific KPIs using Chutes AI (Minimax M2.5 model) to surface actionable insights.

## Features

- **OAuth & Webhooks**: Retains GHL standard Marketplace OAuth and Webhook `INSTALL` flow.
- **Auto Sync**: Native pull of Agents and Call Logs from GHL's Voice AI endpoints using the V2 SDK (`highLevel.voiceAi.*`).
- **Autonomous Analysis**: Parses goals/KPIs from GHL agent prompts and evaluates call transcripts against them using the Minimax M2.5 LLM.
- **Actionable Insights**: Strictly outputs JSON defining success/failure, a scaled score, missed opportunities, and actionable prompt/script tweaks.
- **Unified Dashboard**: Fast, simple, and elegant Vue 3 SPA natively served by the Node.js backend to manage observability across multiple installed locations.
- **Stateless & Scalable DB**: Full PostgreSQL schema for locations, sessions, agents, call logs, and call analyses.

## Technical Architecture (Team of One approach)

### Product & Design
For an MVP built by one person, speed and aesthetic impact are vital:
- **Vue 3 (CDN) + Vanilla CSS**: Kept the UI dependency-free but achieved a polished, glassmorphism dark-mode aesthetic.
- **Single Monolith Server**: Removing a build step for the frontend ensures this is trivially deployable on Dokploy as a single container, significantly reducing CI/CD overhead.

### Engineering & Persistence
- **GHL API Client (v2.2.2)**: Heavily leverages the official SDK's interceptor and storage layers. Explicit bearer token bridging guarantees multi-tenancy holds up.
- **Postgres Session Storage**: Overrode the default SDK in-memory storage. Added persistent relational schemas with idempotent `init.js` so zero manual DB migrations are required.
- **Idempotent Logic**: `ON CONFLICT DO UPDATE` patterns are used everywhere. You can forcefully resync a location's agents or calls safely without duplicating data.

### QA & LLM Stability
- Prompt engineering dictates extremely rigid JSON outputs, preventing markdown leakage when parsing LLM observability recommendations.
- Catch-all global error boundaries wrap express handlers to prevent fatal application crashes on unhandled GHL response schemas.

## Current State: Real vs Mocked
- **Real**: 
  - OAuth flow, webhook payload signature processing, and token exchanges are 100% active.
  - Syncing of locations, GHL Voice Agents (`/voice-ai/agents`), and Call Logs (`/voice-ai/dashboard/call-logs`).
  - LLM analysis execution. `chutes.js` actually reaches out to `llm.chutes.ai/v1`, retrieves reasoning, validates JSON, and inserts into Postgres.
  - Dashboard dynamically groups data by selected location and handles loading states legitimately.
- **Mocked/Simulated**: 
  - The Chutes "Whisper" integration is omitted as transcript-first ingestion handles data adequately, satisfying the primary assessment requirement.
  - Webhook ingestion of individual calls in real-time is disabled for this assignment snippet—calls must be pulled via the dashboard's "Fetch Latest Calls" manual trigger for safety inside sandboxes.

## Run Locally

### Requirements
- Node.js 18+
- PostgreSQL server (running locally or Docker)

```bash
# 1. Install Dependencies
npm install

# 2. Configure Environment Variables
cp .env.example .env

# Make sure to edit .env to include your:
# - DATABASE_URL (e.g. postgres://user:pass@localhost:5432/ghl)
# - HIGHLEVEL_... OAuth or PIT vars 
# - CHUTES_API_KEY
```

```bash
# 3. Start the application
npm start
```

### Deploying to Dokploy
The included `Dockerfile` and `docker-compose.yml` enable 1-click deployment. Expose Port 3000 mapping internally, and ensure `DATABASE_URL` is set in the Dokploy environment tab.

1. Create an App in Dokploy.
2. Link your Git repository.
3. Add a PostgreSQL database in Dokploy, pass the connection string.
4. Deploy!

Head to `/` on the deployed domain to view the application. Navigate to `/install-url` if you want to perform a manual OAuth grant sequence.
