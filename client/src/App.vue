<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useApi } from './composables/useApi';
import {
  effortLabel,
  formatDuration,
  getScoreClass,
  parseTranscriptString,
  sentimentLabel,
} from './utils/helpers';

const { toast, apiFetch, showError, showSuccess, setContextToken } = useApi();

const loading = ref({
  bootstrap: true,
  dashboard: false,
  agents: false,
  activity: false,
  callDetail: false,
  syncAgents: false,
  syncCalls: false,
  analyze: false,
});

const shell = ref({
  user: null,
  activeLocationId: '',
  activeLocation: null,
  locations: [],
});

const selectedLocation = ref('');
const currentView = ref('dashboard');
const dashboard = ref({
  overview: {},
  agentBreakdown: [],
  topFailures: [],
  recentAnalyses: [],
  recentCalls: [],
  actionBreakdown: [],
});
const agents = ref([]);
const activity = ref([]);
const selectedAgent = ref(null);
const selectedCallDetail = ref(null);
const selectedCallAnalysis = ref(null);
const bootstrapError = ref('');

const locationParam = new URLSearchParams(window.location.search).get('locationId');

const currentLocation = computed(() => {
  return shell.value.locations.find((location) => location.location_id === selectedLocation.value)
    || shell.value.activeLocation
    || null;
});

const locationLocked = computed(() => Boolean(shell.value.user?.activeLocation));

const ready = computed(() => Boolean(selectedLocation.value));

const selectedAgentPrompt = computed(() => {
  if (!selectedAgent.value) return '';
  return selectedAgent.value.prompt || selectedAgent.value.script || '';
});

const selectedAgentActions = computed(() => {
  const raw = selectedAgent.value?.actions;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch (_) { return []; }
});

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function transcriptItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return parseTranscriptString(value);
  }

  return [];
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function agentCardScore(agent) {
  return agent.avg_score ?? agent.avgScore ?? null;
}

async function requestEmbeddedContext() {
  if (window.parent === window) return '';

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve('');
    }, 3500);

    const handler = ({ data }) => {
      if (data?.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(data.payload || '');
    };

    window.addEventListener('message', handler);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });
}

async function bootstrapShell() {
  loading.value.bootstrap = true;
  bootstrapError.value = '';

  try {
    const encryptedData = await requestEmbeddedContext();
    setContextToken(encryptedData);

    const data = await apiFetch('/api/context/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encryptedData,
        locationId: locationParam,
      }),
    });

    shell.value = data.context;
    selectedLocation.value = data.context.activeLocationId
      || data.context.activeLocation?.location_id
      || data.context.locations?.[0]?.location_id
      || '';
  } catch (error) {
    bootstrapError.value = error.message;
    showError(error.message);
  } finally {
    loading.value.bootstrap = false;
  }
}

async function loadDashboard() {
  if (!selectedLocation.value) return;
  loading.value.dashboard = true;

  try {
    const data = await apiFetch(`/api/locations/${selectedLocation.value}/dashboard?limit=12`);
    dashboard.value = data.dashboard;
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.dashboard = false;
  }
}

async function loadAgents({ sync = false } = {}) {
  if (!selectedLocation.value) return;
  loading.value.agents = true;

  try {
    const data = await apiFetch(
      `/api/locations/${selectedLocation.value}/agents${sync ? '?sync=true' : ''}`
    );
    agents.value = data.agents || [];
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.agents = false;
  }
}

async function loadActivity() {
  if (!selectedLocation.value) return;
  loading.value.activity = true;

  try {
    const data = await apiFetch(`/api/locations/${selectedLocation.value}/activity?limit=40`);
    activity.value = data.events || [];
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.activity = false;
  }
}

async function selectAgent(agentId) {
  if (!selectedLocation.value || !agentId) return;

  try {
    const data = await apiFetch(`/api/locations/${selectedLocation.value}/agents/${agentId}`);
    selectedAgent.value = data.agent;
  } catch (error) {
    showError(error.message);
  }
}

