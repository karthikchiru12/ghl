<script setup>
import { inject, computed } from 'vue';
import CardHeader    from '../components/CardHeader.vue';
import Sparkline     from '../components/Sparkline.vue';
import CallsTable    from '../components/CallsTable.vue';
import AgentGoals    from '../components/AgentGoals.vue';
import { fmt, fmtScore, fmtSentiment, scoreColor, scoreLabel, scoreChipClass, arr } from '../utils/index.js';

const data       = inject('data');
const syncing    = inject('syncing');
const syncStatus = inject('syncStatus');
const runSync    = inject('runSync');
const drawer     = inject('drawer');
const scope      = inject('scope');

const db = computed(() => data.value?.dashboard || {});

const overview            = computed(() => db.value.overview || {});
const agentBreakdown      = computed(() => db.value.agentBreakdown || []);
const topFailures         = computed(() => db.value.topFailures || []);
const scoreTrend          = computed(() => db.value.scoreTrend || []);
const recommendations     = computed(() => db.value.recommendations || {});
const missedOpportunities = computed(() => db.value.missedOpportunities || []);
const metrics             = computed(() => db.value.metrics || null);
const recentAnalyses      = computed(() => db.value.recentAnalyses || []);
const recentCalls         = computed(() => data.value?.calls || []);
const extractionRates     = computed(() => db.value.extractionRates || []);
const actionExecRates     = computed(() => db.value.actionExecutionRates || []);

const hasData    = computed(() => (overview.value.totalCalls || 0) > 0);
const actionItems = computed(() => [
  ...new Set(recentAnalyses.value.flatMap((a) => arr(a.use_actions)))
].slice(0, 3));

const recGroups = computed(() => {
  const r = recommendations.value;
  return [
    { type: 'prompt', label: 'Prompt',  icon: '✏️', items: r.prompt || [] },
    { type: 'script', label: 'Script',  icon: '📋', items: r.script || [] },
    { type: 'action', label: 'Actions', icon: '⚡', items: r.action || [] },
  ].filter((g) => g.items.length);
});

function openCall(callId) { drawer.open(callId, scope.value); }
</script>

