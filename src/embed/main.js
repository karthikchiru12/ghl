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

    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'edit') return false; // agent edit page — never show

    const isAgentPage = /\/ai-agents\/voice-ai\/[^/?]+/.test(path);
    if (!isAgentPage) return true; // root voice AI page — always show

    // Agent page — only on Dashboard & Logs tab
    const tab = params.get('tab');
    return !tab || tab === 'call_logs' || tab === 'dashboard_logs';
  }

  // ── Anchor finding ────────────────────────────────────────────────────────
  function normalizeText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function findElementByText(text) {
    return Array.from(document.querySelectorAll('body *')).find(
      (el) => el.children.length === 0 && normalizeText(el.textContent) === text
    ) || null;
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
    const callsEl = findElementByText('Calls Completed');
    if (callsEl) return closestBlock(callsEl);

    const agentNameEl = findElementByText('Agent Name');
    if (agentNameEl) {
      const table = agentNameEl.closest('table');
      return table ? (table.parentElement || table) : closestBlock(agentNameEl);
    }

    const tabContent = document.querySelector('[class*="tab-content"], [class*="tabContent"], [class*="tab-panel"]');
    if (tabContent) return tabContent;

    return null;
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────
  let vueApp     = null;
  let mountEl    = null;
  let retryCount = 0;
  let retryTimer = null;

  function mountApp() {
    if (vueApp && mountEl && document.body.contains(mountEl)) return;
    if (vueApp) unmountApp();

    let anchor = findSummaryAnchor();

    if (!anchor && retryCount > 3) {
      anchor = document.querySelector('.hl-main-content, main') || document.body;
    }

    if (!anchor) {
      retryCount++;
      retryTimer = setTimeout(mountApp, 1500);
      return;
    }

    retryCount = 0;
    mountEl = document.createElement('div');
    anchor.parentNode.insertBefore(mountEl, anchor);
    vueApp = createApp(App, { config: appConfig });
    vueApp.mount(mountEl);
  }

  function unmountApp() {
    clearTimeout(retryTimer);
    retryCount = 0;
    if (vueApp) { vueApp.unmount(); vueApp = null; }
    if (mountEl) { mountEl.remove(); mountEl = null; }
  }

  // ── URL change detection — hooks SPA navigation without MutationObserver ──
  function onNavigate() {
    if (isVoiceAiRoute()) {
      // Give GHL's SPA time to render before scanning for anchor
      setTimeout(mountApp, 300);
    } else {
      unmountApp();
    }
  }

  // Intercept history API calls (pushState / replaceState)
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method];
    history[method] = function (...args) {
      original.apply(this, args);
      onNavigate();
    };
  });

  // Back/forward button
  window.addEventListener('popstate', onNavigate);

  // Hash-based tab changes (GHL may change ?tab= without pushState)
  window.addEventListener('hashchange', onNavigate);

  // Lightweight URL poll — only unmounts, no DOM scanning
  setInterval(() => { if (vueApp && !isVoiceAiRoute()) unmountApp(); }, 1000);

  // ── Initial run ───────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isVoiceAiRoute()) mountApp();
    });
  } else {
    if (isVoiceAiRoute()) mountApp();
  }
})();
