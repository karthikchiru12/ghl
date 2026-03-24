const { createApp, ref, onMounted, watch } = Vue;

createApp({
  setup() {
    const locations    = ref([]);
    const selectedLocation = ref('');
    const summary      = ref({});
    const selectedCall = ref(null);
    const selectedCallDetail = ref(null);
    const error        = ref(null);

    const loading = ref({ locations: false, agents: false, calls: false, analyzing: false });

    const showError = (msg) => {
      error.value = msg;
      setTimeout(() => error.value = null, 5000);
    };

    const apiFetch = async (url, options = {}) => {
      try {
        const res  = await fetch(url, options);
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      } catch (err) {
        showError(err.message);
        throw err;
      }
    };

    const fetchLocations = async () => {
      loading.value.locations = true;
      try {
        const data = await apiFetch('/api/locations');
        locations.value = data.locations || [];
        // Auto-select first location
        if (locations.value.length && !selectedLocation.value) {
          selectedLocation.value = locations.value[0].location_id;
        }
      } catch (e) {
        console.error('Failed to fetch locations', e);
      } finally {
        loading.value.locations = false;
      }
    };

    const loadDashboard = async () => {
      if (!selectedLocation.value) return;
      try {
        const data = await apiFetch(`/api/locations/${selectedLocation.value}/dashboard`);
        summary.value = data.dashboard;
      } catch (e) {
        summary.value = {};
      }
    };

    const syncAgents = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.agents = true;
      try {
        await apiFetch(`/api/locations/${selectedLocation.value}/agents?sync=true`);
        await loadDashboard();
      } finally { loading.value.agents = false; }
    };

    const syncCalls = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.calls = true;
      try {
        await apiFetch(`/api/locations/${selectedLocation.value}/calls?sync=true&limit=50`);
        await loadDashboard();
      } finally { loading.value.calls = false; }
    };

    const analyzePending = async () => {
      if (!selectedLocation.value) return showError('Select a location first');
      loading.value.analyzing = true;
      try {
        await apiFetch(`/api/locations/${selectedLocation.value}/analyze-pending`, { method: 'POST' });
        await loadDashboard();
      } finally { loading.value.analyzing = false; }
    };

    const viewCallDetail = async (callId) => {
      selectedCall.value = callId;
      selectedCallDetail.value = null;
      try {
        const [callData, analysisData] = await Promise.all([
          apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}`).catch(() => null),
          apiFetch(`/api/locations/${selectedLocation.value}/calls/${callId}/analysis`).catch(() => null),
        ]);
        if (callData?.call) {
          let transcript = callData.call.transcript;
          if (typeof transcript === 'string') { try { transcript = JSON.parse(transcript); } catch (e) {} }
          if (!Array.isArray(transcript)) transcript = [{ role: 'raw', content: String(transcript) }];
          selectedCallDetail.value = { ...callData.call, transcript, analysis: analysisData?.analysis ?? null };
        }
      } catch (e) {
        selectedCall.value = null;
      }
    };

    const installApp = () => {
      apiFetch('/install-url').then(data => {
        if (data.installUrl) window.location.href = data.installUrl;
      }).catch(() => {});
    };

    const getScoreClass = (score) => {
      if (score == null) return 'score-yellow';
      const s = Number(score);
      if (s >= 80) return 'score-green';
      if (s >= 50) return 'score-yellow';
      return 'score-red';
    };

    watch(selectedLocation, (val) => { if (val) loadDashboard(); });

    onMounted(async () => {
      await fetchLocations();
      // Auto-load dashboard for the auto-selected location
      if (selectedLocation.value) loadDashboard();
    });

    return {
      locations, selectedLocation, summary, loading, error,
      selectedCall, selectedCallDetail,
      fetchLocations, loadDashboard, syncAgents, syncCalls,
      analyzePending, viewCallDetail, installApp, getScoreClass,
    };
  }
}).mount('#app');
