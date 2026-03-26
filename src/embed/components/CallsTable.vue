<script setup>
import { fmtDate, fmtDuration, scoreChipClass } from '../utils/index.js';

defineProps({
  calls:     { type: Array,   default: () => [] },
  showAgent: { type: Boolean, default: false },
});
const emit = defineEmits(['open-call']);
</script>

<template>
  <p v-if="!calls.length" class="cp-table-empty">No calls recorded yet.</p>
  <div v-else class="cp-table-wrap">
    <table class="cp-table">
      <thead>
        <tr>
          <th v-if="showAgent">Agent</th>
          <th>Time</th>
          <th>Duration</th>
          <th>Score</th>
          <th>Summary</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in calls" :key="c.call_id"
          class="cp-call-row"
          @click="emit('open-call', c.call_id)">
          <td v-if="showAgent">{{ c.agent_name || c.agent_id || '—' }}</td>
          <td>{{ c.started_at ? fmtDate(c.started_at) : '—' }}</td>
          <td>{{ c.duration_seconds ? fmtDuration(c.duration_seconds) : '—' }}</td>
          <td>
            <span v-if="c.score != null" class="cp-score-pill" :class="scoreChipClass(c.score)">
              {{ c.score }}
            </span>
            <span v-else class="cp-muted">—</span>
          </td>
          <td class="cp-summary-cell">
            <span v-if="c.summary">{{ c.summary.slice(0, 80) }}{{ c.summary.length > 80 ? '…' : '' }}</span>
            <span v-else class="cp-muted">No summary</span>
          </td>
          <td class="cp-open-cell"><span class="cp-open-icon">›</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
