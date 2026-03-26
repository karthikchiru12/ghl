<script setup>
import { inject, computed } from 'vue';
import CardHeader  from '../components/CardHeader.vue';
import Sparkline   from '../components/Sparkline.vue';
import CallsTable  from '../components/CallsTable.vue';
import AgentGoals  from '../components/AgentGoals.vue';
import { fmt, fmtScore, fmtDuration, fmtSentiment, scoreColor, scoreLabel, scoreChipClass, arr, truncate } from '../utils/index.js';

const data       = inject('data');
const syncing    = inject('syncing');
const syncStatus = inject('syncStatus');
const runSync    = inject('runSync');
const drawer     = inject('drawer');
const scope      = inject('scope');

const db = computed(() => data.value?.dashboard || {});

const overview              = computed(() => db.value.overview || {});
const agentInfo             = computed(() => {
  const ab = db.value.agentBreakdown || [];
  return ab.find((a) => a.agentId === scope.value.agentId) || ab[0] || null;
});
const topFailures           = computed(() => db.value.topFailures || []);
const scoreTrend            = computed(() => db.value.scoreTrend || []);
const recommendations       = computed(() => db.value.recommendations || {});
const missedOpportunities   = computed(() => db.value.missedOpportunities || []);
const metrics               = computed(() => db.value.metrics || null);
const recentAnalyses        = computed(() => db.value.recentAnalyses || []);
const recentCalls           = computed(() => data.value?.calls || []);
const transcriptHighlights  = computed(() => db.value.transcriptHighlights || []);
const extractionRates       = computed(() => db.value.extractionRates || []);
const actionExecRates       = computed(() => db.value.actionExecutionRates || []);

const avgScore  = computed(() => agentInfo.value?.avgScore ?? overview.value.avgScore ?? null);
const hasData   = computed(() => (overview.value.totalCalls || 0) > 0);

const analyzedSub = computed(() => {
  const pending = overview.value.pendingCalls;
  return pending > 0 ? `${pending} pending` : 'all analyzed';
});

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
    :title="agentInfo ? (agentInfo.agentName || agentInfo.agentId || 'Agent') : 'Voice AI Agent'"
    :status="agentInfo?.status || null"
    :syncing="syncing"
    :sync-status="syncStatus"
    @sync="runSync" />

  <!-- Empty state -->
  <div v-if="!hasData" class="cp-empty">
    <div class="cp-empty-icon">📞</div>
    <p>No call data for <strong>{{ agentInfo?.agentName || 'this agent' }}</strong> yet.</p>
    <p class="cp-empty-sub">Click <strong>Sync &amp; Analyze</strong> to pull this agent's calls and run AI analysis.</p>
  </div>

  <template v-else>
    <!-- Score band -->
    <div v-if="avgScore != null" class="cp-score-band">
      <div class="cp-score-band__label">
        <span>Overall Health</span>
        <strong :style="{ color: scoreColor(avgScore) }">{{ fmtScore(avgScore) }} / 100</strong>
      </div>
      <div class="cp-score-bar">
        <div class="cp-score-bar__fill" :style="{ width: avgScore + '%', background: scoreColor(avgScore) }"></div>
      </div>
    </div>

    <!-- KPI stats -->
    <div class="cp-stats-grid cp-stats-grid--4">
      <div class="cp-stat">
        <span class="cp-stat__label">Total Calls</span>
        <strong class="cp-stat__value">{{ fmt(overview.totalCalls) }}</strong>
      </div>
      <div class="cp-stat">
        <span class="cp-stat__label">Analyzed</span>
        <strong class="cp-stat__value">{{ fmt(overview.analysedCalls) }}</strong>
        <span class="cp-stat__sub">{{ analyzedSub }}</span>
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
      <div class="cp-metric-pill cp-metric-pill--effort">
        <span>Avg Effort</span>
        <strong>{{ metrics.avgCustomerEffort != null ? Number(metrics.avgCustomerEffort).toFixed(1) + ' / 5' : '—' }}</strong>
      </div>
    </div>

    <!-- Dynamic goals -->
    <AgentGoals :extraction-rates="extractionRates" :action-exec-rates="actionExecRates" />

    <!-- Two-column panel -->
    <div class="cp-two-col">
      <div class="cp-panel">
        <div class="cp-panel-title">Failures &amp; Issues</div>
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
        <div v-if="overview.avgDurationSeconds" class="cp-trend-sub">
          Avg call duration: <strong>{{ fmtDuration(overview.avgDurationSeconds) }}</strong>
        </div>
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

    <!-- Key Transcript Moments -->
    <template v-if="transcriptHighlights.length">
      <div class="cp-section-title">Key Transcript Moments</div>
      <div class="cp-highlights">
        <div v-for="(h, i) in transcriptHighlights.slice(0, 6)" :key="i"
          class="cp-highlight"
          :class="h.speaker === 'agent' ? 'cp-highlight--agent' : 'cp-highlight--user'">
          <span class="cp-highlight__speaker">{{ h.speaker === 'agent' ? 'Agent' : 'Caller' }}</span>
          <blockquote class="cp-highlight__moment">"{{ truncate(h.moment || '', 120) }}"</blockquote>
          <p v-if="h.reason" class="cp-highlight__reason">{{ h.reason }}</p>
          <span v-if="h.agent_name" class="cp-highlight__tag">{{ h.agent_name }}</span>
        </div>
      </div>
    </template>

    <!-- Recent Calls -->
    <template v-if="recentCalls.length">
      <div class="cp-section-title">Recent Calls</div>
      <CallsTable :calls="recentCalls" :show-agent="false" @open-call="openCall" />
    </template>
  </template>
</template>
