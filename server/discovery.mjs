import { normalizeConfig } from './config.mjs';
export async function discoverModels(input) {
  const config = normalizeConfig({ ...input, name: '', model: 'discovery', prompt: 'discovery', concurrency: 1, totalRequests: 1, maxTokens: 1, timeoutSeconds: 10 });
  const url = config.endpoint.replace(/\/chat\/completions$/, '/models');
  let response;
  try {
    response = await fetch(url, { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) throw new Error('Too large'); chunks.push(Buffer.from(part.value)); } } finally { await reader.cancel().catch(() => {}); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(body.data)) throw new Error('Bad model list');
    return [...new Set(body.data.map(m => m.id).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200))].sort().slice(0, 1000);
  } catch { throw new Error('Не удалось получить модели. Проверьте URL/ключ или укажите модель вручную; endpoint может не поддерживать /models.'); }
  finally { config.apiKey = ''; if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}
