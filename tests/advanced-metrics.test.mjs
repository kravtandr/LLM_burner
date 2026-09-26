import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../server/metrics.mjs';
import { requestCompletion } from '../server/transport.mjs';

const success = fields => ({ status: 'success', durationMs: 1000, ...fields });
const config = { endpoint: 'http://localhost/v1/chat/completions', model: 'fixture', prompt: 'test', maxTokens: 10, tokenParameter: 'max_tokens', timeoutSeconds: 2, includeUsage: true };
const frame = object => `data: ${JSON.stringify(object)}\r\n\r\n`;
function streamFetcher(parts, onRequest = () => {}) {
  return async (_, options) => {
    onRequest(JSON.parse(options.body));
    let index = 0;
    return new Response(new ReadableStream({ async pull(controller) {
      if (index === parts.length) return controller.close();
      const part = parts[index++];
      if (part.delay) await new Promise(resolve => setTimeout(resolve, part.delay));
      controller.enqueue(new TextEncoder().encode(part.text ?? part));
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
}

test('measurement distributions ignore warmup/errors and use nearest-rank percentiles and population stddev', () => {
  const metrics = summarize([
    success({ durationMs: 1, phase: 'warmup', outputTokens: 10000 }),
    success({ durationMs: 10, outputTokens: 0, queueMs: 0 }),
    success({ durationMs: 20, outputTokens: 2, queueMs: 4 }),
    success({ durationMs: 30, outputTokens: 4 }),
    success({ durationMs: 40, outputTokens: 6 }),
    { status: 'error', durationMs: 10000 },
  ], 1000);
  assert.equal(metrics.completed, 5);
  assert.deepEqual(metrics.distributions.latencyMs, { count: 4, mean: 25, min: 10, max: 40, stddev: Math.sqrt(125), p50: 20, p90: 40, p95: 40, p99: 40 });
  assert.equal(metrics.distributions.queueMs.count, 2);
  assert.equal(metrics.distributions.queueMs.mean, 2);
  assert.equal(metrics.distributions.outputTokens.count, 4);
  assert.deepEqual(metrics.distributions.ttfoMs, { count: 0, mean: null, min: null, max: null, stddev: null, p50: null, p90: null, p95: null, p99: null });
});

test('token totals, rates, finish reasons and cost retain zero usage and ignore warmup', () => {
  const metrics = summarize([
    success({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 20, reasoningTokens: 2, finishReason: 'stop' }),
    success({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, finishReason: 'length' }),
    { status: 'error', errorType: 'http_429' }, { status: 'cancelled' },
  ], 2000, { inputPricePerMillion: 2, outputPricePerMillion: 10 });
  assert.equal(metrics.inputTokens, 100); assert.equal(metrics.inputUsageCoverage, 1);
  assert.equal(metrics.inputThroughput, 50); assert.equal(metrics.totalThroughput, 55);
  assert.equal(metrics.cacheHitRate, 0.2); assert.equal(metrics.reasoningTokens, 2);
  assert.equal(metrics.costUsd, 0.0003);
  assert.equal(metrics.successRate, 0.5); assert.equal(metrics.errorRate, 0.25); assert.equal(metrics.cancelRate, 0.25);
  assert.deepEqual(metrics.errorsByType, { http_429: 1 });
  assert.deepEqual(metrics.finishReasons, { stop: 1, length: 1 });
});

test('incomplete usage never produces aggregate input/total throughput, cost or a cache-hit estimate', () => {
  const metrics = summarize([success({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 2 }), success({ outputTokens: 4 })], 1000, { inputPricePerMillion: 2, outputPricePerMillion: 10 });
  assert.equal(metrics.inputUsageCoverage, 0.5);
  for (const field of ['inputThroughput', 'totalThroughput', 'costUsd', 'cacheHitRate', 'reasoningTokens']) assert.equal(metrics[field], null, field);
  assert.equal(summarize([success({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })], 1000).cacheHitRate, null);
});

test('SLO goodput requires all enabled metrics and excludes unknowns and failed requests', () => {
  const metrics = summarize([
    success({ ttftMs: 100, tpotMs: 10, outputTokens: 20 }),
    success({ ttftMs: 101, tpotMs: 10, outputTokens: 50 }),
    success({ ttftMs: 30, tpotMs: null, outputTokens: 10 }),
    { status: 'error', ttftMs: 10, tpotMs: 1 },
  ], 2000, { sloTtftMs: 100, sloTpotMs: 10, sloLatencyMs: 1000 });
  assert.equal(metrics.sloPassed, 1); assert.equal(metrics.sloFailed, 1); assert.equal(metrics.sloUnknown, 1);
  assert.equal(metrics.sloCoverage, 2 / 3);
  assert.equal(metrics.goodputRequestsPerSecond, 0.5); assert.equal(metrics.goodputTokensPerSecond, 10);
  assert.equal(summarize([success({})], 1000).goodputRequestsPerSecond, null);
  assert.equal(summarize([success({ ttftMs: 1 })], 1000, { sloTtftMs: 2 }).goodputTokensPerSecond, null);
});

test('invalid or missing samples never enter distributions, and zero elapsed time has no rates', () => {
  const metrics = summarize([success({ durationMs: NaN, ttftMs: Infinity, inputTokens: -1, outputTokens: null, queueMs: -1 })], 0);
  assert.equal(metrics.distributions.latencyMs.count, 0); assert.equal(metrics.distributions.ttftMs.count, 0);
  assert.equal(metrics.distributions.inputTokens.count, 0); assert.equal(metrics.distributions.queueMs.count, 0);
  assert.equal(metrics.requestsPerSecond, null); assert.equal(metrics.requestTps, null);
  assert.equal(summarize([], 1000).reasoningTokens, null);
});

test('prefill estimate uses provider input usage and first-chunk latency; good fraction includes errors and cancellations', () => {
  const metrics = summarize([
    success({ inputTokens: 100, ttftMs: 200, decodeDurationMs: 800, iclMaxMs: 50 }),
    success({ inputTokens: 0, ttftMs: 0, decodeDurationMs: 0 }),
    success({ inputTokens: 50, ttftMs: null }),
    { status: 'error' }, { status: 'cancelled' },
  ], 2000, { sloTtftMs: 200 });
  assert.equal(metrics.distributions.prefillTps.count, 1); assert.equal(metrics.distributions.prefillTps.mean, 500);
  assert.equal(metrics.distributions.decodeDurationMs.count, 2); assert.equal(metrics.distributions.decodeDurationMs.mean, 400);
  assert.equal(metrics.distributions.iclMaxMs.mean, 50);
  assert.equal(metrics.goodRequestFraction, 0.4);
  assert.equal(summarize([], 0, { sloTtftMs: 1 }).goodRequestFraction, 0);
  assert.equal(summarize([], 0).goodRequestFraction, null);
});

test('SSE reports reasoning versus visible latency, generated chunk intervals, usage details and request sampling options', async () => {
  const parts = [
    frame({ choices: [{ index: 0, delta: { role: 'assistant' } }] }),
    frame({ choices: [{ index: 0, delta: { reasoning_content: 'reason' } }] }),
    { delay: 12, text: frame({ choices: [{ index: 0, delta: { content: 'visible' } }] }) },
    { delay: 12, text: frame({ choices: [{ index: 0, delta: { content: 'answer', reasoning: 'extra' } }] }) },
    frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    frame({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 2, accepted_prediction_tokens: 1, rejected_prediction_tokens: 0 } } }),
    'data: [DONE]\r\n\r\n',
  ];
  const result = await requestCompletion({ ...config, temperature: 0, topP: 0.9, seed: 0 }, undefined, streamFetcher(parts, body => {
    assert.equal(body.temperature, 0); assert.equal(body.top_p, 0.9); assert.equal(body.seed, 0);
  }));
  assert.equal(result.status, 'success'); assert.equal(result.chunkCount, 3); assert.equal(result.finishReason, 'stop');
  assert.ok(result.ttfoMs > result.ttftMs); assert.ok(result.ttstMs >= 5);
  assert.equal(result.iclMs, result.decodeDurationMs / 2);
  assert.ok(result.iclMaxMs >= result.iclMs);
  assert.equal(result.tpotMs, result.decodeDurationMs / 4);
  assert.equal(result.decodeTps, 1000 / result.tpotMs);
  assert.equal(result.reasoningTokens, 2); assert.equal(result.cachedInputTokens, 10);
  assert.equal(result.acceptedPredictionTokens, 1); assert.equal(result.rejectedPredictionTokens, 0);
  assert.equal(result.bytesReceived, parts.reduce((sum, part) => sum + Buffer.byteLength(part.text ?? part), 0));
});

test('single reasoning chunk retains unknown visible/token interval metrics and omits unset sampling options', async () => {
  const result = await requestCompletion({ ...config, temperature: null, topP: null, seed: null }, undefined, streamFetcher([
    frame({ choices: [{ delta: { reasoning: 'hmm' }, finish_reason: 'length' }], usage: { completion_tokens: 5 } }), 'data: [DONE]\n\n',
  ], body => { assert.ok(!('temperature' in body)); assert.ok(!('top_p' in body)); assert.ok(!('seed' in body)); }));
  assert.equal(result.chunkCount, 1); assert.equal(result.decodeDurationMs, 0);
  for (const field of ['ttfoMs', 'ttstMs', 'tpotMs', 'decodeTps', 'iclMs', 'iclMaxMs', 'cachedInputTokens']) assert.equal(result[field], null, field);
});

test('zero-token completion preserves zero and malformed usage stays unknown', async () => {
  const result = await requestCompletion(config, undefined, streamFetcher([
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 0, prompt_tokens: 0, completion_tokens_details: { reasoning_tokens: -1 }, prompt_tokens_details: { cached_tokens: '0' } } }), 'data: [DONE]\n\n',
  ]));
  assert.equal(result.status, 'success'); assert.equal(result.chunkCount, 0); assert.equal(result.outputTokens, 0);
  assert.equal(result.reasoningTokens, null); assert.equal(result.cachedInputTokens, null); assert.equal(result.tpotMs, null);
});

