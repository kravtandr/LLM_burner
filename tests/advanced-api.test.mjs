import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.mjs';
import { seededRandom, intervalMs } from '../server/scheduling.mjs';
import { portableConfig, simpleConfig } from '../shared/settings.mjs';

test('model discovery uses the normalized models route, auth and deduplicated IDs; errors hide secrets', async t => {
  let invalid = false;
  const provider = createServer((req, res) => {
    assert.equal(req.url, '/v1/models'); assert.equal(req.headers.authorization, 'Bearer fixture-secret');
    res.setHeader('Content-Type', 'application/json');
    if (invalid) { res.writeHead(401); return res.end('fixture-secret'); }
    res.end(JSON.stringify({ data: [{ id: 'z' }, { id: 'a' }, { id: 'z' }, { id: 123 }] }));
  });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const server = createApp({ runner: {}, store: {} }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { for (const s of [server, provider]) { s.closeAllConnections(); s.close(); } });
  const url = `http://127.0.0.1:${server.address().port}`;
  const config = { endpoint: `http://127.0.0.1:${provider.address().port}`, apiKey: 'fixture-secret' };
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(await (await post('/api/models', config)).json(), { models: ['a', 'z'] });
  invalid = true; const failure = await post('/api/models', config); assert.equal(failure.status, 400); assert.ok(!(await failure.text()).includes('fixture-secret'));
  const validated = await post('/api/config/validate', { ...config, model: 'a', prompt: 'hello', concurrency: 1, totalRequests: 1, maxTokens: 16, timeoutSeconds: 10, warmupRequests: 2, continuousUsage: true });
  assert.equal(validated.status, 200); const data = await validated.json(); assert.ok(!('apiKey' in data)); assert.equal(data.continuousUsage, true); assert.equal(data.warmupRequests, 2);
  assert.equal((await post('/api/config/validate', { ...data, includeUsage: false })).status, 400);
  assert.equal((await post('/api/models', { ...config, endpoint: 'file:///tmp/models' })).status, 400);
});

test('portable settings remove credentials and simple mode removes all advanced workload knobs', () => {
  const config = { endpoint: 'http://localhost:8000', apiKey: 'secret', demo: true, warmupRequests: 3, continuousUsage: true, loadMode: 'rate', requestRate: 8, prompt: 'hello' };
  assert.equal(portableConfig(config).apiKey, undefined); assert.equal(portableConfig(config).demo, undefined);
  assert.equal(simpleConfig(config).apiKey, 'secret'); assert.equal(simpleConfig(config).warmupRequests, undefined); assert.equal(simpleConfig(config).continuousUsage, undefined); assert.equal(simpleConfig(config).loadMode, undefined);
});

test('Poisson schedule is seed-reproducible and approximates the configured rate', () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  const samples = Array.from({ length: 10000 }, () => intervalMs(5, 'poisson', a));
  assert.deepEqual(samples, Array.from({ length: 10000 }, () => intervalMs(5, 'poisson', b)));
  assert.notEqual(samples[0], intervalMs(5, 'poisson', c));
  assert.ok(samples.every(n => n >= 0 && Number.isFinite(n)));
  const mean = samples.reduce((a, b) => a + b) / samples.length;
  assert.ok(mean > 190 && mean < 210, `mean ${mean}`);
  assert.equal(intervalMs(5, 'constant', a), 200);
});
