<!-- Dynamic agent-specific metrics derived from extracted_data and executed_actions -->
<script setup>
import { computed } from 'vue';
import { prettyFieldName } from '../utils/index.js';

const props = defineProps({
  extractionRates:    { type: Array, default: () => [] },
  actionExecRates:    { type: Array, default: () => [] },
});

const hasExtractions = computed(() => props.extractionRates.length > 0);
const hasActions     = computed(() => props.actionExecRates.length > 0);
const hasAny         = computed(() => hasExtractions.value || hasActions.value);

function rateColor(rate) {
  if (rate >= 80) return '#16a34a';
  if (rate >= 50) return '#ca8a04';
  return '#dc2626';
}
</script>

<template>
  <template v-if="hasAny">
    <div class="cp-section-title">Agent Goals &amp; Data Collection</div>
    <div class="cp-goals-grid">

      <!-- Extracted fields (data collection goals) -->
      <div v-if="hasExtractions" class="cp-goals-panel">
        <div class="cp-goals-panel__title">📋 Data Collection</div>
        <div class="cp-goals-rows">
          <div v-for="r in extractionRates" :key="r.fieldName" class="cp-goal-row">
            <span class="cp-goal-name">{{ prettyFieldName(r.fieldName) }}</span>
            <div class="cp-goal-bar-wrap">
              <div class="cp-goal-bar" :style="{ width: r.collectionRate + '%', background: rateColor(r.collectionRate) }"></div>
            </div>
            <span class="cp-goal-rate" :style="{ color: rateColor(r.collectionRate) }">{{ r.collectionRate }}%</span>
            <span class="cp-goal-sub">{{ r.collectedCount }}/{{ r.totalCount }}</span>
          </div>
        </div>
      </div>

      <!-- Executed actions (automation goals) -->
      <div v-if="hasActions" class="cp-goals-panel">
        <div class="cp-goals-panel__title">⚡ Action Execution</div>
        <div class="cp-goals-rows">
          <div v-for="r in actionExecRates" :key="r.actionType" class="cp-goal-row">
            <span class="cp-goal-name">{{ prettyFieldName(r.actionType) }}</span>
            <div class="cp-goal-bar-wrap">
              <div class="cp-goal-bar" :style="{ width: r.executionRate + '%', background: rateColor(r.executionRate) }"></div>
            </div>
            <span class="cp-goal-rate" :style="{ color: rateColor(r.executionRate) }">{{ r.executionRate }}%</span>
            <span class="cp-goal-sub">{{ r.callsExecuted }}/{{ r.totalCalls }}</span>
          </div>
        </div>
      </div>

    </div>
  </template>
</template>
