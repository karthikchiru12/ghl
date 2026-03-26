<script setup>
import { provide, computed } from 'vue';
import { useRoute }   from './composables/useRoute.js';
import { useData }    from './composables/useData.js';
import { useSync }    from './composables/useSync.js';
import { useDrawer }  from './composables/useDrawer.js';
import OverviewView   from './views/OverviewView.vue';
import AgentView      from './views/AgentView.vue';
import CallDrawer     from './components/CallDrawer.vue';

const props = defineProps({
  config: { type: Object, required: true },
});

// ── State ──────────────────────────────────────────────────────────────────
const scope  = useRoute();
const { data, loading, fetchJson, buildUrl, contextToken, refresh } = useData(scope, props.config);
const { syncing, syncStatus, runSync } = useSync(scope, { fetchJson, buildUrl, refresh });
const drawer = useDrawer({ fetchJson, buildUrl });

// ── Routing ────────────────────────────────────────────────────────────────
const isAgentView = computed(() => !!scope.value.agentId);

// ── Provide to all children ────────────────────────────────────────────────
provide('scope',       scope);
provide('data',        data);
provide('loading',     loading);
provide('syncing',     syncing);
provide('syncStatus',  syncStatus);
provide('runSync',     runSync);
provide('drawer',      drawer);
provide('dataHelpers', { refresh, contextToken });
</script>

<template>
  <div class="cp-card">
    <AgentView   v-if="isAgentView" />
    <OverviewView v-else />
    <CallDrawer />
  </div>
</template>
