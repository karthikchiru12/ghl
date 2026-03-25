/**
 * Voice AI Observability Copilot — GHL Custom JS Widget
 *
 * Paste this script into your GHL sub-account:
 *   Settings → Custom Code → Body Tracking Code
 *
 * It injects a floating "Voice AI Copilot" button in the GHL interface.
 * Clicking it opens the observability dashboard in an embedded panel or new tab.
 *
 * The script auto-detects COPILOT_URL from its own src attribute,
 * so no manual editing is needed after deployment.
 */
(function () {
  'use strict';

  // ─── Configuration ─────────────────────────────────────────────────────
  // Auto-detect the app URL from the script's own src (works when loaded via <script src="https://your-app/ghl-widget.js">)
  var scripts = document.querySelectorAll('script[src*="ghl-widget"]');
  var scriptSrc = scripts.length ? scripts[scripts.length - 1].src : '';
  var COPILOT_URL = scriptSrc ? scriptSrc.replace(/\/ghl-widget\.js.*$/, '') : (window.__COPILOT_URL || '');

  // Try to extract locationId from the GHL URL (e.g. /v2/location/abc123/...)
  var match = window.location.pathname.match(/\/location\/([a-zA-Z0-9]+)/);
  var locationId = match ? match[1] : '';

  var iframeUrl = COPILOT_URL + '/?embed=1' + (locationId ? '&locationId=' + locationId : '');

  // ─── Floating Button ──────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.innerHTML = '🎙 Voice AI Copilot';
  btn.setAttribute('id', 'vai-copilot-btn');
  btn.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:99999',
    'background:#5e6ad2',
    'color:#fff',
    'border:none',
    'padding:12px 20px',
    'border-radius:12px',
    'font-size:14px',
    'font-weight:600',
    'font-family:Inter,system-ui,sans-serif',
    'cursor:pointer',
    'box-shadow:0 4px 20px rgba(94,106,210,0.4)',
    'transition:transform 0.2s,box-shadow 0.2s',
  ].join(';');

  btn.onmouseenter = function () {
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 8px 30px rgba(94,106,210,0.5)';
  };
  btn.onmouseleave = function () {
    btn.style.transform = '';
    btn.style.boxShadow = '0 4px 20px rgba(94,106,210,0.4)';
  };

  // ─── Slide-over Panel ─────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.setAttribute('id', 'vai-copilot-panel');
  panel.style.cssText = [
    'position:fixed',
    'top:0',
    'right:-480px',
    'width:480px',
    'height:100vh',
    'z-index:99998',
    'background:#0d1117',
    'border-left:1px solid rgba(255,255,255,0.1)',
    'box-shadow:-4px 0 30px rgba(0,0,0,0.5)',
    'transition:right 0.3s ease',
    'display:flex',
    'flex-direction:column',
  ].join(';');

  var panelHeader = document.createElement('div');
  panelHeader.style.cssText = [
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
    'padding:12px 16px',
    'border-bottom:1px solid rgba(255,255,255,0.1)',
    'background:rgba(13,17,23,0.95)',
    'flex-shrink:0',
  ].join(';');

  var title = document.createElement('span');
  title.textContent = 'Voice AI Copilot';
  title.style.cssText = 'color:#fff;font-weight:600;font-size:14px;font-family:Inter,system-ui,sans-serif;';

  var actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;';

  var expandBtn = document.createElement('button');
  expandBtn.textContent = '↗';
  expandBtn.title = 'Open in new tab';
  expandBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.2);color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:14px;';
  expandBtn.onclick = function () { window.open(iframeUrl, '_blank'); };

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'background:transparent;border:none;color:#8b949e;font-size:20px;cursor:pointer;padding:0 4px;';
  closeBtn.onclick = function () { togglePanel(false); };

  actions.appendChild(expandBtn);
  actions.appendChild(closeBtn);
  panelHeader.appendChild(title);
  panelHeader.appendChild(actions);

  var iframe = document.createElement('iframe');
  iframe.src = iframeUrl;
  iframe.style.cssText = 'flex:1;border:none;width:100%;';
  iframe.setAttribute('allow', 'microphone');

  panel.appendChild(panelHeader);
  panel.appendChild(iframe);

  // ─── Backdrop ─────────────────────────────────────────────────────────
  var backdrop = document.createElement('div');
  backdrop.setAttribute('id', 'vai-copilot-backdrop');
  backdrop.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99997',
    'background:rgba(0,0,0,0.3)',
    'display:none',
  ].join(';');
  backdrop.onclick = function () { togglePanel(false); };

  // ─── Toggle ───────────────────────────────────────────────────────────
  var isOpen = false;
  function togglePanel(open) {
    isOpen = typeof open === 'boolean' ? open : !isOpen;
    panel.style.right = isOpen ? '0' : '-480px';
    backdrop.style.display = isOpen ? 'block' : 'none';
  }

  btn.onclick = function () { togglePanel(); };

  // ─── Mount ────────────────────────────────────────────────────────────
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(btn);
})();
