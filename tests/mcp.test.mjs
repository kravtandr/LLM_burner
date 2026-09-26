import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.mjs';
import { Runner } from '../server/runner.mjs';
import { createApp } from '../server/app.mjs';
const config = { endpoint: 'http://localhost:1234/v1', model: 'mcp-fixture', prompt: 'hello', concurrency: 2, totalRequests: 4, maxTokens: 1, timeoutSeconds: 5, demo: true };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'burner-mcp-'));
  const store = new Store(join(dir, 'db.sqlite')); const runner = new Runner(store);
  const server = createApp({store, runner}).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { for(const client of clients) await client.close(); await runner.shutdown();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true}); });
  const connect = async () => { const client = new Client({name:'integration-test',version:'1.0.0'});clients.push(client); await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));return client; };
  return {store,runner,base,connect};
}
const call = (client,name,args={}) => client.callTool({name,arguments:args});
function data(result) { assert.ok(!result.isError, JSON.stringify(result));assert.deepEqual(result.structuredContent,JSON.parse(result.content[0].text));return result.structuredContent; }

test('MCP client discovers tools, validates config, runs tests and inspects shared history',async t=>{
  const s=await setup(t);const client=await s.connect();
  const tools=(await client.listTools()).tools;
  assert.equal(tools.length,11);assert.equal(tools.find(t=>t.name==='start_test').annotations.readOnlyHint,false);
  assert.equal(tools.find(t=>t.name==='get_run').annotations.readOnlyHint,true);
  assert.equal(tools.find(t=>t.name==='delete_run').annotations.destructiveHint,true);
  assert.equal(data(await call(client,'get_status')).activeRun,null);
  const validated=data(await call(client,'validate_test_config',{config:{...config,apiKey:'mcp-test-secret'}}));
  assert.equal(validated.config.model,config.model);assert.ok(!JSON.stringify(validated).includes('mcp-test-secret'));
  const started=data(await call(client,'start_test',{config:{...config,apiKey:'mcp-test-secret'}}));
  const id=started.run.id;assert.ok(id);assert.ok(!JSON.stringify(started).includes('mcp-test-secret'));
  assert.ok((await(await fetch(s.base+'/api/runs')).json()).some(r=>r.id===id));
  await s.runner.active.promise;
  const run=data(await call(client,'get_run',{runId:id})).run;
  assert.equal(run.status,'completed');assert.equal(run.metrics.success,4);assert.equal(run.results,undefined);
  const page=data(await call(client,'list_requests',{runId:id,offset:1,limit:2}));
  assert.equal(page.results.length,2);assert.equal(page.resultsTotal,4);assert.equal(page.results[0].index,1);assert.equal(page.nextOffset,3);
  const detail=data(await call(client,'get_request_details',{runId:id,index:0}));assert.ok(detail.details.request);assert.ok(detail.details.response);
  assert.ok(data(await call(client,'list_runs')).runs.some(r=>r.id===id));
  assert.equal((await call(client,'get_run',{runId:'missing'})).isError,true);
  assert.equal((await call(client,'list_requests',{runId:id,limit:101})).isError,true);
  data(await call(client,'delete_run',{runId:id}));assert.equal(s.store.get(id),null);
});

test('MCP clients share one runner, stress survives disconnect, and stop cancels load',async t=>{
  const s=await setup(t);const a=await s.connect();const b=await s.connect();
  const started=data(await call(a,'start_test',{config:{...config,testMode:'stress',totalRequests:null,durationSeconds:60,maxTokens:128}})).run;
  await a.close();
  assert.equal(data(await call(b,'get_status')).activeRun.id,started.id);
  assert.equal((await call(b,'start_test',{config})).isError,true);
  assert.equal((await call(b,'delete_run',{runId:started.id})).isError,true);
  const done=s.runner.active.promise;
  data(await call(b,'stop_test',{runId:started.id}));await done;
  assert.equal(data(await call(b,'get_run',{runId:started.id})).run.status,'cancelled');
  // Stopping a completed run is idempotent, without starting or touching other runs.
  assert.equal(data(await call(b,'stop_test',{runId:started.id})).run.status,'cancelled');
});

test('MCP compares bounded summaries and returns actionable validation errors',async t=>{
  const s=await setup(t);const client=await s.connect();
  assert.equal((await call(client,'start_test',{config:{...config,testMode:'stress',durationSeconds:0}})).isError,true);
  assert.equal(s.runner.active,null);
  const ids=[];
  for(let i=0;i<2;i++){ids.push(s.runner.start(config).id);await s.runner.active.promise;}
  const comparison=data(await call(client,'compare_runs',{runIds:ids}));
  assert.equal(comparison.runs.length,2);assert.ok(comparison.runs.every(r=>r.metrics.success===4&&!r.results));
  assert.equal((await call(client,'compare_runs',{runIds:[ids[0],ids[0]]})).isError,true);
  assert.equal((await call(client,'compare_runs',{runIds:[ids[0],'missing']})).isError,true);
});

test('Streamable HTTP uses SSE POST responses, rejects invalid origins and unsupported methods',async t=>{
  const s=await setup(t);const payload=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'raw-test',version:'1'}}});
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  const response=await fetch(s.base+'/mcp',{method:'POST',headers,body:payload});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.match(await response.text(),/llm-burner/);
  assert.match(response.headers.get('cache-control'),/no-cache|no-store/);
  assert.equal((await fetch(s.base+'/mcp',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:payload})).status,403);
  // Node fetch normalizes Host; use raw HTTP to actually send a foreign host.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(s.base+'/mcp', { method:'POST', headers:{...headers,Host:'evil.test'} }, res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end(payload);
  });
  assert.equal(foreignHostStatus,403);
  const malformed=await fetch(s.base+'/mcp',{method:'POST',headers,body:'{'});
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).error.code,-32700);
  for(const method of ['GET','DELETE','PUT']){
    const res=await fetch(s.base+'/mcp',{method});assert.equal(res.status,405);assert.equal(res.headers.get('allow'),'POST');
  }
});
