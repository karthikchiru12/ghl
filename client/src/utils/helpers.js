export function getScoreClass(score) {
  if (score == null) return 'score-yellow';
  const s = Number(score);
  if (s >= 80) return 'score-green';
  if (s >= 50) return 'score-yellow';
  return 'score-red';
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function sentimentLabel(val) {
  if (val == null) return '—';
  const n = Number(val);
  if (n >= 0.3) return 'Positive';
  if (n >= -0.3) return 'Neutral';
  return 'Negative';
}

export function sentimentClass(val) {
  if (val == null) return '';
  const n = Number(val);
  if (n >= 0.3) return 'metric-positive';
  if (n >= -0.3) return 'metric-neutral';
  return 'metric-negative';
}

export function effortLabel(val) {
  const labels = { 1: 'Effortless', 2: 'Easy', 3: 'Moderate', 4: 'Difficult', 5: 'Extreme' };
  return labels[val] ?? '—';
}

export function parseTranscriptString(text) {
  const turnPattern = /(?:^|\n)\s*(bot|human|agent|user|assistant|contact|ai|system)\s*:/i;
  if (!turnPattern.test(text)) return [{ role: 'raw', content: text }];

  const parts = text.split(/((?:^|\n)\s*(?:bot|human|agent|user|assistant|contact|ai|system)\s*:)/i);
  const turns = [];
  for (let i = 1; i < parts.length; i += 2) {
    const roleRaw = parts[i].replace(/[\n:]/g, '').trim().toLowerCase();
    const content = (parts[i + 1] ?? '').trim();
    if (!content) continue;
    const role = ['bot', 'agent', 'assistant', 'ai'].includes(roleRaw) ? 'agent' : 'user';
    turns.push({ role, content });
  }
  return turns.length > 0 ? turns : [{ role: 'raw', content: text }];
}
