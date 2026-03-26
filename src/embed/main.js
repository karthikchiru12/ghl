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
    const path = window.location.pathname;
    if (!path.includes('/ai-agents/voice-ai')) return false;

    // Root voice AI page (no agent ID) — always show
    const isAgentPage = /\/ai-agents\/voice-ai\/[^/?]+/.test(path);
    if (!isAgentPage) return true;

    // Agent page — only show on Dashboard & Logs tab
    const tab = new URLSearchParams(window.location.search).get('tab');
    return !tab || tab === 'call_logs' || tab === 'dashboard_logs';
  }

  // ── Anchor finding — mirrors the old embed exactly ───────────────────────
  function normalizeText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function findElementByText(text) {
    return Array.from(document.querySelectorAll('body *')).find((el) => {
      return el.children.length === 0 && normalizeText(el.textContent) === text;
    }) || null;
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

  function findSummaryAnchor() {
    // 1. "Calls Completed" — root voice AI page (same as old embed)
    const callsEl = findElementByText('Calls Completed');
    if (callsEl) return closestBlock(callsEl);

    // 2. "Agent Name" table header — agents table (same as old embed)
    const agentNameEl = findElementByText('Agent Name');
    if (agentNameEl) {
      const table = agentNameEl.closest('table');
      return table ? (table.parentElement || table) : closestBlock(agentNameEl);
    }

    // 3. Agent page: "Dashboard & Logs" tab content
    const tabContent = document.querySelector('[class*="tab-content"], [class*="tabContent"], [class*="tab-panel"]');
    if (tabContent) return tabContent;

    return null;
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────
  let vueApp     = null;
  let mountEl    = null;
  let retryCount = 0;

  function mountApp() {
    // Already mounted and still in DOM — nothing to do
    if (vueApp && mountEl && document.body.contains(mountEl)) return;

    // If GHL's SPA removed our mountEl, fully unmount first
    if (vueApp) unmountApp();

    let anchor = findSummaryAnchor();

    // After ~5s of retries, fall back to main content wrapper
    if (!anchor && retryCount > 3) {
      anchor = document.querySelector('.hl-main-content, main') || document.body;
    }

    if (!anchor) { retryCount++; return; }
    retryCount = 0;

    mountEl = document.createElement('div');
    anchor.parentNode.insertBefore(mountEl, anchor);

    vueApp = createApp(App, { config: appConfig });
    vueApp.mount(mountEl);
  }

  function unmountApp() {
    if (vueApp) { vueApp.unmount(); vueApp = null; }
    if (mountEl) { mountEl.remove(); mountEl = null; }
    retryCount = 0;
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
