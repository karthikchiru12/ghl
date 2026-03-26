<script setup>
defineProps({
  title:      { type: String,  required: true },
  status:     { type: String,  default: null },
  syncing:    { type: Boolean, default: false },
  syncStatus: { type: String,  default: '' },
});
const emit = defineEmits(['sync']);
</script>

<template>
  <div class="cp-card-header">
    <div class="cp-card-header__left">
      <p class="cp-kicker">Observability Copilot</p>
      <h3 class="cp-title">
        {{ title }}
        <span v-if="status"
          class="cp-status-badge"
          :class="status === 'active' ? 'cp-status-badge--active' : 'cp-status-badge--inactive'">
          {{ status }}
        </span>
      </h3>
    </div>
    <div class="cp-card-header__actions">
      <button
        class="cp-btn"
        :class="{ 'cp-btn--syncing': syncing }"
        :disabled="syncing"
        @click="emit('sync')">
        {{ syncing ? 'Syncing…' : 'Sync &amp; Analyze' }}
      </button>
      <span class="cp-chip cp-chip--blue">AI review</span>
    </div>
  </div>
  <div v-if="syncStatus" class="cp-status">{{ syncStatus }}</div>
</template>
