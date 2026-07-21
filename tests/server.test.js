import test from 'node:test';import assert from 'node:assert/strict';import {handleRequest} from '../server.js';
function res(){return{statusCode:0,headers:{},body:'',writeHead(s,h){this.statusCode=s;this.headers=h},end(c=''){this.body+=c}}}
async function call(method,url,body){const r=res();const req={method,url,headers:{host:'localhost'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body))}};await handleRequest(req,r);return{status:r.statusCode,payload:JSON.parse(r.body)}}
test('health returns iteration 3.3.2 version',async()=>{const r=await call('GET','/api/health');assert.equal(r.status,200);assert.equal(r.payload.version,'0.3.0-alpha-institutional-learning-iteration-3.3.2')});
test('story list includes evidence and analysis summary',async()=>{const r=await call('GET','/api/stories');assert.equal(r.status,200);assert.ok(Array.isArray(r.payload.stories));assert.ok('evidenceCount' in r.payload.stories[0])});
test('audience profiles are available',async()=>{const r=await call('GET','/api/audiences');assert.equal(r.status,200);assert.ok(r.payload.audiences.length>=5)});
test('missing story returns 404',async()=>{const r=await call('GET','/api/stories/not-real');assert.equal(r.status,404)});
test('unknown route returns 404',async()=>{const r=await call('GET','/api/not-real');assert.equal(r.status,404)});

test('decision queue returns executive briefs',async()=>{const r=await call('GET','/api/decisions');assert.equal(r.status,200);assert.ok(r.payload.decisionBriefs.length>=3);assert.equal(r.payload.decisionBriefs[0].status,'AWAITING_DECISION')});
test('decision brief includes advisory board and explainability',async()=>{const r=await call('GET','/api/decisions/brief_001');assert.equal(r.status,200);assert.equal(r.payload.brief.advisors.length,4);assert.ok(r.payload.brief.explainability.drivers.length>=4)});
test('invalid executive action is rejected',async()=>{const r=await call('POST','/api/decisions/brief_001/actions',{action:'INVALID'});assert.equal(r.status,400)});

test('learning records endpoint is available',async()=>{const r=await call('GET','/api/learning');assert.equal(r.status,200);assert.ok(Array.isArray(r.payload.learningRecords))});
test('learning record can be saved for a decision brief',async()=>{const r=await call('PUT','/api/learning/brief_001',{outcome:'SUCCESS',lessonsLearned:'Direct testimony improves confidence.'});assert.equal(r.status,200);assert.equal(r.payload.learningRecord.outcome,'SUCCESS');assert.match(r.payload.learningRecord.lessonsLearned,/testimony/)});


test('story repository renders stories before the creation form and supports auto-selection',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('id=\"stories\"') < source.indexOf('id=\"storyForm\"'));
  assert.match(source,/if \(!selectedId && stories\.length\) selectedId = stories\[0\]\.id/);
  assert.match(source,/Unable to load stories/);
});
