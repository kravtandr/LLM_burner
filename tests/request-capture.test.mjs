import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCompletion } from '../server/transport.mjs';

const base = { endpoint: 'http://localhost/v1/chat/completions', model: 'capture-test', prompt: 'Hello', system: 'Be brief.', maxTokens: 10, tokenParameter: 'max_tokens', timeoutSeconds: 2, includeUsage: true };
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const response = events => async () => new Response(events.map(value => typeof value === 'string' ? value : frame(value)).join(''), { headers: { 'content-type': 'text/event-stream' } });

test('captures actual request options and assembled content, reasoning, tools and usage without raw events', async () => {
  let actual;
  const fetcher = async (_, options) => { actual = JSON.parse(options.body); return response([
    { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Think ', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'look', arguments: '{"x":' } }] } }] },
    { choices: [{ index: 0, delta: { content: 'Hello ', reasoning_content: 'first.', tool_calls: [{ index: 0, function: { name: 'up', arguments: '1}' } }] } }] },
    { choices: [{ index: 0, delta: { content: 'world.' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 7 } },
    'data: [DONE]\n\n',
  ])(); };
  const result = await requestCompletion({ ...base, temperature: 0, topP: 0.8, seed: 7, continuousUsage: true }, undefined, fetcher);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.details.request.body, actual);
  assert.equal(result.details.request.method, 'POST'); assert.equal(result.details.request.url, base.endpoint);
  assert.deepEqual(result.details.request.headers, { 'Content-Type': 'application/json' });
  const captured = result.details.response;
  assert.equal(captured.format, 'assembled-sse'); assert.equal(captured.status, 200); assert.equal(captured.done, true);
  assert.equal(captured.contentType, 'text/event-stream'); assert.equal(captured.events, undefined);
  assert.deepEqual(captured.body.choices[0].message, { role: 'assistant', content: 'Hello world.', reasoning_content: 'Think first.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"x":1}' } }] });
  assert.equal(captured.body.choices[0].finish_reason, 'tool_calls'); assert.equal(captured.body.usage.completion_tokens, 7);
  assert.equal(result.details.truncated, false);
});

test('redacts API key from request and assembled strings even when split across SSE chunks', async () => {
  const apiKey = 'sk-private-capture-12345';
  const result = await requestCompletion({ ...base, apiKey, prompt: `Prompt ${apiKey}`, endpoint: `${base.endpoint}?token=${apiKey}` }, undefined, response([
    { choices: [{ delta: { content: 'Echo sk-private-', reasoning_content: 'sk-private-', tool_calls: [{ index: 0, function: { name: 'echo', arguments: '{"token":"sk-private-' } }] } }] },
    { choices: [{ delta: { content: 'capture-12345', reasoning_content: 'capture-12345', tool_calls: [{ index: 0, function: { arguments: 'capture-12345"}' } }] }, finish_reason: 'stop' }] },
    'data: [DONE]\n\n',
  ]));
  const serialized = JSON.stringify(result.details);
  assert.ok(!serialized.includes(apiKey)); assert.ok(!serialized.includes('Authorization'));
  const message = result.details.response.body.choices[0].message;
  assert.equal(message.content, 'Echo [redacted]'); assert.equal(message.reasoning_content, '[redacted]');
  assert.equal(message.tool_calls[0].function.arguments, '{"token":"[redacted]"}');
  assert.equal(result.details.request.body.messages[1].content, 'Prompt [redacted]');
});

test('captures and recursively redacts HTTP JSON errors including property names', async () => {
  const apiKey = 'sk-private-capture-12345';
  const result = await requestCompletion({ ...base, apiKey }, undefined, async () => new Response(JSON.stringify({ error: { message: `Denied ${apiKey}` }, [apiKey]: ['nested', apiKey] }), { status: 401, headers: { 'content-type': 'application/json' } }));
  assert.equal(result.status, 'error'); assert.equal(result.httpStatus, 401);
  assert.equal(result.details.response.format, 'http-body'); assert.equal(result.details.response.done, true);
  assert.deepEqual(result.details.response.body, { error: { message: 'Denied [redacted]' }, '[redacted]': ['nested', '[redacted]'] });
  assert.ok(!JSON.stringify(result).includes(apiKey));
});

