import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { normalizeConfig } from '../server/config.mjs';
import { Runner } from '../server/runner.mjs';
import { Store } from '../server/store.mjs';
const base = { testMode: 'stress', endpoint: 'http://localhost/v1', model: 'fixture', prompt: 'hello', concurrency: 2, maxTokens: 8, timeoutSeconds: 5, durationSeconds: .15 };
test('stress requires positive duration, has no request cap and rejects competing stopping modes', () => {
  assert.equal(normalizeConfig(base).totalRequests, null);
  assert.equal(normalizeConfig({...base,totalRequests:1}).totalRequests,null);
  for (const patch of [{durationSeconds:0},{durationSeconds:-1},{durationSeconds:3601},{sweepConcurrency:[2,4]},{loadCurve:[{time:0,value:1},{time:1,value:1}]}]) assert.throws(()=>normalizeConfig({...base,...patch}));
  assert.throws(()=>normalizeConfig({...base,testMode:'benchmark'}));
});
async function setup(t, delay) {
  const dir=mkdtempSync(join(tmpdir(),'burner-stress-'));const store=new Store(join(dir,'db.sqlite'));let active=0,peak=0;const starts=[];
  const server=createServer((req,res)=>{starts.push(performance.now());active++;peak=Math.max(peak,active);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');setTimeout(()=>{active--;res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":2}}\n\ndata: [DONE]\n\n');},delay);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const runner=new Runner(store);
  t.after(async()=>{await runner.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});});
  return {runner,store,starts,peak:()=>peak,config:{...base,endpoint:`http://127.0.0.1:${server.address().port}/v1`}};
}
test('stress continues beyond a stale request limit and persists paginated results by time',async t=>{
  const s=await setup(t,10);const created=s.runner.start({...s.config,totalRequests:1});await s.runner.active.promise;
  const run=s.store.get(created.id);assert.equal(run.status,'completed');assert.equal(run.plannedRequests,null);assert.equal(run.config.totalRequests,null);assert.ok(run.metrics.completed>2);assert.equal(s.peak(),2);assert.ok(run.elapsedMs>=150);
  assert.ok(s.starts.at(-1)-s.starts[0]<160);const page=s.runner.getPage(run.id,1,2);assert.equal(page.results.length,2);assert.equal(page.resultsTotal,run.results.length);assert.equal(page.results[0].index,1);
});
test('stress shows draining after deadline, can be stopped, and warmup is outside duration',async t=>{
  const s=await setup(t,180);const created=s.runner.start({...s.config,durationSeconds:.03,warmupRequests:1});
  await new Promise(r=>setTimeout(r,250));assert.equal(s.runner.get(created.id).phase,'draining');assert.equal(s.starts.length,3);s.runner.stop(created.id);await s.runner.active.promise;
  const run=s.store.get(created.id);assert.equal(run.status,'cancelled');assert.equal(run.warmupCompleted,1);assert.equal(run.metrics.completed,2);assert.equal(run.metrics.cancelled,2);
});