async function syncAgents() {
  if (!selectedLocation.value) return;
  loading.value.syncAgents = true;

  try {
    await loadAgents({ sync: true });
    await loadDashboard();
    await loadActivity();
    showSuccess('Agent cache refreshed');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.syncAgents = false;
  }
}

async function syncCalls() {
  if (!selectedLocation.value) return;
  loading.value.syncCalls = true;

  try {
    await apiFetch(`/api/locations/${selectedLocation.value}/calls?sync=true&limit=50`);
    await loadDashboard();
    await loadActivity();
    showSuccess('Call cache refreshed');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.syncCalls = false;
  }
}

async function analyzePending() {
  if (!selectedLocation.value) return;
  loading.value.analyze = true;

  try {
    const data = await apiFetch(`/api/locations/${selectedLocation.value}/analyze-pending`, {
      method: 'POST',
    });
    await loadDashboard();
    await loadActivity();
    showSuccess(`Analyzed ${data.summary?.succeeded ?? 0} call(s)`);
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.analyze = false;
  }
}

async function openCall(callId) {
  if (!selectedLocation.value || !callId) return;
  loading.value.callDetail = true;

  try {
    const [callData, analysisData] = await Promise.all([
      apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}`),
      apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}/analysis`).catch(() => null),
    ]);
    selectedCallDetail.value = callData.call;
    selectedCallAnalysis.value = analysisData?.analysis || null;
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.callDetail = false;
  }
}

async function reanalyzeCall() {
  if (!selectedLocation.value || !selectedCallDetail.value?.call_id) return;
  loading.value.analyze = true;

  try {
    const data = await apiFetch(
      `/api/locations/${selectedLocation.value}/calls/${selectedCallDetail.value.call_id}/analyze`,
      { method: 'POST' }
    );
    selectedCallAnalysis.value = data.analysis;
    await loadDashboard();
    await loadActivity();
    showSuccess('Call analysis refreshed');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value.analyze = false;
  }
}

async function installApp() {
  try {
    const data = await apiFetch('/install-url');
    if (data.installUrl) window.location.href = data.installUrl;
  } catch (error) {
    showError(error.message);
  }
}

watch(selectedLocation, async (locationId) => {
  if (!locationId) return;
  await Promise.all([loadDashboard(), loadAgents(), loadActivity()]);

  const defaultAgentId = agents.value[0]?.agent_id
    || dashboard.value.agentBreakdown?.[0]?.agentId
    || null;

  if (defaultAgentId) {
    await selectAgent(defaultAgentId);
  } else {
    selectedAgent.value = null;
  }
});

onMounted(async () => {
  await bootstrapShell();
});
</script>

