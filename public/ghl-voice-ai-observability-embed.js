(function initGhlVoiceAiCopilotEmbed() {
  if (window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__) return;
  window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__ = true;

  const script = document.currentScript;
  const globalConfig = window.GHLVoiceAICopilotConfig || {};
  const config = {
    apiBase: globalConfig.apiBase || (script ? new URL(script.src).origin : window.location.origin),
    appId: globalConfig.appId || (script ? script.dataset.appId || '' : ''),
    refreshMs: Number(globalConfig.refreshMs || 45000),
    scanMs: Number(globalConfig.scanMs || 1500),
  };

  const state = {
    contextToken: '',
    currentKey: '',
    lastFetchedAt: 0,
    payload: null,
  };

  const STYLE_ID = 'ghl-voice-ai-copilot-style';
  const SUMMARY_ID = 'ghl-voice-ai-copilot-summary';
  const LOGS_ID = 'ghl-voice-ai-copilot-logs';

  ensureStylesheet();
  tick();
  window.setInterval(tick, config.scanMs);

  async function tick() {
    if (!isVoiceAiRoute()) {
      cleanup();
      return;
    }

    const scope = getRouteScope();
    if (!scope.locationId) return;

    const shouldFetch = !state.payload
      || state.currentKey !== scope.key
      || (Date.now() - state.lastFetchedAt) > config.refreshMs;

    if (shouldFetch) {
      try {
        state.contextToken = state.contextToken || await getContextToken();
        if (!state.contextToken) return;

        const [dashboardRes, callsRes] = await Promise.all([
          fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/dashboard`, {
            limit: 8,
            agentId: scope.agentId || '',
          })),
          fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/calls`, {
            limit: 8,
            agentId: scope.agentId || '',
          })),
        ]);

        state.payload = {
          scope,
          dashboard: dashboardRes.dashboard,
          calls: callsRes.calls || [],
        };
        state.currentKey = scope.key;
        state.lastFetchedAt = Date.now();
      } catch (error) {
        console.error('[GHL Copilot] Failed to load embed data', error);
        return;
      }
    }

    render(state.payload);
  }

  function isVoiceAiRoute() {
    return window.location.pathname.includes('/ai-agents/voice-ai');
  }

  function getRouteScope() {
    const path = window.location.pathname;
    const locationMatch = path.match(/\/location\/([^/]+)/);
    const voiceMatch = path.match(/\/ai-agents\/voice-ai\/([^/?]+)/);
    const locationId = locationMatch ? locationMatch[1] : '';
    const agentId = voiceMatch ? voiceMatch[1] : '';

    return {
      locationId,
      agentId: agentId || null,
      key: `${locationId}:${agentId || 'all'}`,
    };
  }

  async function getContextToken() {
    const exposeFn = window.exposeSessionDetails || window.parent?.exposeSessionDetails;
    if (typeof exposeFn !== 'function') {
      throw new Error('HighLevel exposeSessionDetails(APP_ID) is not available on this page.');
    }
    if (!config.appId) {
      throw new Error('Missing appId for HighLevel context decryption.');
    }
    const token = await exposeFn(config.appId);
    if (!token) {
      throw new Error('HighLevel did not return embedded session details.');
    }
    return token;
  }

  function buildApiUrl(pathname, params) {
    const url = new URL(pathname, config.apiBase);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value != null && value !== '') url.searchParams.set(key, value);
    });
    return url.toString();
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: {
        'x-ghl-context': state.contextToken,
      },
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
  }

  function render(payload) {
    renderSummaryCard(payload);
    renderLogsCard(payload);
    decorateRows(payload);
  }

  function renderSummaryCard(payload) {
    const anchor = findSummaryAnchor();
    if (!anchor) return;

    const overview = payload.dashboard.overview || {};
    const analyses = payload.dashboard.recentAnalyses || [];
    const useActionCount = analyses.filter((item) => asArray(item.use_actions).length > 0).length;
    const topFailures = (payload.dashboard.topFailures || []).slice(0, 3);

    let root = document.getElementById(SUMMARY_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = SUMMARY_ID;
      root.className = 'ghl-copilot-card';
      anchor.parentNode.insertBefore(root, anchor);
    }

    root.innerHTML = `
      <div class="ghl-copilot-card__header">
        <div>
          <p class="ghl-copilot-kicker">Observability Copilot</p>
          <h3 class="ghl-copilot-title">Native call quality overlay</h3>
        </div>
        <span class="ghl-copilot-chip">AI review</span>
      </div>
      <div class="ghl-copilot-stat-grid">
        ${renderStat('Analyzed Calls', formatNumber(overview.analysedCalls))}
        ${renderStat('Pending Review', formatNumber(overview.pendingCalls))}
        ${renderStat('Avg Score', formatScore(overview.avgScore))}
        ${renderStat('Needs Action', formatNumber(useActionCount))}
      </div>
      <div class="ghl-copilot-columns">
        <div class="ghl-copilot-panel">
          <strong>Top misses</strong>
          <ul class="ghl-copilot-list">
            ${topFailures.length
              ? topFailures.map((item) => `<li>${escapeHtml(item.text)} <span>${formatNumber(item.frequency)} calls</span></li>`).join('')
              : '<li>No recurring failures yet <span>healthy</span></li>'}
          </ul>
        </div>
        <div class="ghl-copilot-panel">
          <strong>Prompt tune-ups</strong>
          <ul class="ghl-copilot-list">
            ${buildRecommendationList(topFailures, analyses).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  function renderLogsCard(payload) {
    const anchor = findLogsAnchor();
    if (!anchor) return;

    const analyses = payload.dashboard.recentAnalyses || [];
    const flagged = analyses.filter((item) => (item.score ?? 0) < 70 || asArray(item.failures).length > 0).length;
    const actionNeeded = analyses.filter((item) => asArray(item.use_actions).length > 0).length;
    const latest = analyses.slice(0, 3);

    let root = document.getElementById(LOGS_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = LOGS_ID;
      root.className = 'ghl-copilot-card ghl-copilot-card--compact';
      anchor.parentNode.insertBefore(root, anchor);
    }

    root.innerHTML = `
      <div class="ghl-copilot-card__header">
        <div>
          <p class="ghl-copilot-kicker">Log Review</p>
          <h3 class="ghl-copilot-title">Copilot findings for the visible log stream</h3>
        </div>
      </div>
      <div class="ghl-copilot-stat-grid ghl-copilot-stat-grid--compact">
        ${renderStat('Flagged Calls', formatNumber(flagged))}
        ${renderStat('Use Actions', formatNumber(actionNeeded))}
        ${renderStat('Success Rate', payload.dashboard.overview?.successRate != null ? `${payload.dashboard.overview.successRate}%` : '—')}
      </div>
      <ul class="ghl-copilot-list ghl-copilot-list--dense">
        ${latest.length
          ? latest.map((item) => {
            const topFailure = asArray(item.failures)[0] || asArray(item.use_actions)[0] || 'No major issue';
            return `<li>${escapeHtml(item.agent_name || item.agent_id || 'Agent')} · ${escapeHtml(topFailure)}</li>`;
          }).join('')
          : '<li>No analyzed calls yet</li>'}
      </ul>
    `;
  }

  function decorateRows(payload) {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    if (!rows.length) return;

    const calls = payload.calls || [];
    const analysisMap = new Map((payload.dashboard.recentAnalyses || []).map((item) => [item.call_id, item]));

    rows.forEach((row, index) => {
      const call = calls[index];
      if (!call) return;

      const firstCell = row.querySelector('td');
      if (!firstCell) return;

      const existing = firstCell.querySelector('.ghl-copilot-row-badges');
      if (existing) existing.remove();

      const analysis = analysisMap.get(call.call_id);
      const score = call.score ?? analysis?.score ?? null;
      const failure = asArray(analysis?.failures)[0];
      const action = asArray(analysis?.use_actions)[0];

      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'ghl-copilot-row-badges';
      badgeWrap.innerHTML = [
        score != null ? `<span class="ghl-copilot-chip ${score >= 80 ? 'is-good' : score >= 65 ? 'is-warn' : 'is-bad'}">Score ${escapeHtml(String(score))}</span>` : '',
        failure ? `<span class="ghl-copilot-chip is-bad">${escapeHtml(failure)}</span>` : '',
        action ? `<span class="ghl-copilot-chip is-warn">Action: ${escapeHtml(action)}</span>` : '',
      ].filter(Boolean).join('');

      if (badgeWrap.innerHTML) {
        firstCell.appendChild(badgeWrap);
      }
    });
  }

  function buildRecommendationList(topFailures, analyses) {
    const items = [];

    if (topFailures[0]) {
      items.push(`Tighten the prompt around "${topFailures[0].text}" because it is recurring.`);
    }
    if (topFailures[1]) {
      items.push(`Add a script checkpoint for "${topFailures[1].text}" before the call ends.`);
    }

    const actionExample = analyses.flatMap((item) => asArray(item.use_actions))[0];
    if (actionExample) {
      items.push(`Train the agent on when to trigger "${actionExample}" without escalation delay.`);
    }

    if (!items.length) {
      items.push('No prompt changes suggested yet because there are no analyzed calls.');
    }

    return items.slice(0, 3);
  }

  function renderStat(label, value) {
    return `
      <div class="ghl-copilot-stat">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
      </div>
    `;
  }

  function findSummaryAnchor() {
    const callsCompleted = findElementByText('Calls Completed');
    if (callsCompleted) {
      return closestBlock(callsCompleted);
    }
    return findLogsAnchor();
  }

  function findLogsAnchor() {
    const header = findElementByText('Agent Name');
    if (!header) return null;

    const table = header.closest('table');
    if (table) {
      return table.parentElement || table;
    }

    return closestBlock(header);
  }

  function closestBlock(element) {
    let current = element;

    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 600 && rect.height > 60) {
        return current;
      }
      current = current.parentElement;
    }

    return element.parentElement;
  }

  function findElementByText(text) {
    return Array.from(document.querySelectorAll('body *')).find((element) => {
      if (element.children.length > 0) return false;
      return normalizeText(element.textContent) === text;
    }) || null;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cleanup() {
    [SUMMARY_ID, LOGS_ID].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.remove();
    });
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatScore(value) {
    return value == null ? '—' : `${Number(value).toFixed(1)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;

    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = `${config.apiBase}/ghl-voice-ai-observability-embed.css`;
    document.head.appendChild(link);
  }
})();
