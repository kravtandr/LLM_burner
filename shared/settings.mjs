export const ADVANCED_DEFAULTS = Object.freeze({
  loadMode: 'concurrency', requestRate: 1, arrivalPattern: 'constant', warmupRequests: 0, rampUpSeconds: 0,
  durationSeconds: 0, sweepConcurrency: [], prompts: [], datasetSelection: 'round-robin', randomSeed: 42,
  cacheBust: false, continuousUsage: false, temperature: null, topP: null, seed: null,
  sloTtftMs: null, sloLatencyMs: null, sloTpotMs: null, inputPricePerMillion: null, outputPricePerMillion: null,
});
export const SIMPLE_KEYS = ['name', 'endpoint', 'model', 'apiKey', 'system', 'prompt', 'concurrency', 'totalRequests', 'maxTokens', 'timeoutSeconds', 'includeUsage', 'tokenParameter'];
export function simpleConfig(config) { return Object.fromEntries(SIMPLE_KEYS.filter(k => config[k] !== undefined).map(k => [k, config[k]])); }
export function portableConfig(config) { const { apiKey, demo, ...safe } = config; return safe; }