<template>
  <div class="app-shell">
    <aside class="side-rail">
      <div>
        <p class="eyebrow">HighLevel Embedded</p>
        <h1 class="brand-title">Voice AI Copilot</h1>
        <p class="brand-copy">
          Location-scoped observability for prompts, actions, transcripts, and call quality.
        </p>
      </div>

      <div class="rail-card">
        <span class="rail-label">Current Sub-Account</span>
        <strong>{{ currentLocation?.name || currentLocation?.location_id || 'Waiting for context' }}</strong>
        <span class="rail-meta">{{ currentLocation?.location_id || 'No location resolved yet' }}</span>
      </div>

      <div v-if="shell.user" class="rail-card">
        <span class="rail-label">Signed In</span>
        <strong>{{ shell.user.userName || shell.user.email }}</strong>
        <span class="rail-meta">{{ shell.user.email }} · {{ shell.user.role }}</span>
      </div>

      <nav class="rail-nav">
        <button
          class="rail-nav-button"
          :class="{ active: currentView === 'dashboard' }"
          @click="currentView = 'dashboard'"
        >
          Dashboard
        </button>
        <button
          class="rail-nav-button"
          :class="{ active: currentView === 'logs' }"
          @click="currentView = 'logs'"
        >
          Logs
        </button>
      </nav>
    </aside>

    <main class="main-surface">
      <header class="page-header">
        <div>
          <p class="eyebrow">Voice Agent Observability</p>
          <h2>{{ currentLocation?.name || 'Install the app inside a HighLevel sub-account' }}</h2>
          <p class="page-copy">
            Only the active sub-account’s cached agents, calls, analyses, and logs are exposed in this session.
          </p>
        </div>

        <div class="toolbar">
          <select
            v-model="selectedLocation"
            class="location-select"
            :disabled="locationLocked || loading.bootstrap"
          >
            <option
              v-for="location in shell.locations"
              :key="location.location_id"
              :value="location.location_id"
            >
              {{ location.name || location.location_id }}
            </option>
          </select>

          <button class="ghost-button" :disabled="loading.syncAgents" @click="syncAgents">
            {{ loading.syncAgents ? 'Syncing agents…' : 'Sync agents' }}
          </button>
          <button class="ghost-button" :disabled="loading.syncCalls" @click="syncCalls">
            {{ loading.syncCalls ? 'Syncing calls…' : 'Sync calls' }}
          </button>
          <button class="primary-button" :disabled="loading.analyze" @click="analyzePending">
            {{ loading.analyze ? 'Analyzing…' : 'Analyze pending' }}
          </button>
        </div>
      </header>

      <div v-if="toast" class="toast" :class="toast.type">
        {{ toast.message }}
      </div>

      <section v-if="loading.bootstrap" class="setup-panel">
        <h3>Loading embedded HighLevel context…</h3>
        <p>The app is resolving the active sub-account and matching it to its Postgres-backed install record.</p>
      </section>

      <section v-else-if="!ready" class="setup-panel">
        <h3>No installed sub-account was resolved</h3>
        <p>{{ bootstrapError || 'Open this app from a HighLevel sub-account custom page, or finish the OAuth install first.' }}</p>
        <button class="primary-button" @click="installApp">Open install flow</button>
      </section>

      <template v-else>
        <section class="metric-grid">
          <article class="metric-card">
            <span>Agents</span>
            <strong>{{ agents.length }}</strong>
          </article>
          <article class="metric-card">
            <span>Total Calls</span>
            <strong>{{ dashboard.overview.totalCalls ?? 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Analyzed</span>
            <strong>{{ dashboard.overview.analysedCalls ?? 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Avg Score</span>
            <strong :class="getScoreClass(dashboard.overview.avgScore)">
              {{ dashboard.overview.avgScore ?? '—' }}
            </strong>
          </article>
          <article class="metric-card">
            <span>Success Rate</span>
            <strong>{{ dashboard.overview.successRate != null ? `${dashboard.overview.successRate}%` : '—' }}</strong>
          </article>
          <article class="metric-card">
            <span>Avg Duration</span>
            <strong>{{ formatDuration(dashboard.overview.avgDurationSeconds) }}</strong>
          </article>
        </section>

        <section v-if="currentView === 'dashboard'" class="dashboard-layout">
          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Agents</p>
                <h3>Prompt and action coverage</h3>
              </div>
            </div>

            <div class="agent-list">
              <button
                v-for="agent in agents"
                :key="agent.agent_id"
                class="agent-card"
                :class="{ active: selectedAgent?.agent_id === agent.agent_id }"
                @click="selectAgent(agent.agent_id)"
              >
                <div class="agent-card-top">
                  <strong>{{ agent.name || agent.agent_id }}</strong>
                  <span class="pill">{{ agent.action_count || agent.actionCount || 0 }} actions</span>
                </div>
                <p class="agent-copy">{{ agent.prompt || 'No system prompt cached yet.' }}</p>
                <div class="agent-card-meta">
                  <span>{{ agent.total_calls || 0 }} calls</span>
                  <span :class="getScoreClass(agentCardScore(agent))">
                    {{ agentCardScore(agent) ?? '—' }}
                  </span>
                </div>
              </button>
            </div>
          </article>

          <article class="panel detail-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Agent Detail</p>
                <h3>{{ selectedAgent?.name || 'Select an agent' }}</h3>
              </div>
            </div>

            <template v-if="selectedAgent">
              <div class="detail-meta">
                <span class="pill">{{ selectedAgent.language || 'No language' }}</span>
                <span class="pill">{{ selectedAgent.timezone || 'No timezone' }}</span>
                <span class="pill">{{ selectedAgent.max_call_duration || '—' }}s max call</span>
              </div>

              <div class="content-block">
                <h4>System Prompt</h4>
                <pre>{{ selectedAgentPrompt || 'No prompt cached.' }}</pre>
              </div>

              <div class="content-block">
                <h4>Configured Actions</h4>
                <div v-if="selectedAgentActions.length" class="action-list">
                  <article v-for="action in selectedAgentActions" :key="action.id || action.name" class="action-card">
                    <strong>{{ action.name || action.actionName }}</strong>
                    <span class="rail-meta">{{ action.actionType }}</span>
                    <pre>{{ prettyJson(action.actionParameters || {}) }}</pre>
                  </article>
                </div>
                <p v-else class="empty-copy">This agent does not have cached actions yet.</p>
              </div>

              <div class="content-block">
                <h4>Recent Calls</h4>
                <div class="mini-list">
                  <button
                    v-for="call in asArray(selectedAgent.recent_calls)"
                    :key="call.callId"
                    class="mini-list-row"
                    @click="openCall(call.callId)"
                  >
                    <span>{{ formatDate(call.startedAt) }}</span>
                    <strong>{{ call.summary || 'No call summary' }}</strong>
                    <span :class="getScoreClass(call.score)">{{ call.score ?? '—' }}</span>
                  </button>
                </div>
              </div>
            </template>

            <p v-else class="empty-copy">Choose an agent to inspect its prompt, actions, and recent analyses.</p>
          </article>

          <article class="panel wide-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Recent Analyses</p>
                <h3>Call-level recommendations</h3>
              </div>
            </div>

            <div class="table-list">
              <button
                v-for="analysis in dashboard.recentAnalyses"
                :key="analysis.call_id"
                class="table-row"
                @click="openCall(analysis.call_id)"
              >
                <div>
                  <strong>{{ analysis.agent_name || analysis.agent_id || 'Unknown agent' }}</strong>
                  <p>{{ analysis.failures?.[0] || analysis.use_actions?.[0] || 'No major issues detected.' }}</p>
                </div>
                <div class="table-row-end">
                  <span>{{ formatDuration(analysis.duration_seconds) }}</span>
                  <span :class="getScoreClass(analysis.score)">{{ analysis.score ?? '—' }}</span>
                </div>
              </button>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Recurring Gaps</p>
                <h3>Top failures</h3>
              </div>
            </div>

            <div class="stack-list">
              <div v-for="failure in dashboard.topFailures" :key="failure.text" class="stack-item">
                <strong>{{ failure.text }}</strong>
                <span>{{ failure.frequency }} calls</span>
              </div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Executed Actions</p>
                <h3>What is actually firing</h3>
              </div>
            </div>

            <div class="stack-list">
              <div v-for="action in dashboard.actionBreakdown" :key="action.actionType" class="stack-item">
                <strong>{{ action.actionType }}</strong>
                <span>{{ action.frequency }} executions</span>
              </div>
            </div>
          </article>
        </section>

        <section v-else class="logs-layout">
          <article class="panel wide-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Activity Log</p>
                <h3>Sync, install, and analysis events</h3>
              </div>
            </div>

            <div class="timeline">
              <div v-for="event in activity" :key="event.id" class="timeline-item">
                <div class="timeline-marker" :class="event.status"></div>
                <div>
                  <strong>{{ event.title }}</strong>
                  <p>{{ event.detail || event.event_type }}</p>
                  <span class="rail-meta">{{ formatDate(event.created_at) }}</span>
                </div>
              </div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Latest Calls</p>
                <h3>Cached call logs</h3>
              </div>
            </div>

            <div class="table-list">
              <button
                v-for="call in dashboard.recentCalls"
                :key="call.call_id"
                class="table-row"
                @click="openCall(call.call_id)"
              >
                <div>
                  <strong>{{ call.agent_name || call.agent_id || 'Unknown agent' }}</strong>
                  <p>{{ call.summary || 'No call summary' }}</p>
                </div>
                <div class="table-row-end">
                  <span>{{ formatDate(call.started_at) }}</span>
                  <span :class="getScoreClass(call.score)">{{ call.score ?? '—' }}</span>
                </div>
              </button>
            </div>
          </article>
        </section>
      </template>
    </main>

    <div v-if="selectedCallDetail" class="modal-backdrop" @click.self="selectedCallDetail = null">
      <article class="modal-sheet">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Call Detail</p>
            <h3>{{ selectedCallDetail.agent_name || selectedCallDetail.agent_id || selectedCallDetail.call_id }}</h3>
          </div>
          <div class="toolbar">
            <button class="ghost-button" @click="reanalyzeCall">Re-run analysis</button>
            <button class="ghost-button" @click="selectedCallDetail = null">Close</button>
          </div>
        </div>

        <div class="modal-grid">
          <section class="content-block">
            <h4>Call Snapshot</h4>
            <div class="detail-meta">
              <span class="pill">{{ formatDate(selectedCallDetail.started_at) }}</span>
              <span class="pill">{{ formatDuration(selectedCallDetail.duration_seconds) }}</span>
              <span class="pill">{{ selectedCallDetail.from_number || 'No caller number' }}</span>
            </div>
            <p class="modal-summary">{{ selectedCallDetail.summary || 'No call summary stored.' }}</p>
          </section>

          <section class="content-block">
            <h4>Transcript</h4>
            <div class="transcript">
              <div
                v-for="(item, index) in transcriptItems(selectedCallDetail.transcript)"
                :key="`${item.role}-${index}`"
                class="turn"
                :class="item.role"
              >
                <span>{{ item.role }}</span>
                <p>{{ item.content }}</p>
              </div>
            </div>
          </section>

          <section class="content-block">
            <h4>Analysis Summary</h4>
            <p class="modal-summary">{{ selectedCallAnalysis?.summary_text || 'No stored analysis yet.' }}</p>
            <div class="metric-inline">
              <span class="pill">Score: {{ selectedCallAnalysis?.score ?? '—' }}</span>
              <span class="pill">
                Sentiment: {{ sentimentLabel(asObject(selectedCallAnalysis?.metrics).sentiment_overall) }}
              </span>
              <span class="pill">
                Customer effort: {{ effortLabel(asObject(selectedCallAnalysis?.metrics).customer_effort) }}
              </span>
            </div>
          </section>

          <section class="content-block">
            <h4>Prompt and Action Recommendations</h4>
            <div class="recommendation-grid">
              <div>
                <strong>Prompt</strong>
                <ul>
                  <li v-for="item in asArray(selectedCallAnalysis?.prompt_recommendations)" :key="item">{{ item }}</li>
                </ul>
              </div>
              <div>
                <strong>Script</strong>
                <ul>
                  <li v-for="item in asArray(selectedCallAnalysis?.script_recommendations)" :key="item">{{ item }}</li>
                </ul>
              </div>
              <div>
                <strong>Actions</strong>
                <ul>
                  <li v-for="item in asArray(selectedCallAnalysis?.action_recommendations)" :key="item">{{ item }}</li>
                </ul>
              </div>
            </div>
          </section>

          <section class="content-block">
            <h4>Agent Snapshot Used For Analysis</h4>
            <pre>{{ prettyJson(asObject(selectedCallAnalysis?.agent_snapshot)) }}</pre>
          </section>
        </div>
      </article>
    </div>
  </div>
</template>
