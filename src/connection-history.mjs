export const CONNECTION_HISTORY_KEY = 'burner-connection-history';
const limits = { endpoint: 2048, model: 200 };
export function cleanConnectionValue(field, value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > limits[field]) return '';
  if (field === 'endpoint') {
    try { const url = new URL(text); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''; }
    catch { return ''; }
  }
  return text;
}
export function connectionValues(field, values) {
  return [...new Set(values.map(value => cleanConnectionValue(field, value)).filter(Boolean))].slice(0, 50);
}
export function loadConnectionHistory() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(CONNECTION_HISTORY_KEY) || '{}'); } catch { stored = {}; }
  const result = { endpoints: [], models: [], last: {} };
  for (const [field, key] of [['endpoint', 'endpoints'], ['model', 'models']]) {
    const value = cleanConnectionValue(field, stored?.last?.[field]);
    if (value || stored?.last?.[field] === '') result.last[field] = value;
    result[key] = connectionValues(field, [value, ...(Array.isArray(stored?.[key]) ? stored[key] : [])]);
  }
  return result;
}
export function rememberConnectionValue(history, field, value, commit) {
  const clean = cleanConnectionValue(field, value);
  const key = field === 'endpoint' ? 'endpoints' : 'models';
  const next = { ...history, last: { ...history.last, [field]: clean } };
  if (commit && clean) next[key] = connectionValues(field, [clean, ...history[key]]);
  try { localStorage.setItem(CONNECTION_HISTORY_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable or full; input still works. */ }
  return next;
}
