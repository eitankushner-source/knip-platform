import test from 'node:test';import assert from 'node:assert/strict';import {handleRequest} from '../server.js';
function res(){return{statusCode:0,headers:{},body:'',writeHead(s,h){this.statusCode=s;this.headers=h},end(c=''){this.body+=c}}}
async function call(method,url,body){const r=res();const req={method,url,headers:{host:'localhost'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body))}};await handleRequest(req,r);return{status:r.statusCode,payload:JSON.parse(r.body)}}
test('health returns Sprint 5.1 version',async()=>{const r=await call('GET','/api/health');assert.equal(r.status,200);assert.equal(r.payload.version,'0.7.2-alpha-ai-campaign-strategist')});
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


test('Narrative DNA analysis is generated and persisted',async()=>{
  const reset=await call('POST','/api/reset',{});assert.equal(reset.status,200);
  const result=await call('POST','/api/stories/story_001/analyze',{});
  assert.equal(result.status,201);
  const dna=result.payload.analysis.narrativeDna;
  assert.ok(Array.isArray(dna.humanValues));
  assert.ok(dna.humanValues.length>=1);
  assert.ok(Array.isArray(dna.themes));
  assert.equal(typeof dna.narrativeStrength,'number');
  assert.equal(typeof dna.evidenceQuality,'number');
  assert.match(dna.strategicRisk,/Low|Moderate|High/);
  const detail=await call('GET','/api/stories/story_001');
  assert.ok(detail.payload.analyses[0].narrativeDna);
});

test('Narrative DNA UI is included in Story Workspace',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/NARRATIVE DNA/);
  assert.match(source,/Human values/);
  assert.match(source,/Narrative strength/);
});


test('Audience Intelligence returns enriched profiles and ranked story matches',async()=>{
  await call('POST','/api/reset',{});
  await call('POST','/api/stories/story_001/analyze',{});
  const result=await call('GET','/api/audience-intelligence');
  assert.equal(result.status,200);
  assert.ok(result.payload.audiences.length>=5);
  const sustainability=result.payload.audiences.find(item=>item.id==='aud_sustain');
  assert.ok(sustainability);
  assert.ok(Array.isArray(sustainability.topStories));
  assert.ok(sustainability.topStories.length>=1);
  assert.equal(typeof sustainability.topStories[0].opportunity,'number');
  assert.ok(Array.isArray(sustainability.channels));
});

test('Audience Intelligence workspace is wired into navigation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/audienceIntelligenceTemplate/);
  assert.match(source,/Best story matches/);
  assert.match(source,/Recommended framing/);
});


test('Campaign Planner returns Ruby strategy recommendations', async () => {
  const response = await call('GET','/api/campaign-plans');
  assert.equal(response.status, 200);
  assert.ok(response.payload.campaignPlans.length >= 1);
  const plan = response.payload.campaignPlans[0];
  assert.equal(plan.ruby.name, 'Ruby');
  assert.ok(plan.ruby.recommendation);
  assert.ok(Array.isArray(plan.channels));
  assert.ok(Array.isArray(plan.dependencies));
});

test('Campaign Planner workspace is wired into navigation', async () => {
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source, /campaignPlannerTemplate/);
  assert.match(source, /RUBY · CHIEF STRATEGY OFFICER/);
});
