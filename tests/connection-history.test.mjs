import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanConnectionValue, connectionValues, loadConnectionHistory, rememberConnectionValue } from '../src/connection-history.mjs';

test('connection history validates endpoint URLs without retaining credentials or query strings',()=>{
 for(const value of ['file:///tmp/a','http://user:secret@localhost/v1','https://example.com/v1?key=secret','https://example.com/#secret','not a URL'])assert.equal(cleanConnectionValue('endpoint',value),'');
 assert.equal(cleanConnectionValue('endpoint',' http://localhost:8000/v1 '),'http://localhost:8000/v1');
 assert.deepEqual(connectionValues('model',[' qwen27b ','qwen27b','','other']),['qwen27b','other']);
 assert.equal(connectionValues('model',Array.from({length:100},(_,i)=>`model-${i}`)).length,50);
});

test('storage denial does not prevent connection editing and committed history keeps most recent first',()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}});
 try{
  let history=loadConnectionHistory();assert.deepEqual(history,{endpoints:[],models:[],last:{}});
  history=rememberConnectionValue(history,'model','first',true);history=rememberConnectionValue(history,'model','second',true);history=rememberConnectionValue(history,'model','first',true);
  assert.deepEqual(history.models,['first','second']);assert.equal(history.last.model,'first');
 }finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});
