import { ref, onMounted, onUnmounted } from 'vue';

function parseScope() {
  const path = window.location.pathname;
  const locationMatch = path.match(/\/location\/([^/]+)/);
  const agentMatch    = path.match(/\/ai-agents\/voice-ai\/([^/?]+)/);
  const locationId    = locationMatch ? locationMatch[1] : '';
  const agentId       = agentMatch    ? agentMatch[1]    : '';
  return {
    locationId,
    agentId:  agentId || null,
    key:      `${locationId}:${agentId || 'all'}`,
  };
}

export function useRoute(scanMs = 1500) {
  const scope = ref(parseScope());
  let timer;

  onMounted(() => {
    timer = setInterval(() => { scope.value = parseScope(); }, scanMs);
  });

  onUnmounted(() => clearInterval(timer));

  return scope;
}
