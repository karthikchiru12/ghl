import './embed.css';
import { createApp } from 'vue';
import App from './App.vue';

(function () {
  // IIFE guard — only mount once per page
  if (window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__) return;
  window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__ = true;

  // ── Config injected by the server-rendered <script> tag ──────────────────
  // Falls back to window globals for flexibility
  const config = window.__GHL_COPILOT_CONFIG__ || {};
  const appConfig = {
    appId:     config.appId     || '',
    apiBase:   config.apiBase   || window.location.origin,
    refreshMs: config.refreshMs || 30_000,
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
