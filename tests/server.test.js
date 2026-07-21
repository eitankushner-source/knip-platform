import test from 'node:test';import assert from 'node:assert/strict';import {handleRequest} from '../server.js';
function res(){return{statusCode:0,headers:{},body:'',writeHead(s,h){this.statusCode=s;this.headers=h},end(c=''){this.body+=c}}}
async function call(method,url,body){const r=res();const req={method,url,headers:{host:'localhost'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body))}};await handleRequest(req,r);return{status:r.statusCode,payload:JSON.parse(r.body)}}
test('health returns iteration 3.1 version',async()=>{const r=await call('GET','/api/health');assert.equal(r.status,200);assert.equal(r.payload.version,'0.3.0-alpha-executive-workspace-iteration-3.1')});
test('story list includes evidence and analysis summary',async()=>{const r=await call('GET','/api/stories');assert.equal(r.status,200);assert.ok(Array.isArray(r.payload.stories));assert.ok('evidenceCount' in r.payload.stories[0])});
test('audience profiles are available',async()=>{const r=await call('GET','/api/audiences');assert.equal(r.status,200);assert.ok(r.payload.audiences.length>=5)});
test('missing story returns 404',async()=>{const r=await call('GET','/api/stories/not-real');assert.equal(r.status,404)});
test('unknown route returns 404',async()=>{const r=await call('GET','/api/not-real');assert.equal(r.status,404)});
