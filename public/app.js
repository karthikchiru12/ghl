const { createApp, ref, computed, onMounted, watch } = Vue;

createApp({
  setup() {
    const locations          = ref([]);
    const selectedLocation   = ref('');
    const summary            = ref({});
    const selectedCall       = ref(null);
    const selectedCallDetail = ref(null);
    const toast              = ref(null);   // { message, type }
    const agentFilter        = ref('');
    const analysesLimit      = ref(10);
    const autoRefresh        = ref(false);
    let   refreshTimer       = null;

    const loading = ref({ locations: false, agents: false, calls: false, analyzing: false });

    // ─── Toast helpers ─────────────────────────────────────────────────────

    const showError = (msg) => {
      toast.value = { message: msg, type: 'error' };
      setTimeout(() => { toast.value = null; }, 5000);
    };

    const showSuccess = (msg) => {
      toast.value = { message: msg, type: 'success' };
      setTimeout(() => { toast.value = null; }, 3000);
    };

    // ─── API wrapper ───────────────────────────────────────────────────────

    const apiFetch = async (url, options = {}) => {
      const res  = await fetch(url, options);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    };

    // ─── Data fetching ─────────────────────────────────────────────────────

    const fetchLocations = async () => {
      loading.value.locations = true;
      try {
        const data = await apiFetch('/api/locations');
        locations.value = data.locations || [];
        if (locations.value.length && !selectedLocation.value) {
          selectedLocation.value = locations.value[0].location_id;
        }
      } catch (err) {
        showError(err.message);
      } finally {
        loading.value.locations = false;
      }
    };

    const loadDashboard = async () => {
      if (!selectedLocation.value) return;
      try {
        const data = await apiFetch(
          `/api/locations/${selectedLocation.value}/dashboard?limit=${analysesLimit.value}`
        );
        summary.value = data.dashboard;
      } catch (err) {
        showError(err.message);
        summary.value = {};
      }
    };

    const loadMoreAnalyses = async () => {
      analysesLimit.value += 10;
      await loadDashboard();
    };

    const syncAgents = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.agents = true;
      try {
        const data = await apiFetch(`/api/locations/${selectedLocation.value}/agents?sync=true`);
        showSuccess(`Synced ${data.agents?.length ?? 0} agent(s)`);
        await loadDashboard();
      } catch (err) {
        showError(err.message);
      } finally {
        loading.value.agents = false;
      }
    };

    const syncCalls = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.calls = true;
      try {
        const data = await apiFetch(`/api/locations/${selectedLocation.value}/calls?sync=true&limit=50`);
        showSuccess(`Fetched ${data.calls?.length ?? 0} call(s)`);
        await loadDashboard();
      } catch (err) {
        showError(err.message);
      } finally {
        loading.value.calls = false;
      }
    };

    const analyzePending = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.analyzing = true;
      try {
        const data = await apiFetch(
          `/api/locations/${selectedLocation.value}/analyze-pending`,
          { method: 'POST' }
        );
        const { succeeded, failed } = data.summary;
        const msg = succeeded > 0
          ? `Analysed ${succeeded} call(s)${failed > 0 ? ` (${failed} failed)` : ''}`
          : 'No new analyses — all calls may already be analysed';
        showSuccess(msg);
        await loadDashboard();
      } catch (err) {
        showError(err.message);
      } finally {
        loading.value.analyzing = false;
      }
    };

    // ─── Transcript parser (mirrors backend parseTranscriptString) ────────

    const parseTranscriptString = (text) => {
      const turnPattern = /(?:^|\n)\s*(bot|human|agent|user|assistant|contact|ai|system)\s*:/i;
      if (!turnPattern.test(text)) return [{ role: 'raw', content: text }];

      const parts = text.split(/((?:^|\n)\s*(?:bot|human|agent|user|assistant|contact|ai|system)\s*:)/i);
      const turns = [];
      for (let i = 1; i < parts.length; i += 2) {
        const roleRaw = parts[i].replace(/[\n:]/g, '').trim().toLowerCase();
        const content = (parts[i + 1] ?? '').trim();
        if (!content) continue;
        const role = ['bot', 'agent', 'assistant', 'ai'].includes(roleRaw) ? 'agent' : 'user';
        turns.push({ role, content });
      }
      return turns.length > 0 ? turns : [{ role: 'raw', content: text }];
    };

    // ─── Call detail modal ─────────────────────────────────────────────────

    const viewCallDetail = async (callId) => {
      selectedCall.value       = callId;
      selectedCallDetail.value = null;
      try {
        const [callData, analysisData] = await Promise.all([
          apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}`).catch(() => null),
          apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}/analysis`).catch(() => null),
        ]);

        if (callData?.call) {
          let transcript = callData.call.transcript;
          if (typeof transcript === 'string') {
            try { transcript = JSON.parse(transcript); } catch (_) {}
          }
          // If still a string (unparseable), try splitting on role markers
          if (typeof transcript === 'string') {
            transcript = parseTranscriptString(transcript);
          }
          if (!Array.isArray(transcript)) transcript = [{ role: 'raw', content: String(transcript) }];

          // Resolve agent name from already-loaded agentBreakdown
          const agentName = summary.value.agentBreakdown?.find(
            (a) => a.agentId === callData.call.agent_id
          )?.agentName ?? null;

          selectedCallDetail.value = {
            ...callData.call,
            transcript,
            agent_name: agentName,
            analysis:   analysisData?.analysis ?? null,
          };
        }
      } catch (err) {
        showError(err.message);
        selectedCall.value = null;
      }
    };

    const reAnalyzeCall = async () => {
      if (!selectedCall.value || !selectedLocation.value) return;
      loading.value.analyzing = true;
      try {
        const data = await apiFetch(
          `/api/locations/${selectedLocation.value}/calls/${selectedCall.value}/analyze`,
          { method: 'POST' }
        );
        selectedCallDetail.value = { ...selectedCallDetail.value, analysis: data.analysis };
        showSuccess('Analysis refreshed');
        await loadDashboard();
      } catch (err) {
        showError(err.message);
      } finally {
        loading.value.analyzing = false;
      }
    };

    // ─── Filtering ─────────────────────────────────────────────────────────

    const filterByAgent = (agentId) => {
      agentFilter.value = agentFilter.value === agentId ? '' : agentId;
    };

    const filteredAnalyses = computed(() => {
      const analyses = summary.value.recentAnalyses ?? [];
      if (!agentFilter.value) return analyses;
      return analyses.filter((a) => a.agent_id === agentFilter.value);
    });

    // ─── Sparkline ─────────────────────────────────────────────────────────

    const sparklinePoints = computed(() => {
      const trend = summary.value.scoreTrend;
      if (!trend?.length || trend.length < 2) return '';
      const W = 120, H = 32;
      return trend.map((d, i) => {
        const x = (i / (trend.length - 1)) * W;
        const y = H - (d.avgScore / 100) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    });

    // ─── Auto-refresh ──────────────────────────────────────────────────────

    const toggleAutoRefresh = () => {
      autoRefresh.value = !autoRefresh.value;
      if (autoRefresh.value) {
        refreshTimer = setInterval(() => {
          if (selectedLocation.value) loadDashboard();
        }, 30_000);
        showSuccess('Auto-refresh on — updates every 30s');
      } else {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };

    // ─── Utilities ─────────────────────────────────────────────────────────

    const installApp = () => {
      apiFetch('/install-url')
        .then((data) => { if (data.installUrl) window.location.href = data.installUrl; })
        .catch((err) => showError(err.message));
    };

    const getScoreClass = (score) => {
      if (score == null) return 'score-yellow';
      const s = Number(score);
      if (s >= 80) return 'score-green';
      if (s >= 50) return 'score-yellow';
      return 'score-red';
    };

    const formatDuration = (seconds) => {
      if (!seconds) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

    // ─── Keyboard & lifecycle ──────────────────────────────────────────────

    const handleKeydown = (e) => {
      if (e.key === 'Escape' && selectedCall.value) selectedCall.value = null;
    };

    watch(selectedLocation, (val) => {
      if (val) {
        analysesLimit.value = 10;
        agentFilter.value   = '';
        loadDashboard();
      }
    });

    onMounted(async () => {
      window.addEventListener('keydown', handleKeydown);
      await fetchLocations();
      if (selectedLocation.value) loadDashboard();
    });

    return {
      locations, selectedLocation, summary, loading, toast,
      selectedCall, selectedCallDetail,
      agentFilter, analysesLimit, autoRefresh,
      filteredAnalyses, sparklinePoints,
      fetchLocations, loadDashboard, loadMoreAnalyses,
      syncAgents, syncCalls, analyzePending,
      viewCallDetail, reAnalyzeCall, installApp,
      filterByAgent, getScoreClass, formatDuration, toggleAutoRefresh,
    };
  },
}).mount('#app');
