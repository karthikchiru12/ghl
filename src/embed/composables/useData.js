import { ref, watch } from 'vue';

export function useData(scope, config) {
  const data         = ref(null);
  const loading      = ref(false);
  const contextToken = ref('');

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function getContextToken() {
    const fn = window.exposeSessionDetails || window.parent?.exposeSessionDetails;
    if (typeof fn !== 'function') throw new Error('exposeSessionDetails not available');
    if (!config.appId) throw new Error('Missing appId in embed config');
    const token = await fn(config.appId);
    if (!token) throw new Error('No token returned from exposeSessionDetails');
    return token;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  function buildUrl(pathname, params) {
    const url = new URL(pathname, config.apiBase);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    });
    return url.toString();
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, {
      method:  options?.method || 'GET',
      headers: { 'x-ghl-context': contextToken.value },
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  let lastKey       = null;
  let lastFetchedAt = 0;

  async function fetchData(forceRefresh = false) {
    const s = scope.value;
    if (!s.locationId) return;

    const stale = (Date.now() - lastFetchedAt) > config.refreshMs;
    if (!forceRefresh && data.value && s.key === lastKey && !stale) return;

    loading.value = true;
    try {
      contextToken.value = contextToken.value || await getContextToken();

      const [dashRes, callsRes] = await Promise.all([
        fetchJson(buildUrl(`/api/locations/${s.locationId}/dashboard`, {
          limit: 20,
          ...(s.agentId ? { agentId: s.agentId } : {}),
        })),
        fetchJson(buildUrl(`/api/locations/${s.locationId}/calls`, {
          limit: 20,
          ...(s.agentId ? { agentId: s.agentId } : {}),
        })),
      ]);

      data.value    = { scope: s, dashboard: dashRes.dashboard, calls: callsRes.calls || [] };
      lastKey       = s.key;
      lastFetchedAt = Date.now();
    } catch (err) {
      console.error('[GHL Copilot] Failed to load data', err);
    } finally {
      loading.value = false;
    }
  }

  function refresh() { return fetchData(true); }

  watch(scope, () => fetchData(), { immediate: true });

  return { data, loading, fetchJson, buildUrl, contextToken, refresh };
}
