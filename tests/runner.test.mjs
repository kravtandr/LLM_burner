import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { Runner } from '../server/runner.mjs';
import { createApp } from '../server/app.mjs';

const base = { endpoint: 'http://localhost:1234/v1', model: 'test', prompt: 'hello', concurrency: 3, totalRequests: 8, maxTokens: 16, timeoutSeconds: 5, includeUsage: true, tokenParameter: 'max_tokens', apiKey: 'secret-never-persist' };
async function setup(t, handler) {
  const dir = mkdtempSync(join(tmpdir(), 'burner-')); const store = new Store(join(dir, 'test.sqlite'));
  const server = createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const runner = new Runner(store);
  t.after(async () => { await runner.shutdown(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); rmSync(dir, { recursive: true }); });
  return { store, runner, dir, endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions` };
}
async function waitFor(runner, id) {
  for (let i = 0; i < 200; i++) { const run = runner.get(id); if (run.status !== 'running' && run.status !== 'stopping') return run; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('run did not finish');
}

test('worker pool reaches concurrency, caps it and persists all results without key', async t => {
  let active = 0, peak = 0, count = 0;
  const s = await setup(t, (req, res) => {
    active++; peak = Math.max(active, peak); count++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
    setTimeout(() => { active--; res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":10}}\n\ndata: [DONE]\n\n'); }, 35);
  });
  const { id } = s.runner.start({ ...base, endpoint: s.endpoint });
  assert.throws(() => s.runner.start(base), /active benchmark/);
  const run = await waitFor(s.runner, id);
  assert.equal(peak, 3); assert.equal(count, 8); assert.equal(run.status, 'completed'); assert.equal(run.metrics.success, 8); assert.equal(run.metrics.outputTokens, 80);
  assert.equal(s.store.get(id).results.length, 8); assert.ok(!JSON.stringify(run).includes(base.apiKey));
  assert.ok(!readFileSync(join(s.dir, 'test.sqlite')).includes(Buffer.from(base.apiKey)));
});

test('cancel aborts inflight work, starts no queued requests, keeps terminal history', async t => {
  let count = 0; const s = await setup(t, () => { count++; });
  const { id } = s.runner.start({ ...base, endpoint: s.endpoint });
  await new Promise(r => setTimeout(r, 30));
  s.runner.stop(id); const run = await waitFor(s.runner, id);
  assert.equal(run.status, 'cancelled'); assert.equal(count, 3); assert.equal(run.metrics.cancelled, 3); assert.equal(run.metrics.success, 0);
});

test('database recovery marks an unfinished run interrupted and preserves finished runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'burner-')); const file = join(dir, 'db.sqlite');
  let store = new Store(file);
  store.save({ id: 'a', status: 'running', startedAt: new Date().toISOString(), config: { ...base, apiKey: undefined }, results: [], elapsedMs: 123, series: [] }); store.close();
  store = new Store(file); assert.equal(store.get('a').status, 'interrupted'); assert.equal(store.get('a').elapsedMs, 123); store.close(); rmSync(dir, { recursive: true });
});

test('API validates load, blocks cross-origin writes, runs demo and exports history', async t => {
  const s = await setup(t, () => {});
  const app = createApp({ runner: s.runner, store: s.store });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ ...base, concurrency: 0 })).status, 400);
  assert.equal((await post(base, { Origin: 'https://evil.test' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => { const req = request(`${url}/api/runs`, { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(foreignHostStatus, 403);
  const response = await post({ ...base, demo: true, totalRequests: 3, maxTokens: 5, sweepConcurrency: [1] }); assert.equal(response.status, 201);
  const { id } = await response.json(); const run = await waitFor(s.runner, id); assert.equal(run.metrics.success, 3);
  const exported = await (await fetch(`${url}/api/runs/${id}/export?format=json`)).text(); assert.ok(!exported.includes(base.apiKey));
  assert.equal(JSON.parse(exported).config.demo, true);
  const csv = await (await fetch(`${url}/api/runs/${id}/export?format=csv`)).text(); assert.match(csv, /output_tokens/); assert.equal(csv.split('\r\n')[1].split(',')[5], '"1"');
  assert.equal((await (await fetch(`${url}/api/runs`)).json()).length, 1);
  assert.equal((await fetch(`${url}/api/runs/${id}`, { method: 'DELETE' })).status, 204);
});

test('recovery rebuilds metrics from durable request rows after an incomplete checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'burner-')); const file = join(dir, 'db.sqlite');
  let store = new Store(file);
  store.save({ id: 'crash', name: 'crash', status: 'running', startedAt: new Date().toISOString(), config: base, elapsedMs: 10, activeRequests: 1, metrics: { success: 0, outputTokens: 0 }, results: [], series: [] });
  store.addResult('crash', { index: 0, status: 'success', outputTokens: 10, durationMs: 100, ttftMs: 20, startOffsetMs: 0, endOffsetMs: 100 }); store.close();
  store = new Store(file); const recovered = store.get('crash');
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.metrics.success, 1); assert.equal(recovered.metrics.outputTokens, 10); assert.equal(recovered.elapsedMs, 100); assert.equal(recovered.activeRequests, 0);
  store.close(); rmSync(dir, { recursive: true });
});
