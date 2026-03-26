<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Array, default: () => [] },
  w:    { type: Number, default: 280 },
  h:    { type: Number, default: 60 },
});

const chart = computed(() => {
  if (!props.data?.length) return null;
  const pad = 6, iw = props.w - pad * 2, ih = props.h - pad * 2;
  const scores = props.data.map((d) => Number(d.avgScore));
  const max = Math.max(...scores), min = Math.min(...scores);
  const range = max - min || 1;

  const pts = props.data.map((d, i) => ({
    x: pad + (props.data.length === 1 ? iw / 2 : (i / (props.data.length - 1)) * iw),
    y: pad + ih - ((Number(d.avgScore) - min) / range) * ih,
    score: d.avgScore,
    day:   d.day,
  }));

  const linePts = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPts = `${pts[0].x},${pad + ih} ${linePts} ${pts[pts.length - 1].x},${pad + ih}`;

  const labels = props.data.length <= 7 ? pts.map((p) => ({
    x:    p.x,
    label: p.day ? new Date(p.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '',
  })) : [];

  return { pts, linePts, areaPts, labels };
});
</script>

<template>
  <p v-if="!chart" class="cp-muted cp-muted--sm">No trend data yet.</p>
  <svg v-else :viewBox="`0 0 ${w} ${h}`" class="cp-sparkline" role="img" aria-label="Score trend chart">
    <polygon :points="chart.areaPts" fill="#2563eb" fill-opacity="0.08" />
    <polyline :points="chart.linePts" fill="none" stroke="#2563eb" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" />
    <circle v-for="(p, i) in chart.pts" :key="i" :cx="p.x" :cy="p.y" r="3" fill="#2563eb" />
    <text v-for="(l, i) in chart.labels" :key="i"
      :x="l.x" :y="h - 1" text-anchor="middle" class="cp-sparkline-label">
      {{ l.label }}
    </text>
  </svg>
</template>
