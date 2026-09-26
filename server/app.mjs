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
      if (!allowedHost(new URL(`http://${req.headers.host}`).hostname)) return res.status(403).json({ error: 'Разрешён только локальный доступ.' });
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const allowedPorts = new Set([String(req.socket.localPort), '5173']);
        if (!allowedHost(origin.hostname) || !allowedPorts.has(origin.port) || !['http:', 'https:'].includes(origin.protocol)) return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
    } catch { return res.status(403).json({ error: 'Некорректный origin.' }); }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, activeId: runner.active?.run.id ?? null }));
  app.post('/api/config/validate', (req, res) => res.json(publicConfig(normalizeConfig(req.body))));
  app.post('/api/models', async (req, res) => res.json({ models: await discoverModels(req.body) }));
  app.get('/api/runs', (req, res) => res.json(store.list(Math.max(0, Number.parseInt(req.query.offset) || 0)).map(run => runner.active?.run.id === run.id ? { ...run, metrics: runner.get(run.id).metrics, status: runner.active.run.status } : run)));
  app.post('/api/runs', (req, res) => {
    if (runner.active) return res.status(409).json({ error: 'Уже выполняется тест.' });
    res.status(201).json(runner.start(req.body));
  });
  app.get('/api/runs/:id', (req, res) => {
    const run = runner.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Тест не найден.' });
    const offset = Math.max(0, Number.parseInt(req.query.offset) || 0);
    res.json({ ...run, results: run.results.toSorted((a, b) => a.index - b.index).slice(offset, offset + 100), resultsTotal: run.results.length });
  });
  app.post('/api/runs/:id/stop', (req, res) => res.json(runner.stop(req.params.id)));
  app.delete('/api/runs/:id', (req, res) => {
    if (runner.active?.run.id === req.params.id) return res.status(409).json({ error: 'Сначала остановите тест.' });
    if (!store.delete(req.params.id)) return res.status(404).json({ error: 'Тест не найден.' });
    res.sendStatus(204);
  });
  app.get('/api/runs/:id/export', (req, res) => {
    const run = runner.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Тест не найден.' });
    const csv = req.query.format === 'csv';
    res.attachment(`llm-burner-${run.id}.${csv ? 'csv' : 'json'}`);
    if (!csv) return res.json(run);
    const extra = ['phase', 'stageIndex', 'promptIndex', 'queueMs', 'ttfoMs', 'ttstMs', 'decodeDurationMs', 'tpotMs', 'decodeTps', 'iclMs', 'iclMaxMs', 'chunkCount', 'bytesReceived', 'finishReason', 'reasoningTokens', 'cachedInputTokens', 'acceptedPredictionTokens', 'rejectedPredictionTokens', 'firstChunkTokens', 'decodeTokenCount', 'tokenTimingMethod', 'errorType'];
    const columns = ['run_id', 'started_at', 'model', 'endpoint', 'demo', 'concurrency', 'max_tokens', 'request', 'status', 'output_tokens', 'input_tokens', 'duration_ms', 'ttft_ms', 'http_status', 'error', ...extra];
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
    const rows = run.results.map(r => [run.id, run.startedAt, run.config.model, run.config.endpoint, run.config.demo, run.stages?.find(stage => stage.index === r.stageIndex)?.concurrency ?? run.config.concurrency, run.config.maxTokens, r.index + 1, r.status, r.outputTokens, r.inputTokens, r.durationMs, r.ttftMs, r.httpStatus, r.error, ...extra.map(k => r[k])]);
    res.type('text/csv').send('\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n'));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
  app.use((error, req, res, next) => {
    if (error instanceof ZodError) return res.status(400).json({ error: `Проверьте параметры: ${error.issues.map(i => i.path.join('.')).join(', ')}.` });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Тело запроса слишком большое.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Некорректный JSON.' });
    if (/URL|активный|завершён|число запросов|получить модели/.test(error.message)) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Проверьте доступность локальной базы.' });
  });
  return app;
}
