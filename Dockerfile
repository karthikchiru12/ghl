# ── Build stage: compile the Vue embed (JS + CSS → public/) ──────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY src/ ./src/
COPY vite.config.js ./

RUN npm run build:embed

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src/ ./src/
COPY server.js ./

# Embed assets compiled by Vite — not stored in the repo
COPY --from=builder /app/public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
