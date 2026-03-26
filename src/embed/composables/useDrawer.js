import { ref } from 'vue';

export function useDrawer({ fetchJson, buildUrl }) {
  const isOpen   = ref(false);
  const loading  = ref(false);
  const call     = ref(null);
  const analysis = ref(null);
  const error    = ref('');

  async function open(callId, scope) {
    call.value     = null;
    analysis.value = null;
    error.value    = '';
    loading.value  = true;
    isOpen.value   = true;

    try {
      const [callRes, analysisRes] = await Promise.allSettled([
        fetchJson(buildUrl(`/api/locations/${scope.locationId}/calls/${callId}`)),
        fetchJson(buildUrl(`/api/locations/${scope.locationId}/calls/${callId}/analysis`)),
      ]);

      call.value     = callRes.status     === 'fulfilled' ? callRes.value.call         : null;
      analysis.value = analysisRes.status === 'fulfilled' ? analysisRes.value.analysis : null;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function analyzeNow(callId, locationId, { refresh }) {
    loading.value = true;
    error.value   = '';
    try {
      const res = await fetchJson(
        buildUrl(`/api/locations/${locationId}/calls/${callId}/analyze`),
        { method: 'POST' }
      );
      analysis.value = res.analysis;
      await refresh();
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  function close() {
    isOpen.value = false;
    setTimeout(() => {
      call.value = null; analysis.value = null;
      error.value = ''; loading.value = false;
    }, 320);
  }

  return { isOpen, loading, call, analysis, error, open, close, analyzeNow };
}
