import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../server/config.mjs';
import { summarize } from '../server/metrics.mjs';
import { requestCompletion } from '../server/transport.mjs';
import { createServer } from 'node:http';

export const config = { endpoint: 'http://127.0.0.1:1234/v1', model: 'test', prompt: 'Привет', system: '', concurrency: 2, totalRequests: 4, maxTokens: 64, timeoutSeconds: 5, includeUsage: true, tokenParameter: 'max_tokens' };

test('normalizes base URLs and rejects invalid or excessive loads', () => {
  assert.equal(normalizeConfig(config).endpoint, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(normalizeConfig({ ...config, endpoint: 'http://localhost:1234' }).endpoint, 'http://localhost:1234/v1/chat/completions');
  for (const change of [{ concurrency: 1.5 }, { concurrency: 129 }, { totalRequests: 0 }, { endpoint: 'file:///tmp/x' }, { endpoint: 'http://secret:pass@localhost/v1' }, { maxTokens: -1 }, { model: '' }, { prompt: ' ' }]) assert.throws(() => normalizeConfig({ ...config, ...change }));
});

test('throughput uses wall time, per-request TPS uses full duration, errors excluded', () => {
  const m = summarize([{ status: 'success', outputTokens: 100, durationMs: 2000, ttftMs: 200 }, { status: 'success', outputTokens: 200, durationMs: 4000, ttftMs: 400 }, { status: 'error', outputTokens: 999, durationMs: 1 }], 5000);
  assert.equal(m.throughput, 60); assert.equal(m.requestTps, 50); assert.equal(m.outputTokens, 300);
  assert.equal(m.success, 2); assert.equal(m.errors, 1); assert.equal(m.ttftMs, 300); assert.equal(m.latencyP95Ms, 4000);
});

test('missing usage never becomes a fabricated zero or partial aggregate TPS', () => {
  const m = summarize([{ status: 'success', outputTokens: 100, durationMs: 2000 }, { status: 'success', outputTokens: null, durationMs: 1000 }], 3000);
  assert.equal(m.throughput, null); assert.equal(m.usageCoverage, 0.5); assert.equal(m.outputTokens, 100);
  assert.equal(summarize([], 0).throughput, null);
});

async function provider(t, handler) {
  const server = createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
}

const frame = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
test('reads fragmented UTF-8 SSE, ignores role-only chunk and retains usage', async t => {
  const endpoint = await provider(t, async (req, res) => {
    const body = []; for await (const c of req) body.push(c);
    const payload = JSON.parse(Buffer.concat(body));
    assert.equal(payload.max_tokens, 64); assert.equal(payload.stream_options.include_usage, true);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const bytes = Buffer.from(frame({ choices: [{ delta: { role: 'assistant' } }] }) + frame({ choices: [{ delta: { content: 'Привет' } }] }) + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + frame({ choices: [], usage: { completion_tokens: 7, prompt_tokens: 3 } }) + 'data: [DONE]\r\n\r\n');
    for (const byte of bytes) res.write(Buffer.from([byte])); res.end();
  });
  const result = await requestCompletion({ ...config, endpoint });
  assert.equal(result.status, 'success'); assert.equal(result.outputTokens, 7); assert.equal(result.inputTokens, 3);
  assert.ok(result.ttftMs >= 0); assert.ok(result.durationMs >= result.ttftMs);
});

test('missing usage remains null; reasoning is a first token', async t => {
  const endpoint = await provider(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(frame({ choices: [{ delta: { reasoning_content: 'reason' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'); });
  const result = await requestCompletion({ ...config, endpoint });
  assert.equal(result.status, 'success'); assert.equal(result.outputTokens, null); assert.ok(result.ttftMs !== null);
});

for (const [name, response] of [['truncated stream', frame({ choices: [{ delta: { content: 'partial' } }] })], ['malformed event', 'data: {oops}\n\n'], ['provider error', frame({ error: { message: 'bad provider' } })]]) {
  test(`rejects ${name}`, async t => {
    const endpoint = await provider(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response); });
    assert.equal((await requestCompletion({ ...config, endpoint })).status, 'error');
  });
}

test('HTTP errors do not leak the API key', async t => {
  const endpoint = await provider(t, (req, res) => { res.writeHead(401); res.end('invalid secret-123'); });
  const result = await requestCompletion({ ...config, endpoint, apiKey: 'secret-123' });
  assert.equal(result.status, 'error'); assert.equal(result.httpStatus, 401); assert.ok(!JSON.stringify(result).includes('secret-123'));
});

test('timeout and cancellation abort pending requests', async t => {
  const endpoint = await provider(t, () => {});
  const result = await requestCompletion({ ...config, endpoint, timeoutSeconds: 0.03 });
  assert.equal(result.status, 'error'); assert.match(result.error, /timeout/i);
  const controller = new AbortController(); setTimeout(() => controller.abort(), 20);
  assert.equal((await requestCompletion({ ...config, endpoint }, controller.signal)).status, 'cancelled');
});


test('provider finish metadata cannot persist the supplied API key', async t => {
  const endpoint = await provider(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(frame({ choices: [{ delta: { content: 'x' }, finish_reason: 'reason-secret-fixture' }] }) + 'data: [DONE]\n\n');
  });
  const result = await requestCompletion({ ...config, endpoint, apiKey: 'secret-fixture' });
  assert.equal(result.status, 'success'); assert.ok(!JSON.stringify(result).includes('secret-fixture'));
});
