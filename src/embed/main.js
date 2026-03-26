import './embed.css';
import { createApp } from 'vue';
import App from './App.vue';

(function () {
  // IIFE guard — only mount once per page
  if (window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__) return;
  window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__ = true;

  // ── Derive apiBase from this script's own src ─────────────────────────
  // Works even when loaded inside GHL's iframe — no hardcoding needed.
  function getApiBase() {
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      if (s.src && s.src.includes('ghl-voice-ai-observability-embed')) {
        try { return new URL(s.src).origin; } catch (_) {}
      }
    }
    // Fallback: if served from the same origin (unlikely in GHL iframe)
    return window.location.origin;
  }

  // ── Config: read from window.GHLVoiceAICopilotConfig (set in custom JS) ──
  const injected = window.GHLVoiceAICopilotConfig || window.__GHL_COPILOT_CONFIG__ || {};
  const appConfig = {
    appId:     injected.appId     || '',
    apiBase:   injected.apiBase   || getApiBase(),
    refreshMs: injected.refreshMs || 30_000,
  };

  // ── Find the GHL embed anchor ─────────────────────────────────────────────
  function findAnchor() {
    return (
      document.getElementById('ghl-voice-ai-copilot-root') ||
      document.querySelector('[data-ghl-voice-ai-copilot]')
    );
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  function mount() {
    let anchor = findAnchor();
    if (!anchor) {
      // Create a mount point and append to the main content area or body
      anchor = document.createElement('div');
      anchor.id = 'ghl-voice-ai-copilot-root';
      const target =
        document.querySelector('.hl-main-content') ||
        document.querySelector('main') ||
        document.body;
      target.appendChild(anchor);
    }

    const mountEl = document.createElement('div');
    anchor.appendChild(mountEl);

    createApp(App, { config: appConfig }).mount(mountEl);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
