/**
 * Voice AI Observability Copilot — GHL Custom JS Widget
 *
 * Paste this script into your GHL sub-account:
 *   Settings → Custom Code → Body Tracking Code
 *
 * The script auto-detects COPILOT_URL from its own src attribute,
 * so no manual editing is needed after deployment.
 */
(function () {
  'use strict';

  // ─── Configuration ─────────────────────────────────────────────────────
  var scripts = document.querySelectorAll('script[src*="ghl-widget"]');
  var scriptSrc = scripts.length ? scripts[scripts.length - 1].src : '';
  var COPILOT_URL = scriptSrc ? scriptSrc.replace(/\/ghl-widget\.js.*$/, '') : (window.__COPILOT_URL || '');

  var match = window.location.pathname.match(/\/location\/([a-zA-Z0-9]+)/);
  var locationId = match ? match[1] : '';
  var iframeUrl = COPILOT_URL + '/?embed=1' + (locationId ? '&locationId=' + locationId : '');

  // ─── Panel sizing ──────────────────────────────────────────────────────
  var PANEL_WIDTH = Math.min(900, Math.round(window.innerWidth * 0.55));
  var isWide = false;

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

  // ─── Panel ────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.setAttribute('id', 'vai-copilot-panel');

  function setPanelWidth(w) {
    panel.style.width = w + 'px';
    panel.style.right = isOpen ? '0' : '-' + w + 'px';
  }

  panel.style.cssText = [
    'position:fixed',
    'top:0',
    'right:-' + PANEL_WIDTH + 'px',
    'width:' + PANEL_WIDTH + 'px',
    'height:100vh',
    'z-index:99998',
    'background:#0d1117',
    'border-left:1px solid rgba(255,255,255,0.1)',
    'box-shadow:-4px 0 30px rgba(0,0,0,0.5)',
    'transition:right 0.3s ease,width 0.3s ease',
    'display:flex',
    'flex-direction:column',
  ].join(';');

  // ─── Panel Header ─────────────────────────────────────────────────────
  var panelHeader = document.createElement('div');
  panelHeader.style.cssText = [
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
    'padding:10px 16px',
    'border-bottom:1px solid rgba(255,255,255,0.1)',
    'background:rgba(13,17,23,0.95)',
    'flex-shrink:0',
  ].join(';');

  var title = document.createElement('span');
  title.textContent = 'Voice AI Copilot';
  title.style.cssText = 'color:#fff;font-weight:600;font-size:14px;font-family:Inter,system-ui,sans-serif;';

  var actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;align-items:center;';

  var btnStyle = 'background:transparent;border:1px solid rgba(255,255,255,0.15);color:#c9d1d9;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit;';

  // Expand / collapse toggle
  var wideBtn = document.createElement('button');
  wideBtn.textContent = '⬌';
  wideBtn.title = 'Toggle full width';
  wideBtn.style.cssText = btnStyle;
  wideBtn.onclick = function () {
    isWide = !isWide;
    var w = isWide ? Math.round(window.innerWidth * 0.85) : PANEL_WIDTH;
    setPanelWidth(w);
    wideBtn.textContent = isWide ? '⬌' : '⬌';
    wideBtn.title = isWide ? 'Collapse panel' : 'Expand to full width';
  };

  // Open in new tab
  var expandBtn = document.createElement('button');
  expandBtn.textContent = '↗ New Tab';
  expandBtn.title = 'Open in new tab';
  expandBtn.style.cssText = btnStyle;
  expandBtn.onclick = function () { window.open(iframeUrl, '_blank'); };

  // Close
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'background:transparent;border:none;color:#8b949e;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
  closeBtn.onclick = function () { togglePanel(false); };

  actions.appendChild(wideBtn);
  actions.appendChild(expandBtn);
  actions.appendChild(closeBtn);
  panelHeader.appendChild(title);
  panelHeader.appendChild(actions);

  // ─── Iframe ───────────────────────────────────────────────────────────
  var iframe = document.createElement('iframe');
  iframe.src = iframeUrl;
  iframe.style.cssText = 'flex:1;border:none;width:100%;height:100%;';
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
    'transition:opacity 0.3s',
  ].join(';');
  backdrop.onclick = function () { togglePanel(false); };

  // ─── Toggle ───────────────────────────────────────────────────────────
  var isOpen = false;
  function togglePanel(open) {
    isOpen = typeof open === 'boolean' ? open : !isOpen;
    var w = isWide ? Math.round(window.innerWidth * 0.85) : PANEL_WIDTH;
    panel.style.right = isOpen ? '0' : '-' + w + 'px';
    backdrop.style.display = isOpen ? 'block' : 'none';
    btn.style.display = isOpen ? 'none' : 'block';
  }

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) togglePanel(false);
  });

  btn.onclick = function () { togglePanel(true); };

  // ─── Mount ────────────────────────────────────────────────────────────
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(btn);
})();
