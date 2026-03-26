<script setup>
import { inject, computed } from 'vue';
import { fmtDate, fmtDuration, fmtSentiment, scoreChipClass, scoreColor, arr, truncate } from '../utils/index.js';

const drawer = inject('drawer');
const scope  = inject('scope');
const data   = inject('data');
const { refresh } = inject('dataHelpers');

const call     = computed(() => drawer.call.value);
const analysis = computed(() => drawer.analysis.value);
const loading  = computed(() => drawer.loading.value);
const isOpen   = computed(() => drawer.isOpen.value);
const errMsg   = computed(() => drawer.error.value);

const score      = computed(() => analysis.value?.score ?? call.value?.score ?? null);
const failures   = computed(() => arr(analysis.value?.failures));
const actions    = computed(() => arr(analysis.value?.use_actions));
const promptRecs = computed(() => arr(analysis.value?.prompt_recommendations));
const scriptRecs = computed(() => arr(analysis.value?.script_recommendations));
const actionRecs = computed(() => arr(analysis.value?.action_recommendations));
const highlights = computed(() => arr(analysis.value?.transcript_highlights));
const transcript = computed(() => arr(call.value?.transcript));
const metrics    = computed(() => analysis.value?.metrics || {});

function color(v) { return scoreColor(v); }
function chip(v)  { return scoreChipClass(v); }

async function handleAnalyzeNow() {
  if (!call.value) return;
  await drawer.analyzeNow(call.value.call_id, scope.value.locationId, { refresh });
}
</script>

