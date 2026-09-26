import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Use a separate Compose project and volume; never touch the user's history.
const project = `llm-burner-smoke-${process.pid}`;
const port = process.env.DOCKER_TEST_PORT || '14310';
const env = { ...process.env, PORT: port };
const base = `http://127.0.0.1:${port}`;
const compose = (...args) => execFileSync('docker', ['compose', '-p', project, ...args], { env, stdio: 'inherit' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mcp = new Client({ name: 'docker-smoke', version: '1.0.0' });
async function tool(name, args = {}) {
  const response = await mcp.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response));
  return response.structuredContent;
}
let received = 0;
const fixture = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'docker-fixture' }] })); return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  received++;
  req.resume();
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
  setTimeout(() => res.end('data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: [DONE]\n\n'), 25);
});
async function api(path, body) {
  const response = await fetch(base + path, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', Origin: base },
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}
async function finish(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await api(`/api/runs/${id}`);
    if (!['running', 'stopping'].includes(run.status)) { assert.equal(run.status, 'completed'); return run; }
    await wait(100);
  }
  throw Error('Run did not finish');
}
try {
  compose('up', '-d', '--build', '--wait');
  assert.equal((await api('/api/health')).ok, true);
  await mcp.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  assert.equal((await mcp.listTools()).tools.length, 11);
  assert.equal((await tool('get_status')).activeRun, null);
  const html = await (await fetch(base)).text();
  const asset = html.match(/src="([^\"]+\.js)"/);
  assert.ok(asset, 'Built UI entry script is served');
  assert.equal((await fetch(base + asset[1])).status, 200);
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://example.com' } })).status, 403);
  compose('exec', '-T', 'llm-burner', 'node', '-e', 'if(process.getuid()===0)process.exit(1)');
  await new Promise(resolve => fixture.listen(0, '0.0.0.0', resolve));
  const endpoint = `http://host.docker.internal:${fixture.address().port}/v1`;
  assert.deepEqual((await tool('list_models', { endpoint })).models, ['docker-fixture']);
  const config = { endpoint, model: 'docker-fixture', prompt: 'Docker smoke test', concurrency: 2, totalRequests: 4, maxTokens: 8, timeoutSeconds: 5 };
  const benchmark = await finish((await tool('start_test', { config })).run.id);
  assert.equal(benchmark.metrics.success, 4);
  assert.equal(benchmark.metrics.outputTokens, 8);
  const captured = await api(`/api/runs/${benchmark.id}/requests/0`);
  assert.ok(captured.details.request);
  assert.ok(captured.details.response);
  const stress = await finish((await tool('start_test', { config: { ...config, testMode: 'stress', totalRequests: null, durationSeconds: 1 } })).run.id);
  assert.ok(stress.metrics.success > 4);
  assert.equal(stress.plannedRequests, null);
  assert.equal(received, benchmark.metrics.success + stress.metrics.success);
  compose('up', '-d', '--force-recreate', '--wait');
  const restored = await api(`/api/runs/${benchmark.id}`);
  assert.equal(restored.metrics.success, 4);
  assert.deepEqual((await api(`/api/runs/${benchmark.id}/requests/0`)).details, captured.details);
  assert.equal((await api(`/api/runs/${stress.id}`)).metrics.success, stress.metrics.success);
  assert.equal((await tool('get_run', { runId: benchmark.id })).run.metrics.success, 4);
  console.log('Docker smoke passed: MCP Streamable HTTP workflow, health, UI assets, origin checks, non-root runtime, host endpoint discovery, streaming benchmark, timed stress test, and persistence after recreation.');
} finally {
  await mcp.close();
  fixture.closeAllConnections();
  if (fixture.listening) await new Promise(resolve => fixture.close(resolve));
  compose('down', '--volumes', '--remove-orphans');
}
