import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { Runner } from '../server/runner.mjs';
import { normalizeConfig } from '../server/config.mjs';
const base = { endpoint: 'http://localhost:1234/v1', model: 'test', prompt: 'hello', concurrency: 2, totalRequests: 4, maxTokens: 16, timeoutSeconds: 5 };
async function setup(t, delay = 30) {
  const received = []; let inflight = 0, peak = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    received.push({ time: performance.now(), payload: JSON.parse(Buffer.concat(chunks)) });
    inflight++; peak = Math.max(peak, inflight);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n');
    setTimeout(() => { inflight--; res.end('data: {"choices":[{"delta":{"content":"end"},"finish_reason":"stop"}],"usage":{"completion_tokens":10,"prompt_tokens":20}}\n\ndata: [DONE]\n\n'); }, delay);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'burner-adv-')); const store = new Store(join(dir, 'db.sqlite')); const runner = new Runner(store);
  t.after(async () => { await runner.shutdown(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); rmSync(dir, { recursive: true }); });
  return { runner, store, received, peak: () => peak, config: { ...base, endpoint: `http://127.0.0.1:${server.address().port}/v1` } };
}
async function finished(runner, id) {
  for (let i = 0; i < 600; i++) { const run = runner.get(id); if (!['running', 'stopping'].includes(run.status)) return run; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('timeout');
}

test('advanced config defaults preserve simple behavior and reject invalid workload knobs', () => {
  const cfg = normalizeConfig(base); assert.equal(cfg.loadMode, 'concurrency'); assert.equal(cfg.warmupRequests, 0); assert.deepEqual(cfg.sweepConcurrency, []);
  for (const change of [{ requestRate: 0 }, { sweepConcurrency: [0] }, { warmupRequests: -1 }, { prompts: [''] }, { topP: 2 }, { durationSeconds: -1 }, { sloTtftMs: -10 }, { sweepConcurrency: [8] }]) assert.throws(() => normalizeConfig({ ...base, ...change }));
});
test('warmup is persisted separately and excluded from measured throughput', async t => {
  const s = await setup(t); const { id } = s.runner.start({ ...s.config, warmupRequests: 2 });
  const run = await finished(s.runner, id);
  assert.equal(s.received.length, 6); assert.equal(run.warmupCompleted, 2); assert.equal(run.metrics.success, 4); assert.equal(run.metrics.outputTokens, 40);
  assert.equal(run.results.filter(r => r.phase === 'warmup').length, 2); assert.ok(run.wallElapsedMs > run.elapsedMs); assert.equal(run.stages.length, 1);
});
test('sweep executes separate concurrency stages and saves per-stage metrics', async t => {
  const s = await setup(t); const { id } = s.runner.start({ ...s.config, sweepConcurrency: [1, 2], warmupRequests: 1 });
  const run = await finished(s.runner, id);
  assert.equal(run.plannedRequests, 8); assert.equal(run.metrics.success, 8); assert.equal(run.stages.length, 2);
  assert.deepEqual(run.stages.map(s => s.metrics.outputTokens), [40, 40]); assert.deepEqual(run.stages.map(s => s.status), ['completed', 'completed']); assert.equal(s.peak(), 2);
  assert.equal(s.store.get(id).stages[1].metrics.success, 4);
});
test('rate scheduling enforces spacing and records queue delay when concurrency saturates', async t => {
  const s = await setup(t, 80); const { id } = s.runner.start({ ...s.config, concurrency: 1, totalRequests: 3, loadMode: 'rate', requestRate: 20 });
  const run = await finished(s.runner, id);
  assert.equal(s.peak(), 1); assert.ok(s.received[1].time - s.received[0].time >= 60); assert.ok(run.results[1].queueMs > 15);
});
test('duration limits dispatch, drains pending requests, and stop interrupts paced waits', async t => {
  const s = await setup(t, 20);
  let run = s.runner.start({ ...s.config, totalRequests: 100, loadMode: 'rate', requestRate: 10, durationSeconds: 0.15 });
  run = await finished(s.runner, run.id); assert.equal(run.metrics.success, 2); assert.equal(run.status, 'completed');
  run = s.runner.start({ ...s.config, loadMode: 'rate', requestRate: 0.1 });
  await new Promise(r => setTimeout(r, 40)); const time = performance.now(); s.runner.stop(run.id); run = await finished(s.runner, run.id);
  assert.ok(performance.now() - time < 250); assert.equal(run.status, 'cancelled'); assert.equal(run.metrics.success, 1);
});
test('round-robin prompt dataset and cache-busting affect actual payload and preserve system', async t => {
  const s = await setup(t); const { id } = s.runner.start({ ...s.config, prompts: ['alpha', 'beta'], system: 'system', cacheBust: true });
  const run = await finished(s.runner, id);
  assert.equal(run.metrics.success, 4);
  assert.deepEqual(s.received.map(r => r.payload.messages.at(-1).content.split('\n\n').at(-1)), ['alpha', 'beta', 'alpha', 'beta']);
  assert.equal(new Set(s.received.map(r => r.payload.messages.at(-1).content)).size, 4); assert.equal(s.received[0].payload.messages[0].content, 'system');
});
test('ramp begins with one active slot and cancellation prevents later stages', async t => {
  const s = await setup(t, 70); const { id } = s.runner.start({ ...s.config, totalRequests: 100, sweepConcurrency: [4, 8], rampUpSeconds: 1 });
  await new Promise(r => setTimeout(r, 45)); assert.equal(s.peak(), 1); s.runner.stop(id);
  const run = await finished(s.runner, id); assert.equal(run.status, 'cancelled'); assert.equal(run.stages[1].completed, 0);
});

test('recovery excludes warmup wall time and rebuilds stage summaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'burner-recovery-')); const path = join(dir, 'db.sqlite'); let store = new Store(path);
  store.save({ id: 'v2', schemaVersion: 2, status: 'running', phase: 'measurement', startedAt: new Date().toISOString(), config: normalizeConfig(base), elapsedMs: 5, wallElapsedMs: 2005, stages: [{ index: 0, concurrency: 2, status: 'running', elapsedMs: 5 }], results: [], series: [] });
  store.addResult('v2', { index: 0, phase: 'warmup', stageIndex: 0, status: 'success', outputTokens: 100, durationMs: 2000, endOffsetMs: 2000 });
  store.addResult('v2', { index: 1, phase: 'measurement', stageIndex: 0, status: 'success', outputTokens: 10, durationMs: 100, endOffsetMs: 2100, stageEndOffsetMs: 100 }); store.close();
  store = new Store(path); const run = store.get('v2');
  assert.equal(run.elapsedMs, 100); assert.equal(run.wallElapsedMs, 2100); assert.equal(run.metrics.success, 1); assert.equal(run.metrics.outputTokens, 10); assert.equal(run.stages[0].metrics.success, 1); assert.equal(run.phase, 'finished');
  store.close(); rmSync(dir, { recursive: true });
});
