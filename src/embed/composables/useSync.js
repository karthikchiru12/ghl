import { ref } from 'vue';

export function useSync(scope, { fetchJson, buildUrl, refresh }) {
  const syncing    = ref(false);
  const syncStatus = ref('');

  async function runSync() {
    if (syncing.value) return;
    syncing.value = true;

    const s = scope.value;
    const steps = [
      {
        msg: 'Syncing agents from HighLevel…',
        fn:  () => fetchJson(buildUrl(`/api/locations/${s.locationId}/agents`, { sync: 'true' })),
      },
      {
        msg: 'Syncing call logs…',
        fn:  () => fetchJson(buildUrl(`/api/locations/${s.locationId}/calls`, {
          sync: 'true', allPages: 'true', limit: 50,
          ...(s.agentId ? { agentId: s.agentId } : {}),
        })),
      },
      {
        msg: 'Running AI analysis…',
        fn:  () => fetchJson(
          buildUrl(`/api/locations/${s.locationId}/analyze-pending`, {
            all: 'true',
            ...(s.agentId ? { agentId: s.agentId } : {}),
          }),
          { method: 'POST' }
        ),
      },
    ];

    try {
      for (const step of steps) {
        syncStatus.value = step.msg;
        await step.fn();
      }
      syncStatus.value = 'Sync complete — refreshing…';
      await refresh();
    } catch (err) {
      syncStatus.value = `Sync failed: ${err.message}`;
      console.error('[GHL Copilot] Sync error', err);
    } finally {
      syncing.value = false;
      setTimeout(() => { syncStatus.value = ''; }, 4000);
    }
  }

  return { syncing, syncStatus, runSync };
}