<template>
  <CardHeader
    title="Voice AI Performance Overview"
    :syncing="syncing"
    :sync-status="syncStatus"
    @sync="runSync" />

  <!-- Empty state -->
  <div v-if="!hasData" class="cp-empty">
    <div class="cp-empty-icon">📊</div>
    <p>No call data yet.</p>
    <p class="cp-empty-sub">Click <strong>Sync &amp; Analyze</strong> to pull call logs and run AI analysis.</p>
  </div>

  <template v-else>
    <!-- KPI stats -->
    <div class="cp-stats-grid cp-stats-grid--4">
      <div class="cp-stat">
        <span class="cp-stat__label">Total Calls</span>
        <strong class="cp-stat__value">{{ fmt(overview.totalCalls) }}</strong>
      </div>
      <div class="cp-stat">
        <span class="cp-stat__label">Analyzed</span>
        <strong class="cp-stat__value">{{ fmt(overview.analysedCalls) }}</strong>
        <span v-if="overview.totalCalls > 0" class="cp-stat__sub">
          {{ Math.round((overview.analysedCalls / overview.totalCalls) * 100) }}% coverage
        </span>
      </div>
      <div class="cp-stat">
        <span class="cp-stat__label">Avg Score</span>
        <strong class="cp-stat__value">{{ fmtScore(overview.avgScore) }}</strong>
        <span v-if="scoreLabel(overview.avgScore)" class="cp-stat__sub">{{ scoreLabel(overview.avgScore) }}</span>
      </div>
      <div class="cp-stat">
        <span class="cp-stat__label">Success Rate</span>
        <strong class="cp-stat__value">{{ overview.successRate != null ? overview.successRate + '%' : '—' }}</strong>
      </div>
    </div>

    <!-- Metric pills -->
    <div v-if="metrics" class="cp-metrics-row">
      <div class="cp-metric-pill cp-metric-pill--score">
        <span>Empathy</span><strong>{{ fmtScore(metrics.avgEmpathy) }}</strong>
      </div>
      <div class="cp-metric-pill cp-metric-pill--score">
        <span>Script Adherence</span><strong>{{ fmtScore(metrics.avgScriptAdherence) }}</strong>
      </div>
      <div class="cp-metric-pill cp-metric-pill--rate">
        <span>Resolution Rate</span>
        <strong>{{ metrics.resolutionRate != null ? metrics.resolutionRate + '%' : '—' }}</strong>
      </div>
      <div class="cp-metric-pill cp-metric-pill--sentiment">
        <span>Avg Sentiment</span><strong>{{ fmtSentiment(metrics.avgSentiment) }}</strong>
      </div>
    </div>

    <!-- Agent table -->
    <div class="cp-section-title">Agent Performance</div>
    <div v-if="!agentBreakdown.length" class="cp-table-empty">No agents synced yet — run Sync &amp; Analyze.</div>
    <div v-else class="cp-table-wrap">
      <table class="cp-table">
        <thead>
          <tr><th>Agent</th><th>Status</th><th>Calls</th><th>Analyzed</th><th>Avg Score</th><th>Success</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in agentBreakdown" :key="a.agentId">
            <td>
              <span class="cp-health-dot" :style="{ background: scoreColor(a.avgScore) }"></span>
              {{ a.agentName || a.agentId }}
            </td>
            <td>
              <span class="cp-status-badge" :class="a.status === 'active' ? 'cp-status-badge--active' : 'cp-status-badge--inactive'">
                {{ a.status || 'unknown' }}
              </span>
            </td>
            <td>{{ fmt(a.totalCalls) }}</td>
            <td>{{ fmt(a.analysedCalls) }}</td>
            <td>
              <span v-if="a.avgScore != null" class="cp-score-pill" :class="scoreChipClass(a.avgScore)">
                {{ Number(a.avgScore).toFixed(1) }}
              </span>
              <span v-else class="cp-muted">—</span>
            </td>
            <td>{{ a.successRate != null ? a.successRate + '%' : '—' }}</td>
            <td>{{ fmt(a.actionCount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Dynamic goals -->
    <AgentGoals :extraction-rates="extractionRates" :action-exec-rates="actionExecRates" />

    <!-- Two-column panel -->
    <div class="cp-two-col">
      <div class="cp-panel">
        <div class="cp-panel-title">Top Failures</div>
        <ul v-if="topFailures.length" class="cp-failure-list">
          <li v-for="(f, i) in topFailures.slice(0, 5)" :key="i">
            <span class="cp-failure-text">{{ f.text }}</span>
            <span v-if="f.frequency > 1" class="cp-failure-freq">{{ f.frequency }} calls</span>
          </li>
        </ul>
        <p v-else class="cp-muted cp-muted--sm">None detected yet.</p>

        <template v-if="missedOpportunities.length">
          <div class="cp-panel-title cp-panel-title--mt">Missed Opportunities</div>
          <ul class="cp-failure-list">
            <li v-for="(o, i) in missedOpportunities.slice(0, 3)" :key="i">
              <span class="cp-failure-text">{{ o.text }}</span>
            </li>
          </ul>
        </template>

        <template v-if="actionItems.length">
          <div class="cp-panel-title cp-panel-title--mt">⚡ Action Items</div>
          <ul class="cp-failure-list cp-failure-list--action">
            <li v-for="(item, i) in actionItems" :key="i">
              <span class="cp-failure-text">{{ item }}</span>
            </li>
          </ul>
        </template>
      </div>

      <div class="cp-panel">
        <div class="cp-panel-title">Score Trend — 7 days</div>
        <Sparkline :data="scoreTrend" :w="280" :h="60" />
      </div>
    </div>

    <!-- AI Recommendations -->
    <template v-if="recGroups.length">
      <div class="cp-section-title">AI Recommendations</div>
      <div class="cp-rec-grid">
        <div v-for="g in recGroups" :key="g.type" class="cp-rec-group">
          <div class="cp-rec-group__header">
            <span class="cp-rec-icon">{{ g.icon }}</span>
            <span class="cp-rec-type">{{ g.label }}</span>
          </div>
          <ul class="cp-rec-list">
            <li v-for="(r, i) in g.items.slice(0, 3)" :key="i">{{ r.text }}</li>
          </ul>
        </div>
      </div>
    </template>

    <!-- Recent calls -->
    <template v-if="recentCalls.length">
      <div class="cp-section-title">Recent Calls</div>
      <CallsTable :calls="recentCalls" :show-agent="true" @open-call="openCall" />
    </template>
  </template>
</template>
