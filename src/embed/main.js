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

  // ── Anchor finding ────────────────────────────────────────────────────────
  function findSummaryAnchor() {
    // 1. "Calls Completed" text — present on root voice AI page
    for (const el of document.querySelectorAll('*')) {
      if (!el.childElementCount && el.textContent.trim() === 'Calls Completed') {
        const block = closestBlock(el);
        if (block) return block;
      }
    }

    // 2. Agent Name table header — GHL agents table
    for (const th of document.querySelectorAll('th')) {
      if (th.textContent.trim() === 'Agent Name') {
        const table = th.closest('table');
        if (table) return table.parentElement || table;
      }
    }

    // 3. Agent page: tab content area (call_logs tab)
    const tabContent = document.querySelector('[class*="tab-content"], [class*="tabContent"], [class*="tab-panel"]');
    if (tabContent) return tabContent;

    // 4. Generic main content wrapper used in GHL's layout
    const main = document.querySelector('.hl-main-content, [class*="mainContent"], main[class]');
    if (main) return main.firstElementChild || main;

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
  let vueApp  = null;
  let mountEl = null;

  function mountApp() {
    // Already mounted and still in DOM — nothing to do
    if (vueApp && mountEl && document.body.contains(mountEl)) return;

    // If GHL's SPA removed our mountEl, fully unmount first
    if (vueApp) unmountApp();

    const anchor = findSummaryAnchor();
    if (!anchor) return; // DOM not ready yet — observer/interval will retry

    mountEl = document.createElement('div');
    anchor.parentNode.insertBefore(mountEl, anchor);

    vueApp = createApp(App, { config: appConfig });
    vueApp.mount(mountEl);
  }

  function unmountApp() {
    if (vueApp) { vueApp.unmount(); vueApp = null; }
    if (mountEl) { mountEl.remove(); mountEl = null; }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  function tick() {
    if (isVoiceAiRoute()) {
      mountApp();
    } else {
      if (vueApp) unmountApp();
    }
  }

  // ── MutationObserver — reacts immediately when GHL's SPA changes the DOM ──
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tick, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Interval fallback — catches URL changes the observer misses ───────────
  setInterval(tick, 1500);

  // ── Initial run ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
})();
