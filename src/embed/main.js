import './embed.css';
import { createApp } from 'vue';
import App from './App.vue';

(function () {
  if (window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__) return;
  window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__ = true;

  // ── Config ────────────────────────────────────────────────────────────────
  const injected = window.GHLVoiceAICopilotConfig || window.__GHL_COPILOT_CONFIG__ || {};
  const script   = document.currentScript;
  const appConfig = {
    appId:     injected.appId     || (script ? script.dataset.appId || '' : ''),
    apiBase:   injected.apiBase   || (script ? new URL(script.src).origin : window.location.origin),
    refreshMs: injected.refreshMs || 30_000,
  };

  // ── Route helpers ─────────────────────────────────────────────────────────
  function isVoiceAiRoute() {
    return window.location.pathname.includes('/ai-agents/voice-ai');
  }

  // ── Anchor: insert before "Calls Completed" just like the old embed ───────
  function findSummaryAnchor() {
    for (const el of document.querySelectorAll('*')) {
      if (!el.childElementCount && el.textContent.trim() === 'Calls Completed') {
        return closestBlock(el);
      }
    }
    // Fallback: Agent Name table header
    for (const th of document.querySelectorAll('th')) {
      if (th.textContent.trim() === 'Agent Name') {
        const table = th.closest('table');
        return table ? (table.parentElement || table) : null;
      }
    }
    return null;
  }

  function closestBlock(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const r = cur.getBoundingClientRect();
      if (r.width > 600 && r.height > 60) return cur;
      cur = cur.parentElement;
    }
    return el.parentElement;
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────
  let vueApp   = null;
  let mountEl  = null;

  function mountApp() {
    const anchor = findSummaryAnchor();
    if (!anchor) return; // GHL DOM not ready yet — tick will retry

    if (mountEl && document.body.contains(mountEl)) return; // already mounted

    mountEl = document.createElement('div');
    anchor.parentNode.insertBefore(mountEl, anchor);

    vueApp = createApp(App, { config: appConfig });
    vueApp.mount(mountEl);
  }

  function unmountApp() {
    if (vueApp) { vueApp.unmount(); vueApp = null; }
    if (mountEl) { mountEl.remove(); mountEl = null; }
  }

  // ── Tick — mirrors the old embed's setInterval(tick, scanMs) ─────────────
  function tick() {
    if (isVoiceAiRoute()) {
      if (!vueApp) mountApp();
    } else {
      if (vueApp) unmountApp();
    }
  }

  // Run immediately, then poll like the old embed did
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }

  setInterval(tick, 1500);
})();