test('retains partial assembled response after an incomplete stream and captures provider error messages', async () => {
  const partial = await requestCompletion(base, undefined, response([{ choices: [{ delta: { content: 'Partial text' } }] }]));
  assert.equal(partial.status, 'error'); assert.equal(partial.details.response.done, false);
  assert.equal(partial.details.response.body.choices[0].message.content, 'Partial text');
  const error = await requestCompletion(base, undefined, response([{ choices: [{ delta: { content: 'Started' } }] }, { error: { message: 'Model failed.' } }]));
  assert.equal(error.details.response.body.error.message, 'Model failed.');
  assert.equal(error.details.response.body.choices[0].message.content, 'Started');
});

test('request and response capture are bounded, marked truncated, and cannot expose a key cut at the capture boundary', async () => {
  const apiKey = 'sk-private-capture-12345';
  const result = await requestCompletion({ ...base, apiKey, prompt: 'p'.repeat(400000) + apiKey }, undefined, response([
    { choices: [{ delta: { content: 'x'.repeat(256 * 1024 - 4) + apiKey } }] },
    { choices: [{ delta: { content: 'tail' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }, 'data: [DONE]\n\n',
  ]));
  assert.equal(result.status, 'success'); assert.equal(result.outputTokens, 10);
  assert.equal(result.details.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.details.request)) <= 256 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(result.details.response)) <= 256 * 1024);
  assert.ok(!JSON.stringify(result.details).includes('sk-p'));
});

test('oversized HTTP body is bounded and explicitly partial without changing HTTP error category', async () => {
  const result = await requestCompletion(base, undefined, async () => new Response('x'.repeat(400000), { status: 500 }));
  assert.equal(result.errorType, 'http_500'); assert.equal(result.details.truncated, true);
  assert.equal(result.details.response.done, false); assert.equal(result.details.response.format, 'http-body');
  assert.ok(Buffer.byteLength(JSON.stringify(result.details.response)) <= 256 * 1024);
});

test('redacts unicode-escaped credentials in incomplete HTTP JSON capture', async () => {
  const apiKey = 'sk-private-capture-12345';
  const encoded = apiKey.split('').map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const result = await requestCompletion({ ...base, apiKey }, undefined, async () => new Response(`{"token":"${encoded}","large":"${'x'.repeat(400000)}"}`, { status: 400, headers: { 'content-type': 'application/json' } }));
  assert.equal(result.details.truncated, true);
  assert.ok(!JSON.stringify(result.details).includes(encoded.replaceAll('\\', '\\\\')));
  assert.ok(JSON.stringify(result.details).includes('[redacted]'));
});

test('HTTP body capture is time-bounded and retains known status plus partial data', async () => {
  const started = performance.now();
  const result = await requestCompletion({ ...base, timeoutSeconds: 0.6 }, undefined, async (_, { signal }) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('partial error'));
    signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
  } }), { status: 429 }));
  assert.equal(result.errorType, 'http_429'); assert.ok(performance.now() - started < 500);
  assert.equal(result.details.truncated, true); assert.equal(result.details.response.done, false);
  assert.equal(result.details.response.body, 'partial error');
});

test('HTTP read failure keeps its HTTP category and response metadata', async () => {
  const result = await requestCompletion(base, undefined, async () => new Response(new ReadableStream({ pull(controller) { controller.error(new Error('socket failed')); } }), { status: 401 }));
  assert.equal(result.errorType, 'http_401'); assert.equal(result.details.truncated, true);
  assert.equal(result.details.response.status, 401);
});

test('preserves bounded recognized response metadata and ignores arbitrary metadata', async () => {
  const apiKey = 'sk-private-capture-12345';
  const result = await requestCompletion({ ...base, apiKey }, undefined, response([
    { id: 'completion-1', model: `model-${apiKey}`, object: 'chat.completion.chunk', created: 12345, system_fingerprint: 'fp_1', service_tier: 'default', unknown: 'do not store', choices: [{ delta: { content: 'reply' }, finish_reason: 'stop' }] }, 'data: [DONE]\n\n',
  ]));
  const body = result.details.response.body;
  assert.equal(body.id, 'completion-1'); assert.equal(body.model, 'model-[redacted]'); assert.equal(body.object, 'chat.completion.chunk');
  assert.equal(body.created, 12345); assert.equal(body.system_fingerprint, 'fp_1'); assert.equal(body.service_tier, 'default');
  assert.equal(body.unknown, undefined);
});
