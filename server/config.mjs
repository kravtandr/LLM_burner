import { z } from 'zod';
import { ADVANCED_DEFAULTS as defaults, curvePeak } from '../shared/settings.mjs';

const schema = z.object({
  name: z.string().trim().max(100).default(''),
  endpoint: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).default(''),
  system: z.string().max(500000).default(''),
  prompt: z.string().min(1).max(500000).refine(v => v.trim().length > 0),
  concurrency: z.number().int().min(1).max(128),
  testMode: z.enum(['benchmark', 'stress']).default('benchmark'),
  totalRequests: z.number().int().min(1).max(10000).nullable().optional(),
  maxTokens: z.number().int().min(1).max(131072),
  timeoutSeconds: z.number().int().min(1).max(3600),
  includeUsage: z.boolean().default(true),
  tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
  demo: z.boolean().default(false),
  loadCurve: z.array(z.object({ time: z.number().min(0).max(3600), value: z.number().min(0).max(1000) })).max(32).default([]),
  curveTarget: z.enum(['concurrency', 'rate']).default('concurrency'),
  curveInterpolation: z.enum(['linear', 'step']).default('linear'),
  loadMode: z.enum(['concurrency', 'rate']).default(defaults.loadMode),
  requestRate: z.number().min(0.1).max(1000).default(defaults.requestRate),
  arrivalPattern: z.enum(['constant', 'poisson']).default(defaults.arrivalPattern),
  warmupRequests: z.number().int().min(0).max(1000).default(0),
  rampUpSeconds: z.number().min(0).max(600).default(0),
  durationSeconds: z.number().min(0).max(3600).default(0),
  sweepConcurrency: z.array(z.number().int().min(1).max(128)).max(8).default([]),
  prompts: z.array(z.string().min(1).max(100000).refine(s => s.trim().length > 0)).max(1000).default([]).refine(v => v.reduce((n, s) => n + s.length, 0) <= 500000, 'Dataset exceeds 500000 characters'),
  datasetSelection: z.enum(['round-robin', 'random']).default(defaults.datasetSelection),
  randomSeed: z.number().int().min(0).max(4294967295).default(42),
  cacheBust: z.boolean().default(false),
  continuousUsage: z.boolean().default(false),
  temperature: z.number().min(0).max(2).nullable().default(null),
  topP: z.number().min(0).max(1).nullable().default(null),
  seed: z.number().int().min(-2147483648).max(2147483647).nullable().default(null),
  sloTtftMs: z.number().positive().max(3600000).nullable().default(null),
  sloLatencyMs: z.number().positive().max(3600000).nullable().default(null),
  sloTpotMs: z.number().positive().max(3600000).nullable().default(null),
  inputPricePerMillion: z.number().min(0).max(1000000).nullable().default(null),
  outputPricePerMillion: z.number().min(0).max(1000000).nullable().default(null),
}).refine(c => c.testMode === 'stress' || c.totalRequests != null, { message: 'Benchmark requires a request limit', path: ['totalRequests'] })
.refine(c => c.testMode !== 'stress' || c.durationSeconds > 0, { message: 'Stress test requires a positive duration', path: ['durationSeconds'] })
.refine(c => c.testMode !== 'stress' || (!c.sweepConcurrency.length && !c.loadCurve.length), { message: 'Stress test uses duration, without a sweep or load curve', path: ['testMode'] })
.refine(c => !c.continuousUsage || c.includeUsage, { message: 'Continuous usage requires includeUsage', path: ['continuousUsage'] });

export function normalizeConfig(input) {
  const config = schema.parse(input);
  if (config.testMode === 'stress') config.totalRequests = null;
  if (config.loadCurve.length) {
    const points = config.loadCurve;
    if (points.length < 2 || points[0].time !== 0 || points.some((point, i) => i > 0 && point.time <= points[i - 1].time)) throw new Error('Load curve requires 2–32 points, starting at 0 with strictly increasing times.');
    if (!(config.curveInterpolation === 'step' ? points.slice(0, -1) : points).some(p => p.value > 0)) throw new Error('Load curve must contain a positive load before its end.');
    if (config.curveTarget === 'concurrency' && points.some(p => !Number.isInteger(p.value) || p.value > 128)) throw new Error('Load curve concurrency values must be integers from 0 to 128.');
    if (config.sweepConcurrency.length || config.rampUpSeconds) throw new Error('Load curve cannot be combined with a concurrency sweep or ramp-up.');
  }
  let url;
  try { url = new URL(config.endpoint); } catch { throw new Error('Enter a valid endpoint URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) URL without credentials, query parameters or a fragment.');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path;
  config.endpoint = url.toString();
  if (config.testMode !== 'stress' && (config.loadCurve.length && config.curveTarget === 'concurrency' ? curvePeak(config.loadCurve, config.curveInterpolation) : Math.max(config.concurrency, ...config.sweepConcurrency)) > config.totalRequests) throw new Error('Request limit per stage must be at least the peak concurrency.');
  config.sweepConcurrency = [...new Set(config.sweepConcurrency)];
  return config;
}

export function publicConfig(config) {
  const { apiKey, ...safe } = config;
  return safe;
}
