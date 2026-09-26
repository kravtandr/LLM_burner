import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { Runner } from '../server/runner.mjs';
import { createApp } from '../server/app.mjs';

test('request details are durable, loaded individually, and deleted with the run', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'burner-details-'));
  const path = join(dir, 'db.sqlite'); let store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const run = { id: 'details', status: 'completed', startedAt: new Date().toISOString(), config: {}, results: [] };
  store.save(run);
  const detail = { request: { body: { model: 'fixture' } }, response: { body: { content: 'Hello' } } };
  store.checkpoint(run, { index: 0, status: 'success', detailStatus: 'saved' }, detail);
  store.addResult(run.id, { index: 1, status: 'success' });
  assert.ok(!JSON.stringify(store.get(run.id)).includes('Hello'));
  store.close(); store = new Store(path);
  const server = createApp({ runner: new Runner(store), store }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/runs/details/requests/`;
  const data = await (await fetch(url + '0')).json();
  assert.deepEqual(data.details, detail); assert.equal(data.request.index, 0);
  assert.equal((await (await fetch(url + '1')).json()).details, null);
  assert.equal((await fetch(url + '99')).status, 404);
  assert.equal((await fetch(url + '-1')).status, 400);
  assert.equal((await fetch(url + '0garbage')).status, 400);
  store.delete(run.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM request_details').get().n, 0);
  assert.equal((await fetch(url + '0')).status, 404);
});

test('runner saves captured payloads separately from polling results', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'burner-details-run-')); const store = new Store(join(dir, 'db.sqlite'));
  const runner = new Runner(store);
  t.after(async () => { await runner.shutdown(); store.close(); rmSync(dir, { recursive: true }); });
  const run = runner.start({ endpoint: 'http://localhost/demo/v1', model: 'demo', prompt: 'Inspect this prompt', apiKey: 'never-store-this', demo: true, concurrency: 1, totalRequests: 1, maxTokens: 4, timeoutSeconds: 5 });
  await runner.active.promise;
  const saved = store.get(run.id);
  assert.equal(saved.results[0].detailStatus, 'saved');
  assert.equal(saved.results[0].details, undefined);
  const data = store.getRequest(run.id, 0);
  assert.equal(data.details.request.body.messages.at(-1).content, 'Inspect this prompt');
  assert.ok(data.details.response.body);
  assert.ok(!JSON.stringify(data).includes('never-store-this'));
});