<template>
  <Teleport to="body">
    <!-- Overlay -->
    <div
      class="cp-drawer-overlay"
      :class="{ 'cp-drawer-overlay--open': isOpen }"
      @click.self="drawer.close()">
    </div>

    <!-- Panel -->
    <div class="cp-drawer" :class="{ 'cp-drawer--open': isOpen }">
      <div class="cp-drawer-inner">
        <button class="cp-drawer-close" @click="drawer.close()" aria-label="Close">✕</button>

        <!-- Loading -->
        <div v-if="loading" class="cp-drawer-loading">
          <div class="cp-drawer-spinner"></div>
          <span>Loading call analysis…</span>
        </div>

        <!-- Error -->
        <div v-else-if="errMsg" class="cp-drawer-error">{{ errMsg }}</div>

        <!-- Unanalyzed -->
        <template v-else-if="!analysis && call">
          <div class="cp-drawer-header">
            <p class="cp-drawer-kicker">Observability Copilot</p>
            <h3 class="cp-drawer-title">Call — {{ fmtDate(call.started_at) }}</h3>
            <div class="cp-drawer-meta">
              <span v-if="call.duration_seconds" class="cp-drawer-meta-item">⏱ {{ fmtDuration(call.duration_seconds) }}</span>
              <span v-if="call.agent_name" class="cp-drawer-meta-item">🤖 {{ call.agent_name }}</span>
            </div>
          </div>
          <div class="cp-drawer-unanalyzed">
            <p><strong>This call hasn't been analyzed yet.</strong></p>
            <p>Run AI analysis now using Minimax M2.5.</p>
            <button class="cp-analyze-btn" @click="handleAnalyzeNow">⚡ Analyze Now</button>
          </div>
        </template>

        <!-- Full analysis -->
        <template v-else-if="analysis">
          <!-- Header -->
          <div class="cp-drawer-header">
            <p class="cp-drawer-kicker">Observability Copilot</p>
            <h3 class="cp-drawer-title">
              Call — {{ fmtDate(call?.started_at || analysis.analyzed_at) }}
              <span v-if="score != null" class="cp-score-pill" :class="chip(score)">{{ score }}</span>
            </h3>
            <div class="cp-drawer-meta">
              <span v-if="call?.duration_seconds" class="cp-drawer-meta-item">⏱ {{ fmtDuration(call.duration_seconds) }}</span>
              <span v-if="call?.agent_name" class="cp-drawer-meta-item">🤖 {{ call.agent_name }}</span>
              <span v-if="analysis.analyzed_at" class="cp-drawer-meta-item">analyzed {{ fmtDate(analysis.analyzed_at) }}</span>
            </div>
          </div>

          <!-- Score bar -->
          <div v-if="score != null" class="cp-drawer-score-band">
            <div class="cp-score-band__label">
              <span>Overall Score</span>
              <strong :style="{ color: color(score) }">{{ score }} / 100</strong>
            </div>
            <div class="cp-score-bar">
              <div class="cp-score-bar__fill" :style="{ width: score + '%', background: color(score) }"></div>
            </div>
          </div>

          <!-- Metrics -->
          <div v-if="Object.keys(metrics).length" class="cp-drawer-metrics">
            <div v-if="metrics.empathy_score != null" class="cp-drawer-metric">
              <span class="cp-drawer-metric__label">Empathy</span>
              <span class="cp-drawer-metric__value">{{ Number(metrics.empathy_score).toFixed(1) }}</span>
            </div>
            <div v-if="metrics.script_adherence != null" class="cp-drawer-metric">
              <span class="cp-drawer-metric__label">Script</span>
              <span class="cp-drawer-metric__value">{{ Number(metrics.script_adherence).toFixed(1) }}</span>
            </div>
            <div v-if="metrics.customer_effort != null" class="cp-drawer-metric">
              <span class="cp-drawer-metric__label">Effort</span>
              <span class="cp-drawer-metric__value">{{ Number(metrics.customer_effort).toFixed(1) }}/5</span>
            </div>
            <div v-if="metrics.sentiment_overall != null" class="cp-drawer-metric">
              <span class="cp-drawer-metric__label">Sentiment</span>
              <span class="cp-drawer-metric__value">{{ fmtSentiment(metrics.sentiment_overall) }}</span>
            </div>
          </div>

          <!-- Summary -->
          <div v-if="analysis.summary_text" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Summary</p>
            <p class="cp-drawer-summary">{{ analysis.summary_text }}</p>
          </div>

          <!-- Failures -->
          <div v-if="failures.length" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Failures &amp; Issues</p>
            <ul class="cp-drawer-issues">
              <li v-for="(f, i) in failures" :key="i">{{ f }}</li>
            </ul>
          </div>

          <!-- Actions needed -->
          <div v-if="actions.length" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Actions Needed</p>
            <ul class="cp-drawer-issues cp-drawer-issues--action">
              <li v-for="(a, i) in actions" :key="i">{{ a }}</li>
            </ul>
          </div>

          <!-- Recommendations -->
          <div v-if="promptRecs.length || scriptRecs.length || actionRecs.length" class="cp-drawer-section">
            <p class="cp-drawer-section-title">AI Recommendations</p>
            <div v-if="promptRecs.length" class="cp-drawer-rec-group">
              <p class="cp-drawer-rec-label">✏️ Prompt</p>
              <ul class="cp-drawer-rec-list">
                <li v-for="(r, i) in promptRecs" :key="i">{{ r }}</li>
              </ul>
            </div>
            <div v-if="scriptRecs.length" class="cp-drawer-rec-group">
              <p class="cp-drawer-rec-label">📋 Script</p>
              <ul class="cp-drawer-rec-list">
                <li v-for="(r, i) in scriptRecs" :key="i">{{ r }}</li>
              </ul>
            </div>
            <div v-if="actionRecs.length" class="cp-drawer-rec-group">
              <p class="cp-drawer-rec-label">⚡ Actions</p>
              <ul class="cp-drawer-rec-list">
                <li v-for="(r, i) in actionRecs" :key="i">{{ r }}</li>
              </ul>
            </div>
          </div>

          <!-- Transcript highlights -->
          <div v-if="highlights.length" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Transcript Highlights</p>
            <div class="cp-drawer-highlights">
              <div v-for="(h, i) in highlights.slice(0, 6)" :key="i"
                class="cp-drawer-highlight"
                :class="h.speaker === 'agent' ? 'cp-drawer-highlight--agent' : 'cp-drawer-highlight--user'">
                <div class="cp-drawer-highlight__speaker">{{ h.speaker === 'agent' ? 'Agent' : 'Caller' }}</div>
                <p class="cp-drawer-highlight__text">"{{ truncate(h.moment || '', 150) }}"</p>
                <p v-if="h.reason" class="cp-drawer-highlight__reason">{{ h.reason }}</p>
              </div>
            </div>
          </div>

          <!-- Transcript chat -->
          <div v-if="transcript.length" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Transcript</p>
            <div class="cp-chat">
              <div v-for="(turn, i) in transcript" :key="i"
                class="cp-chat-bubble"
                :class="['agent','bot','assistant','ai'].includes(turn.role)
                  ? 'cp-chat-bubble--agent' : 'cp-chat-bubble--user'">
                <span class="cp-chat-speaker">
                  {{ ['agent','bot','assistant','ai'].includes(turn.role) ? 'Agent' : 'Caller' }}
                </span>
                <p class="cp-chat-text">{{ turn.content || turn.message || '' }}</p>
              </div>
            </div>
          </div>
          <div v-else-if="call?.transcript_text" class="cp-drawer-section">
            <p class="cp-drawer-section-title">Transcript</p>
            <pre class="cp-transcript-raw">{{ call.transcript_text }}</pre>
          </div>

        </template>
      </div>
    </div>
  </Teleport>
</template>
