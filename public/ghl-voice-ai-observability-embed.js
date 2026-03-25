(function initGhlVoiceAiCopilotEmbed() {
  if (window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__) return;
  window.__GHL_VOICE_AI_COPILOT_EMBED_LOADED__ = true;

  const script = document.currentScript;
  const globalConfig = window.GHLVoiceAICopilotConfig || {};
  const config = {
    apiBase:   globalConfig.apiBase   || (script ? new URL(script.src).origin : window.location.origin),
    appId:     globalConfig.appId     || (script ? script.dataset.appId || '' : ''),
    refreshMs: Number(globalConfig.refreshMs || 45000),
    scanMs:    Number(globalConfig.scanMs    || 1500),
  };

  const state = {
    contextToken: '',
    currentKey:   '',
    lastFetchedAt: 0,
    payload:      null,
    syncStatus:   '',
    isSyncing:    false,
  };

  const STYLE_ID   = 'ghl-copilot-style';
  const SUMMARY_ID = 'ghl-copilot-summary';
  const LOGS_ID    = 'ghl-copilot-logs';

  ensureStylesheet();
  tick();
  window.setInterval(tick, config.scanMs);

  // ─── Core loop ───────────────────────────────────────────────────────────

  async function tick() {
    if (!isVoiceAiRoute()) { cleanup(); return; }

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
            limit: 20,
            ...(scope.agentId ? { agentId: scope.agentId } : {}),
          })),
          fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/calls`, {
            limit: 20,
            ...(scope.agentId ? { agentId: scope.agentId } : {}),
          })),
        ]);

        state.payload     = { scope, dashboard: dashboardRes.dashboard, calls: callsRes.calls || [] };
        state.currentKey  = scope.key;
        state.lastFetchedAt = Date.now();
      } catch (err) {
        console.error('[GHL Copilot] Failed to load data', err);
        return;
      }
    }

    render(state.payload);
  }

  // ─── Route detection ─────────────────────────────────────────────────────

  function isVoiceAiRoute() {
    return window.location.pathname.includes('/ai-agents/voice-ai');
  }

  function getRouteScope() {
    const path = window.location.pathname;
    const locationMatch = path.match(/\/location\/([^/]+)/);
    const agentMatch    = path.match(/\/ai-agents\/voice-ai\/([^/?]+)/);
    const locationId    = locationMatch ? locationMatch[1] : '';
    const agentId       = agentMatch    ? agentMatch[1]    : '';
    return { locationId, agentId: agentId || null, key: `${locationId}:${agentId || 'all'}` };
  }

  // ─── Data fetching ───────────────────────────────────────────────────────

  async function getContextToken() {
    const fn = window.exposeSessionDetails || window.parent?.exposeSessionDetails;
    if (typeof fn !== 'function') throw new Error('exposeSessionDetails not available');
    if (!config.appId) throw new Error('Missing appId in embed config');
    const token = await fn(config.appId);
    if (!token) throw new Error('No token returned from exposeSessionDetails');
    return token;
  }

  function buildApiUrl(pathname, params) {
    const url = new URL(pathname, config.apiBase);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    });
    return url.toString();
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, {
      method: options?.method || 'GET',
      headers: { 'x-ghl-context': state.contextToken },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function runSync(scope) {
    if (state.isSyncing) return;
    state.isSyncing = true;

    const steps = [
      { msg: 'Syncing agents from HighLevel…', fn: () => fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/agents`, { sync: 'true' })) },
      { msg: 'Syncing call logs…',             fn: () => fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/calls`,  { sync: 'true', allPages: 'true', limit: 50, ...(scope.agentId ? { agentId: scope.agentId } : {}) })) },
      { msg: 'Running AI analysis…',           fn: () => fetchJson(buildApiUrl(`/api/locations/${scope.locationId}/analyze-pending`, { all: 'true', ...(scope.agentId ? { agentId: scope.agentId } : {}) }), { method: 'POST' }) },
    ];

    try {
      for (const step of steps) {
        state.syncStatus = step.msg;
        if (state.payload) render(state.payload);
        await step.fn();
      }
      state.syncStatus  = 'Sync complete — refreshing…';
      state.lastFetchedAt = 0;
      await tick();
    } catch (err) {
      state.syncStatus = `Sync failed: ${err.message}`;
      console.error('[GHL Copilot] Sync error', err);
      if (state.payload) render(state.payload);
    } finally {
      state.isSyncing = false;
      setTimeout(() => { state.syncStatus = ''; if (state.payload) render(state.payload); }, 4000);
    }
  }

  // ─── Render dispatcher ───────────────────────────────────────────────────

  function render(payload) {
    if (payload.scope.agentId) {
      renderAgentView(payload);
    } else {
      renderOverviewView(payload);
    }
    renderLogsCard(payload);
    decorateRows(payload);
  }

  // ─── Overview view (root /voice-ai — all agents) ─────────────────────────

  function renderOverviewView(payload) {
    const anchor = findSummaryAnchor();
    if (!anchor) return;

    const { overview, agentBreakdown, topFailures, scoreTrend, recommendations, missedOpportunities, metrics } = payload.dashboard;
    const scope = payload.scope;

    let root = document.getElementById(SUMMARY_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = SUMMARY_ID;
      root.className = 'cp-card';
      anchor.parentNode.insertBefore(root, anchor);
    }

    const hasData = (overview?.totalCalls || 0) > 0;

    root.innerHTML = `
      ${renderCardHeader('Voice AI Performance Overview', null)}
      ${state.syncStatus ? `<div class="cp-status">${esc(state.syncStatus)}</div>` : ''}

      ${hasData ? `
        <div class="cp-stats-grid cp-stats-grid--4">
          ${stat('Total Calls',    fmt(overview.totalCalls),  null)}
          ${stat('Analyzed',       fmt(overview.analysedCalls), overview.totalCalls > 0 ? `${Math.round((overview.analysedCalls / overview.totalCalls) * 100)}% coverage` : null)}
          ${stat('Avg Score',      fmtScore(overview.avgScore), scoreLabel(overview.avgScore))}
          ${stat('Success Rate',   overview.successRate != null ? `${overview.successRate}%` : '—', null)}
        </div>

        ${metrics ? `
          <div class="cp-metrics-row">
            ${metricPill('Empathy',          fmtScore(metrics.avgEmpathy),         'score')}
            ${metricPill('Script Adherence', fmtScore(metrics.avgScriptAdherence), 'score')}
            ${metricPill('Resolution Rate',  metrics.resolutionRate != null ? `${metrics.resolutionRate}%` : '—', 'rate')}
            ${metricPill('Avg Sentiment',    fmtSentiment(metrics.avgSentiment),   'sentiment')}
          </div>
        ` : ''}

        <div class="cp-section-title">Agent Performance</div>
        ${renderAgentTable(agentBreakdown)}

        <div class="cp-two-col">
          <div class="cp-panel">
            <div class="cp-panel-title">Top Failures</div>
            ${renderFailureList(topFailures)}
            ${missedOpportunities?.length ? `
              <div class="cp-panel-title cp-panel-title--mt">Missed Opportunities</div>
              ${renderFailureList(missedOpportunities.slice(0, 3))}
            ` : ''}
          </div>
          <div class="cp-panel">
            <div class="cp-panel-title">Score Trend — 7 days</div>
            ${renderSparkline(scoreTrend, 280, 60)}
          </div>
        </div>

        ${renderRecommendationsBlock(recommendations)}
      ` : `
        <div class="cp-empty">
          <div class="cp-empty-icon">📊</div>
          <p>No call data yet.</p>
          <p class="cp-empty-sub">Click <strong>Sync &amp; Analyze</strong> to pull call logs and run AI analysis.</p>
        </div>
      `}
    `;

    root.querySelector('[data-sync-btn]')?.addEventListener('click', () => runSync(scope));
  }

  // ─── Agent deep-dive view (/voice-ai/:agentId) ───────────────────────────

  function renderAgentView(payload) {
    const anchor = findSummaryAnchor();
    if (!anchor) return;

    const { overview, agentBreakdown, topFailures, scoreTrend, recommendations, missedOpportunities, transcriptHighlights, metrics, recentCalls } = payload.dashboard;
    const scope      = payload.scope;
    const agentInfo  = agentBreakdown?.[0] || null;
    const agentName  = agentInfo?.agentName || 'This Agent';
    const agentStatus = agentInfo?.status || null;

    let root = document.getElementById(SUMMARY_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = SUMMARY_ID;
      root.className = 'cp-card';
      anchor.parentNode.insertBefore(root, anchor);
    }

    const hasData = (overview?.totalCalls || 0) > 0;
    const score    = overview?.avgScore;

    root.innerHTML = `
      ${renderCardHeader(agentName, agentStatus)}
      ${state.syncStatus ? `<div class="cp-status">${esc(state.syncStatus)}</div>` : ''}

      ${hasData ? `
        <div class="cp-stats-grid cp-stats-grid--4">
          ${stat('Total Calls',    fmt(overview.totalCalls), null)}
          ${stat('Analyzed',       fmt(overview.analysedCalls), overview.pendingCalls > 0 ? `${overview.pendingCalls} pending` : 'all analyzed')}
          ${stat('Avg Score',      fmtScore(score), scoreLabel(score))}
          ${stat('Success Rate',   overview.successRate != null ? `${overview.successRate}%` : '—', null)}
        </div>

        <div class="cp-score-band">
          <div class="cp-score-band__label">
            <span>Overall Health</span>
            <strong style="color:${scoreColor(score)}">${fmtScore(score)} / 100</strong>
          </div>
          <div class="cp-score-bar">
            <div class="cp-score-bar__fill" style="width:${score ?? 0}%;background:${scoreColor(score)}"></div>
          </div>
        </div>

        ${metrics ? `
          <div class="cp-metrics-row">
            ${metricPill('Empathy',          fmtScore(metrics.avgEmpathy),         'score')}
            ${metricPill('Script Adherence', fmtScore(metrics.avgScriptAdherence), 'score')}
            ${metricPill('Resolution Rate',  metrics.resolutionRate != null ? `${metrics.resolutionRate}%` : '—', 'rate')}
            ${metricPill('Avg Effort',       metrics.avgCustomerEffort != null ? `${Number(metrics.avgCustomerEffort).toFixed(1)} / 5` : '—', 'effort')}
          </div>
        ` : ''}

        <div class="cp-two-col">
          <div class="cp-panel">
            <div class="cp-panel-title">Failures &amp; Issues</div>
            ${renderFailureList(topFailures)}
            ${missedOpportunities?.length ? `
              <div class="cp-panel-title cp-panel-title--mt">Missed Opportunities</div>
              ${renderFailureList(missedOpportunities.slice(0, 3))}
            ` : ''}
          </div>
          <div class="cp-panel">
            <div class="cp-panel-title">Score Trend — 7 days</div>
            ${renderSparkline(scoreTrend, 280, 60)}
            ${overview.avgDurationSeconds ? `<div class="cp-trend-sub">Avg call duration: <strong>${fmtDuration(overview.avgDurationSeconds)}</strong></div>` : ''}
          </div>
        </div>

        ${renderRecommendationsBlock(recommendations)}

        ${transcriptHighlights?.length ? `
          <div class="cp-section-title">Key Transcript Moments</div>
          <div class="cp-highlights">
            ${transcriptHighlights.slice(0, 6).map(renderHighlight).join('')}
          </div>
        ` : ''}

        ${recentCalls?.length ? `
          <div class="cp-section-title">Recent Calls</div>
          ${renderCallsTable(recentCalls, false)}
        ` : ''}
      ` : `
        <div class="cp-empty">
          <div class="cp-empty-icon">📞</div>
          <p>No call data for <strong>${esc(agentName)}</strong> yet.</p>
          <p class="cp-empty-sub">Click <strong>Sync &amp; Analyze</strong> to pull this agent's calls and run AI analysis.</p>
        </div>
      `}
    `;

    root.querySelector('[data-sync-btn]')?.addEventListener('click', () => runSync(scope));
  }

  // ─── Logs card (below native stat section, above call table) ─────────────

  function renderLogsCard(payload) {
    const anchor = findLogsAnchor();
    if (!anchor) return;

    const { overview, recentAnalyses } = payload.dashboard;
    const scope    = payload.scope;
    const isAgent  = Boolean(scope.agentId);
    const analyses = recentAnalyses || [];

    const flagged      = analyses.filter((a) => (a.score ?? 0) < 70 || arr(a.failures).length > 0).length;
    const actionNeeded = analyses.filter((a) => arr(a.use_actions).length > 0).length;
    const successRate  = overview?.successRate;

    let root = document.getElementById(LOGS_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = LOGS_ID;
      root.className = 'cp-card cp-card--logs';
      anchor.parentNode.insertBefore(root, anchor);
    }

    root.innerHTML = `
      <div class="cp-card-header cp-card-header--compact">
        <div>
          <p class="cp-kicker">Log Review</p>
          <h3 class="cp-title">${isAgent ? 'Agent call analysis' : 'Copilot findings for the visible log stream'}</h3>
        </div>
      </div>
      <div class="cp-stats-grid cp-stats-grid--3">
        ${stat('Flagged Calls', fmt(flagged),      null)}
        ${stat('Use Actions',   fmt(actionNeeded), null)}
        ${stat('Success Rate',  successRate != null ? `${successRate}%` : '—', null)}
      </div>
      ${analyses.length ? `
        <ul class="cp-finding-list">
          ${analyses.slice(0, 5).map((a) => {
            const topIssue = arr(a.failures)[0] || arr(a.use_actions)[0];
            const agentLabel = !isAgent && a.agent_name ? `<span class="cp-finding-agent">${esc(a.agent_name)}</span>` : '';
            return topIssue
              ? `<li>${agentLabel}<span>${esc(topIssue)}</span></li>`
              : '';
          }).filter(Boolean).join('')}
        </ul>
      ` : `<p class="cp-finding-empty">No analyzed calls yet — run Sync &amp; Analyze.</p>`}
    `;
  }

  // ─── Row decoration ──────────────────────────────────────────────────────

  function decorateRows(payload) {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    if (!rows.length) return;

    const calls       = payload.calls || [];
    const analysisMap = new Map((payload.dashboard.recentAnalyses || []).map((a) => [a.call_id, a]));

    rows.forEach((row, i) => {
      const call = calls[i];
      if (!call) return;

      const cell = row.querySelector('td');
      if (!cell) return;

      cell.querySelector('.cp-row-badges')?.remove();

      const analysis = analysisMap.get(call.call_id);
      const score    = call.score ?? analysis?.score ?? null;
      const failure  = arr(analysis?.failures)[0];
      const action   = arr(analysis?.use_actions)[0];

      if (score == null && !failure && !action) return;

      const wrap = document.createElement('div');
      wrap.className = 'cp-row-badges';
      wrap.innerHTML = [
        score != null ? `<span class="cp-chip ${scoreChipClass(score)}">Score ${esc(String(score))}</span>` : '',
        failure       ? `<span class="cp-chip cp-chip--bad">${esc(truncate(failure, 50))}</span>` : '',
        action        ? `<span class="cp-chip cp-chip--warn">Action needed</span>` : '',
      ].filter(Boolean).join('');

      if (wrap.innerHTML) cell.appendChild(wrap);
    });
  }

  // ─── Shared component renderers ──────────────────────────────────────────

  function renderCardHeader(title, status) {
    const statusBadge = status
      ? `<span class="cp-status-badge cp-status-badge--${status === 'active' ? 'active' : 'inactive'}">${esc(status)}</span>`
      : '';
    return `
      <div class="cp-card-header">
        <div class="cp-card-header__left">
          <p class="cp-kicker">Observability Copilot</p>
          <h3 class="cp-title">${esc(title)} ${statusBadge}</h3>
        </div>
        <div class="cp-card-header__actions">
          <button class="cp-btn ${state.isSyncing ? 'cp-btn--syncing' : ''}" data-sync-btn ${state.isSyncing ? 'disabled' : ''}>
            ${state.isSyncing ? 'Syncing…' : 'Sync &amp; Analyze'}
          </button>
          <span class="cp-chip cp-chip--blue">AI review</span>
        </div>
      </div>
    `;
  }

  function stat(label, value, sub) {
    return `
      <div class="cp-stat">
        <span class="cp-stat__label">${esc(label)}</span>
        <strong class="cp-stat__value">${esc(String(value ?? '—'))}</strong>
        ${sub ? `<span class="cp-stat__sub">${esc(sub)}</span>` : ''}
      </div>
    `;
  }

  function metricPill(label, value, type) {
    return `<div class="cp-metric-pill cp-metric-pill--${type}"><span>${esc(label)}</span><strong>${esc(String(value ?? '—'))}</strong></div>`;
  }

  function renderAgentTable(agents) {
    if (!agents?.length) {
      return '<p class="cp-table-empty">No agents synced yet — run Sync &amp; Analyze.</p>';
    }
    const rows = agents.map((a) => `
      <tr>
        <td>
          <span class="cp-health-dot" style="background:${scoreColor(a.avgScore)}"></span>
          ${esc(a.agentName || a.agentId)}
        </td>
        <td><span class="cp-status-badge cp-status-badge--${a.status === 'active' ? 'active' : 'inactive'}">${esc(a.status || 'unknown')}</span></td>
        <td>${fmt(a.totalCalls)}</td>
        <td>${fmt(a.analysedCalls)}</td>
        <td>${a.avgScore != null ? `<span class="cp-score-pill ${scoreChipClass(a.avgScore)}">${Number(a.avgScore).toFixed(1)}</span>` : '<span class="cp-muted">—</span>'}</td>
        <td>${a.successRate != null ? `${a.successRate}%` : '<span class="cp-muted">—</span>'}</td>
        <td>${fmt(a.actionCount)}</td>
      </tr>
    `).join('');
    return `
      <div class="cp-table-wrap">
        <table class="cp-table">
          <thead><tr>
            <th>Agent</th><th>Status</th><th>Calls</th><th>Analyzed</th><th>Avg Score</th><th>Success</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderCallsTable(calls, showAgent) {
    if (!calls?.length) return '<p class="cp-table-empty">No calls recorded yet.</p>';
    const rows = calls.map((c) => `
      <tr>
        ${showAgent ? `<td>${esc(c.agent_name || c.agent_id || '—')}</td>` : ''}
        <td>${c.started_at ? fmtDate(c.started_at) : '<span class="cp-muted">—</span>'}</td>
        <td>${c.duration_seconds ? fmtDuration(c.duration_seconds) : '<span class="cp-muted">—</span>'}</td>
        <td>${c.score != null ? `<span class="cp-score-pill ${scoreChipClass(c.score)}">${c.score}</span>` : '<span class="cp-muted">—</span>'}</td>
        <td class="cp-summary-cell">${c.summary ? esc(truncate(c.summary, 80)) : '<span class="cp-muted">No summary</span>'}</td>
      </tr>
    `).join('');
    return `
      <div class="cp-table-wrap">
        <table class="cp-table">
          <thead><tr>
            ${showAgent ? '<th>Agent</th>' : ''}
            <th>Time</th><th>Duration</th><th>Score</th><th>Summary</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderFailureList(items) {
    if (!items?.length) return '<p class="cp-muted cp-muted--sm">None detected yet.</p>';
    return `
      <ul class="cp-failure-list">
        ${items.slice(0, 5).map((item) => `
          <li>
            <span class="cp-failure-text">${esc(item.text)}</span>
            ${item.frequency > 1 ? `<span class="cp-failure-freq">${item.frequency} calls</span>` : ''}
          </li>
        `).join('')}
      </ul>
    `;
  }

  function renderRecommendationsBlock(recs) {
    if (!recs) return '';
    const { prompt = [], script = [], action = [] } = recs;
    if (!prompt.length && !script.length && !action.length) return '';

    const groups = [
      { type: 'prompt', label: 'Prompt',  icon: '✏️', items: prompt },
      { type: 'script', label: 'Script',  icon: '📋', items: script },
      { type: 'action', label: 'Actions', icon: '⚡', items: action },
    ].filter((g) => g.items.length > 0);

    return `
      <div class="cp-section-title">AI Recommendations</div>
      <div class="cp-rec-grid">
        ${groups.map((g) => `
          <div class="cp-rec-group">
            <div class="cp-rec-group__header">
              <span class="cp-rec-icon">${g.icon}</span>
              <span class="cp-rec-type">${g.label}</span>
            </div>
            <ul class="cp-rec-list">
              ${g.items.slice(0, 3).map((r) => `<li>${esc(r.text)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderHighlight(h) {
    const isAgent = h.speaker === 'agent';
    return `
      <div class="cp-highlight cp-highlight--${isAgent ? 'agent' : 'user'}">
        <span class="cp-highlight__speaker">${isAgent ? 'Agent' : 'Caller'}</span>
        <blockquote class="cp-highlight__moment">"${esc(truncate(h.moment || '', 120))}"</blockquote>
        <p class="cp-highlight__reason">${esc(h.reason || '')}</p>
        ${h.agent_name ? `<span class="cp-highlight__tag">${esc(h.agent_name)}</span>` : ''}
      </div>
    `;
  }

  function renderSparkline(data, w, h) {
    if (!data?.length) return '<p class="cp-muted cp-muted--sm">No trend data yet.</p>';

    const pad = 6;
    const iw  = w - pad * 2;
    const ih  = h - pad * 2;

    const scores = data.map((d) => Number(d.avgScore));
    const max    = Math.max(...scores);
    const min    = Math.min(...scores);
    const range  = max - min || 1;

    const pts = data.map((d, i) => ({
      x: pad + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw),
      y: pad + ih - ((Number(d.avgScore) - min) / range) * ih,
      score: d.avgScore,
      count: d.count,
    }));

    const linePts  = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const areaPts  = `${pts[0].x},${pad + ih} ${linePts} ${pts[pts.length - 1].x},${pad + ih}`;
    const dots     = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#2563eb" />`).join('');
    const labels   = data.length <= 7 ? data.map((d, i) => {
      const p = pts[i];
      const dateStr = d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '';
      return `<text x="${p.x}" y="${h - 1}" text-anchor="middle" class="cp-sparkline-label">${esc(dateStr)}</text>`;
    }).join('') : '';

    return `
      <svg viewBox="0 0 ${w} ${h}" class="cp-sparkline" preserveAspectRatio="none" role="img" aria-label="Score trend chart">
        <polygon points="${areaPts}" fill="#2563eb" fill-opacity="0.08" />
        <polyline points="${linePts}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
        ${labels}
      </svg>
    `;
  }

  // ─── DOM anchor finders ──────────────────────────────────────────────────

  function findSummaryAnchor() {
    const el = findElementByText('Calls Completed');
    return el ? closestBlock(el) : findLogsAnchor();
  }

  function findLogsAnchor() {
    const header = findElementByText('Agent Name');
    if (!header) return null;
    const table = header.closest('table');
    return table ? (table.parentElement || table) : closestBlock(header);
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

  function findElementByText(text) {
    return Array.from(document.querySelectorAll('body *')).find((el) => {
      if (el.children.length > 0) return false;
      return normalizeText(el.textContent) === text;
    }) || null;
  }

  function normalizeText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function cleanup() {
    [SUMMARY_ID, LOGS_ID].forEach((id) => document.getElementById(id)?.remove());
  }

  function ensureStylesheet() {
    if (document.getElementById(STYLE_ID)) return;
    const link   = document.createElement('link');
    link.id      = STYLE_ID;
    link.rel     = 'stylesheet';
    link.href    = `${config.apiBase}/ghl-voice-ai-observability-embed.css`;
    document.head.appendChild(link);
  }

  // ─── Formatting helpers ──────────────────────────────────────────────────

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(v)       { return Number(v || 0).toLocaleString(); }
  function fmtScore(v)  { return v == null ? '—' : Number(v).toFixed(1); }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function arr(v)       { return Array.isArray(v) ? v : []; }

  function fmtDuration(s) {
    if (!s) return '—';
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  function fmtSentiment(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (n >= 0.3)  return `${(n * 100).toFixed(0)}% +`;
    if (n <= -0.3) return `${(Math.abs(n) * 100).toFixed(0)}% –`;
    return 'Neutral';
  }

  function scoreColor(v) {
    if (v == null) return '#9ca3af';
    if (v >= 70)   return '#16a34a';
    if (v >= 45)   return '#ca8a04';
    return '#dc2626';
  }

  function scoreLabel(v) {
    if (v == null) return null;
    if (v >= 70)   return 'Good';
    if (v >= 45)   return 'Needs work';
    return 'Critical';
  }

  function scoreChipClass(v) {
    if (v == null) return '';
    if (v >= 70)   return 'cp-chip--good';
    if (v >= 45)   return 'cp-chip--warn';
    return 'cp-chip--bad';
  }
})();
