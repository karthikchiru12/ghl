// ─── Formatting helpers ───────────────────────────────────────────────────

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmt(v)      { return Number(v || 0).toLocaleString(); }
export function fmtScore(v) { return v == null ? '—' : Number(v).toFixed(1); }
export function arr(v)      { return Array.isArray(v) ? v : []; }
export function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

export function fmtDuration(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function fmtSentiment(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 0.3)  return `${(n * 100).toFixed(0)}% +`;
  if (n <= -0.3) return `${(Math.abs(n) * 100).toFixed(0)}% –`;
  return 'Neutral';
}

// ─── Score helpers ────────────────────────────────────────────────────────

export function scoreColor(v) {
  if (v == null) return '#9ca3af';
  if (v >= 70)   return '#16a34a';
  if (v >= 45)   return '#ca8a04';
  return '#dc2626';
}

export function scoreLabel(v) {
  if (v == null) return null;
  if (v >= 70)   return 'Good';
  if (v >= 45)   return 'Needs work';
  return 'Critical';
}

export function scoreChipClass(v) {
  if (v == null) return '';
  if (v >= 70)   return 'cp-chip--good';
  if (v >= 45)   return 'cp-chip--warn';
  return 'cp-chip--bad';
}

// ─── Field name prettifier ────────────────────────────────────────────────

export function prettyFieldName(key) {
  if (!key) return '';
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