test('provider errors and truncated streams receive bounded categorical error types', async () => {
  const malformed = await requestCompletion(config, undefined, streamFetcher(['data: {oops}\n\n']));
  assert.equal(malformed.status, 'error'); assert.equal(malformed.errorType, 'parse_error');
  const truncated = await requestCompletion(config, undefined, streamFetcher([frame({ choices: [{ delta: { content: 'partial' } }] })]));
  assert.equal(truncated.status, 'error'); assert.equal(truncated.errorType, 'incomplete_stream');
  const http = await requestCompletion(config, undefined, async () => new Response('secret', { status: 429 }));
  assert.equal(http.errorType, 'http_429');
});

test('opt-in continuous usage corrects batched first chunk and requests required usage options', async () => {
  const result = await requestCompletion({ ...config, includeUsage: false, continuousUsage: true }, undefined, streamFetcher([
    frame({ choices: [{ delta: { content: 'three tokens here' } }], usage: { completion_tokens: 3 } }),
    { delay: 8, text: frame({ choices: [{ delta: { content: 'remaining seven tokens' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }) },
    'data: [DONE]\n\n',
  ], body => { assert.deepEqual(body.stream_options, { include_usage: true, continuous_usage_stats: true }); }));
  assert.equal(result.status, 'success'); assert.equal(result.firstChunkTokens, 3);
  assert.equal(result.decodeTokenCount, 7); assert.equal(result.tokenTimingMethod, 'usage-corrected');
  assert.equal(result.tpotMs, result.decodeDurationMs / 7);
});

test('continuous usage correction falls back for absent, zero, invalid and inconsistent first chunk counts', async () => {
  for (const first of [undefined, 0, -1, '3', 10, 11]) {
    const result = await requestCompletion({ ...config, continuousUsage: true }, undefined, streamFetcher([
      frame({ choices: [{ delta: { content: 'start' } }], usage: { completion_tokens: first } }),
      frame({ choices: [{ delta: { content: 'end' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }),
      'data: [DONE]\n\n',
    ]));
    assert.equal(result.tokenTimingMethod, 'estimated', String(first)); assert.equal(result.decodeTokenCount, 9);
    assert.equal(result.tpotMs, result.decodeDurationMs / 9);
  }
});

test('default timing remains estimated even with unsolicited chunk usage; one chunk remains unavailable', async () => {
  for (const includeUsage of [true, false]) {
    const result = await requestCompletion({ ...config, includeUsage }, undefined, streamFetcher([
      frame({ choices: [{ delta: { content: 'start' } }], usage: { completion_tokens: 3 } }),
      frame({ choices: [{ delta: { content: 'end' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }),
      'data: [DONE]\n\n',
    ], body => { assert.ok(!body.stream_options?.continuous_usage_stats); if (!includeUsage) assert.equal(body.stream_options, undefined); }));
    assert.equal(result.firstChunkTokens, 3); assert.equal(result.tokenTimingMethod, 'estimated'); assert.equal(result.decodeTokenCount, 9);
  }
  const one = await requestCompletion({ ...config, continuousUsage: true }, undefined, streamFetcher([
    frame({ choices: [{ delta: { content: 'whole answer' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }), 'data: [DONE]\n\n',
  ]));
  assert.equal(one.tokenTimingMethod, 'unavailable'); assert.equal(one.decodeTokenCount, null); assert.equal(one.tpotMs, null);
});

test('summary includes timing provenance, prediction usage and transfer/chunk distributions without warmup', () => {
  const metrics = summarize([
    success({ phase: 'warmup', tokenTimingMethod: 'usage-corrected', acceptedPredictionTokens: 999, rejectedPredictionTokens: 999, bytesReceived: 999, chunkCount: 999 }),
    success({ tokenTimingMethod: 'usage-corrected', acceptedPredictionTokens: 3, rejectedPredictionTokens: 1, bytesReceived: 100, chunkCount: 2 }),
    success({ tokenTimingMethod: 'estimated', acceptedPredictionTokens: 0, rejectedPredictionTokens: 0, bytesReceived: 200, chunkCount: 4 }),
    success({ acceptedPredictionTokens: 2, rejectedPredictionTokens: 2 }),
  ], 1000);
  assert.deepEqual(metrics.timingMethods, { 'usage-corrected': 1, estimated: 1, unavailable: 1 });
  assert.equal(metrics.acceptedPredictionTokens, 5); assert.equal(metrics.rejectedPredictionTokens, 3);
  assert.equal(metrics.distributions.bytesReceived.mean, 150); assert.equal(metrics.distributions.chunkCount.mean, 3);
  assert.equal(summarize([success({})], 1000).acceptedPredictionTokens, null);
});
