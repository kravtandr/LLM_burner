import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from '../server/config.mjs';
import * as scheduling from '../server/scheduling.mjs';
import { Runner } from '../server/runner.mjs';
import { Store } from '../server/store.mjs';
import { simpleConfig } from '../shared/settings.mjs';
const base = { endpoint: 'http://localhost:8000/v1', model: 'fixture', prompt: 'hello', concurrency: 4, totalRequests: 100, maxTokens: 8, timeoutSeconds: 3 };
const points = [{time:0,value:0},{time:1,value:4},{time:2,value:0}];
test('curve configuration validates topology, workload and target bounds; simple mode strips it', () => {
 const c=normalizeConfig({...base,loadCurve:points,curveTarget:'concurrency',curveInterpolation:'linear'});
 assert.deepEqual(c.loadCurve,points);assert.equal(simpleConfig(c).loadCurve,undefined);
 for (const loadCurve of [[{time:0,value:1}], [{time:1,value:1},{time:2,value:2}], [{time:0,value:1},{time:0,value:2}], [{time:0,value:1},{time:3601,value:2}], [{time:0,value:-1},{time:1,value:2}], [{time:0,value:0},{time:1,value:0}], [{time:0,value:1.5},{time:1,value:2}], [{time:0,value:129},{time:1,value:2}]]) assert.throws(()=>normalizeConfig({...base,loadCurve}));
 assert.throws(()=>normalizeConfig({...base,loadCurve:[{time:0,value:0},{time:1,value:1}],curveInterpolation:'step'}));
 assert.throws(()=>normalizeConfig({...base,loadCurve:points,totalRequests:2}));
 assert.equal(normalizeConfig({...base,loadCurve:[{time:0,value:0.5},{time:1,value:1000}],curveTarget:'rate'}).curveTarget,'rate');
});
test('curve interpolation and integrated rate scheduling honor slopes, pauses and terminal time', () => {
 assert.equal(typeof scheduling.curveValue,'function'); assert.equal(typeof scheduling.nextCurveArrival,'function');
 assert.equal(scheduling.curveValue(points,0.5,'linear'),2);assert.equal(scheduling.curveValue(points,1.5,'step'),4);
 const rate=[{time:0,value:0},{time:1,value:0},{time:2,value:4},{time:3,value:0}];
 assert.ok(Math.abs(scheduling.nextCurveArrival(rate,'linear',0,1)-(1+Math.sqrt(0.5)))<1e-8);
 const step=[{time:0,value:0},{time:1,value:10},{time:2,value:0},{time:3,value:0}];
 assert.ok(Math.abs(scheduling.nextCurveArrival(step,'step',0,1)-1.1)<1e-8);
 assert.equal(scheduling.nextCurveArrival(step,'step',1.9,2),Infinity);
 assert.equal(scheduling.nextCurveArrival(step,'step',3,1),Infinity);
});
async function setup(t,delay=45){
 const received=[];let active=0,peak=0;
 const server=createServer(async(req,res)=>{for await(const chunk of req){} received.push(performance.now());active++;peak=Math.max(peak,active);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');setTimeout(()=>{active--;res.end('data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"completion_tokens":8,"prompt_tokens":4}}\n\ndata: [DONE]\n\n');},delay);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const dir=mkdtempSync(join(tmpdir(),'burner-curve-'));const store=new Store(join(dir,'db.sqlite'));const runner=new Runner(store);
 t.after(async()=>{await runner.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true});});
 return{runner,store,received,peak:()=>peak,config:{...base,endpoint:`http://127.0.0.1:${server.address().port}/v1`}};
}
async function finish(runner,id){for(let i=0;i<500;i++){const r=runner.get(id);if(!['running','stopping'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');}
test('concurrency curve pauses dispatch, changes actual overlap and persists timing',async t=>{
 const s=await setup(t,70);const loadCurve=[{time:0,value:1},{time:0.18,value:0},{time:0.32,value:3},{time:0.52,value:0}];
 const r=await finish(s.runner,s.runner.start({...s.config,loadCurve,curveInterpolation:'step',warmupRequests:1}).id);
 const rows=r.results.filter(r=>r.phase==='measurement');assert.ok(rows.length>5);assert.ok(rows.length<30);assert.equal(s.peak(),3);
 assert.ok(rows.every(r=>r.measurementOffsetMs<190||r.measurementOffsetMs>=315));assert.ok(rows.every(r=>r.measurementOffsetMs<540));
 assert.ok(rows.some(r=>r.targetLoad===1));assert.ok(rows.some(r=>r.targetLoad===3));assert.equal(r.warmupCompleted,1);assert.equal(r.metrics.success,rows.length);assert.deepEqual(s.store.get(r.id).config.loadCurve,loadCurve);
});
test('rate curve schedules through a zero-rate pause and uses concurrency cap',async t=>{
 const s=await setup(t,8);const r=await finish(s.runner,s.runner.start({...s.config,concurrency:1,loadCurve:[{time:0,value:0},{time:0.12,value:25},{time:0.32,value:0}],curveTarget:'rate',curveInterpolation:'step'}).id);
 assert.ok(r.metrics.success>=4 && r.metrics.success<=5);assert.equal(s.peak(),1);assert.ok(r.results.every(r=>r.measurementOffsetMs>=155&&r.measurementOffsetMs<335));assert.ok(r.results.every(r=>r.targetLoad===25));
});
test('stop interrupts a paused curve promptly; request limit can end a profile early',async t=>{
 const s=await setup(t);let r=s.runner.start({...s.config,loadCurve:[{time:0,value:0},{time:20,value:2},{time:30,value:0}],curveInterpolation:'step'});
 await new Promise(r=>setTimeout(r,20));const start=performance.now();s.runner.stop(r.id);r=await finish(s.runner,r.id);assert.ok(performance.now()-start<200);assert.equal(s.received.length,0);assert.equal(r.status,'cancelled');
 r=await finish(s.runner,s.runner.start({...s.config,totalRequests:4,loadCurve:[{time:0,value:2},{time:20,value:2}]}).id);assert.equal(r.metrics.success,4);assert.ok(r.elapsedMs<1000);
});

test('short linear concurrency peaks wake at integer crossings instead of skipping the profile', async t => {
 const s=await setup(t,1);
 const r=await finish(s.runner,s.runner.start({...s.config,loadCurve:[{time:0,value:0},{time:.01,value:4},{time:.02,value:0}]}).id);
 assert.ok(r.metrics.success>0, 'A valid 20 ms peak must dispatch requests');
});

test('terminal step value has no duration and does not inflate validation, warmup or stage concurrency', async t => {
 const s=await setup(t,10);
 const r=await finish(s.runner,s.runner.start({...s.config,totalRequests:2,warmupRequests:2,curveInterpolation:'step',loadCurve:[{time:0,value:1},{time:.1,value:128}]}).id);
 assert.equal(r.stages[0].concurrency,1);assert.equal(s.peak(),1);assert.equal(r.metrics.success,2);
});
