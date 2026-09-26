import express from 'express';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { normalizeConfig, publicConfig } from './config.mjs';
import { discoverModels } from './discovery.mjs';

export function createApp({ runner, store }) {
  const app = express(); app.disable('x-powered-by');
  // Local tool: reject foreign origins and DNS-rebinding hosts before processing bodies.
  app.use((req, res, next) => {
    const allowedHost = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    try {
      if (!allowedHost(new URL(`http://${req.headers.host}`).hostname)) return res.status(403).json({ error: 'Only local access is allowed.' });
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const allowedPorts = new Set([String(req.socket.localPort), '5173']);
        if (!allowedHost(origin.hostname) || !allowedPorts.has(origin.port) || !['http:', 'https:'].includes(origin.protocol)) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, activeId: runner.active?.run.id ?? null }));
  app.post('/api/config/validate', (req, res) => res.json(publicConfig(normalizeConfig(req.body))));
  app.post('/api/models', async (req, res) => res.json({ models: await discoverModels(req.body) }));
  app.get('/api/runs', (req, res) => res.json(store.list(Math.max(0, Number.parseInt(req.query.offset) || 0)).map(run => runner.active?.run.id === run.id ? { ...run, metrics: runner.getSummary(run.id).metrics, status: runner.active.run.status } : run)));
  app.post('/api/runs', (req, res) => {
    if (runner.active) return res.status(409).json({ error: 'A benchmark is already running.' });
    res.status(201).json(runner.start(req.body));
  });
  app.get('/api/runs/:id', (req, res) => {
    const offset = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number.parseInt(req.query.offset) || 0));
    const run = runner.getPage(req.params.id, offset);
    if (!run) return res.status(404).json({ error: 'Benchmark not found.' });
    res.json(run);
  });
  app.get('/api/runs/:id/requests/:index', (req, res) => {
    if (!/^\d+$/.test(req.params.index) || !Number.isSafeInteger(Number(req.params.index))) return res.status(400).json({ error: 'Invalid request index.' });
    const data = store.getRequest(req.params.id, Number(req.params.index));
    if (!data) return res.status(404).json({ error: 'Request not found.' });
    res.json(data);
  });
  app.post('/api/runs/:id/stop', (req, res) => res.json(runner.stop(req.params.id)));
  app.delete('/api/runs/:id', (req, res) => {
    if (runner.active?.run.id === req.params.id) return res.status(409).json({ error: 'Stop the benchmark first.' });
    if (!store.delete(req.params.id)) return res.status(404).json({ error: 'Benchmark not found.' });
    res.sendStatus(204);
  });
  app.get('/api/runs/:id/export', (req, res) => {
    const run = runner.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Benchmark not found.' });
    const csv = req.query.format === 'csv';
    res.attachment(`llm-burner-${run.id}.${csv ? 'csv' : 'json'}`);
    if (!csv) return res.json(run);
    const extra = ['phase', 'stageIndex', 'promptIndex', 'queueMs', 'ttfoMs', 'ttstMs', 'decodeDurationMs', 'tpotMs', 'decodeTps', 'iclMs', 'iclMaxMs', 'chunkCount', 'bytesReceived', 'finishReason', 'reasoningTokens', 'cachedInputTokens', 'acceptedPredictionTokens', 'rejectedPredictionTokens', 'firstChunkTokens', 'decodeTokenCount', 'tokenTimingMethod', 'errorType', 'targetLoad', 'testMode', 'durationSeconds'];
    const columns = ['run_id', 'started_at', 'model', 'endpoint', 'demo', 'concurrency', 'max_tokens', 'request', 'status', 'output_tokens', 'input_tokens', 'duration_ms', 'ttft_ms', 'http_status', 'error', ...extra];
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
    const rows = run.results.map(r => [run.id, run.startedAt, run.config.model, run.config.endpoint, run.config.demo, run.stages?.find(stage => stage.index === r.stageIndex)?.concurrency ?? run.config.concurrency, run.config.maxTokens, r.index + 1, r.status, r.outputTokens, r.inputTokens, r.durationMs, r.ttftMs, r.httpStatus, r.error, ...extra.map(k => k === 'testMode' ? run.config.testMode || 'benchmark' : k === 'durationSeconds' ? run.config.durationSeconds : r[k])]);
    res.type('text/csv').send('\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n'));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
  app.use((error, req, res, next) => {
    if (error instanceof ZodError) return res.status(400).json({ error: `Check these settings: ${error.issues.map(i => i.path.join('.')).join(', ')}.` });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON.' });
    if (/URL|active benchmark|already finished|request limit|retrieve models|Load curve/i.test(error.message)) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Internal server error. Check that the local database is accessible.' });
  });
  return app;
}
