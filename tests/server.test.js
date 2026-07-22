import test from 'node:test';import assert from 'node:assert/strict';import {handleRequest, normalizeStoryItem, deduplicateStories, scoreStory, buildDashboardPayload} from '../server.js';
function res(){return{statusCode:0,headers:{},body:'',writeHead(s,h){this.statusCode=s;this.headers=h},end(c=''){this.body+=c}}}
async function call(method,url,body){const r=res();const req={method,url,headers:{host:'localhost'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body))}};await handleRequest(req,r);return{status:r.statusCode,payload:JSON.parse(r.body)}}
test('health returns Sprint 9 version',async()=>{const r=await call('GET','/api/health');assert.equal(r.status,200);assert.equal(r.payload.version,'0.9.0-alpha-ai-advisory-board')});

test('normalized stories include provenance and scoring metadata', async () => {
  const story = normalizeStoryItem({
    id:'live_001',
    title:'Israeli water tech helps drought-hit communities',
    summary:'A practical innovation is helping farmers address water scarcity.',
    published_at:'2026-07-20T12:00:00Z',
    url:'https://example.com/story-1',
    geography:['Israel'],
    audiences:['farmers','community'],
    narratives:['resilience','innovation'],
    confidence:0.86,
    source:{connector:'gdelt-doc',source_name:'The Times of Israel',source_url:'https://example.com/story-1',collected_at:'2026-07-21T10:00:00Z',reliability:0.82,freshness:'live',license_note:'live metadata'}
  }, 'gdelt-doc', 'GDELT DOC 2.0');
  assert.equal(story.connector,'GDELT DOC 2.0');
  assert.equal(story.sourceName,'The Times of Israel');
  assert.equal(story.sourceUrl,'https://example.com/story-1');
  assert.ok(Array.isArray(story.audienceTags));
  assert.ok(typeof story.relevanceScore === 'number');
  assert.ok(story.status === 'VALIDATED' || story.status === 'REVIEW');
});

test('deduplication collapses near-duplicate stories', () => {
  const stories = [
    normalizeStoryItem({id:'dup_a', title:'Israeli water tech helps drought-hit communities', summary:'A practical innovation...', published_at:'2026-07-20T12:00:00Z', url:'https://example.com/story-1', geography:['Israel'], audiences:['farmers'], narratives:['resilience'], confidence:0.8, source:{connector:'gdelt-doc',source_name:'The Times',source_url:'https://example.com/story-1',collected_at:'2026-07-21T10:00:00Z',reliability:0.8,freshness:'live',license_note:'x'}} , 'gdelt-doc', 'GDELT DOC 2.0'),
    normalizeStoryItem({id:'dup_b', title:'Israeli water technology helps drought-struck communities', summary:'A practical innovation...', published_at:'2026-07-20T12:00:00Z', url:'https://example.com/story-2', geography:['Israel'], audiences:['farmers'], narratives:['resilience'], confidence:0.77, source:{connector:'rss',source_name:'Another Source',source_url:'https://example.com/story-2',collected_at:'2026-07-21T10:00:00Z',reliability:0.78,freshness:'live',license_note:'x'}} , 'rss', 'Curated RSS')
  ];
  const deduped = deduplicateStories(stories);
  assert.equal(deduped.length, 1);
});

test('story scoring weights evidence, audience, freshness, authenticity, and strategic relevance', () => {
  const story = scoreStory(normalizeStoryItem({id:'score_001', title:'Israeli innovation improves community resilience', summary:'A strong example of practical impact.', published_at:'2026-07-21T08:00:00Z', url:'https://example.com/score', geography:['Israel'], audiences:['community','farmers'], narratives:['resilience','innovation'], confidence:0.88, source:{connector:'gdelt-doc',source_name:'Reuters',source_url:'https://example.com/score',collected_at:'2026-07-21T09:00:00Z',reliability:0.9,freshness:'live',license_note:'x'}} , 'gdelt-doc', 'GDELT DOC 2.0'));
  assert.ok(story.relevanceScore >= 75);
  assert.ok(story.evidenceQuality >= 80);
  assert.ok(story.freshness >= 80);
  assert.ok(story.authenticityScore >= 80);
});

test('sanitizes story text and removes embedded markup', () => {
  const story = normalizeStoryItem({
    id:'sanitize_001',
    title:'<h1>Israeli&nbsp;startup helps families</h1>',
    summary:'<p>Helping communities &#38; families <script>bad</script></p>',
    published_at:'2026-07-21T08:00:00Z',
    url:'https://example.com/sanitize',
    geography:['Israel'],
    audiences:['community'],
    narratives:['innovation'],
    confidence:0.86,
    source:{connector:'gdelt-doc',source_name:'Reuters',source_url:'https://example.com/sanitize',collected_at:'2026-07-21T09:00:00Z',reliability:0.9,freshness:'live',license_note:'x'}
  }, 'gdelt-doc', 'GDELT DOC 2.0');
  assert.equal(story.title, 'Israeli startup helps families');
  assert.equal(story.summary, 'Helping communities & families');
});

test('deduplication prefers the stronger duplicate version', () => {
  const stories = [
    normalizeStoryItem({id:'dup_weak', title:'Israeli water tech helps communities', summary:'A practical innovation...', published_at:'2026-07-20T12:00:00Z', url:'https://example.com/dup', geography:['Israel'], audiences:['farmers'], narratives:['resilience'], confidence:0.72, source:{connector:'gdelt-doc',source_name:'The Times',source_url:'https://example.com/dup',collected_at:'2026-07-21T10:00:00Z',reliability:0.74,freshness:'live',license_note:'x'}}, 'gdelt-doc', 'GDELT DOC 2.0'),
    normalizeStoryItem({id:'dup_strong', title:'Israeli water technology helps communities', summary:'A stronger practical innovation...', published_at:'2026-07-20T12:00:00Z', url:'https://example.com/dup', geography:['Israel'], audiences:['farmers','community'], narratives:['resilience','innovation'], confidence:0.88, source:{connector:'rss',source_name:'The Times',source_url:'https://example.com/dup',collected_at:'2026-07-21T10:00:00Z',reliability:0.9,freshness:'live',license_note:'x'}}, 'rss', 'Curated RSS')
  ];
  const deduped = deduplicateStories(stories);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'dup_strong');
});

test('relevance filtering excludes malformed or weak stories', () => {
  const payload = buildDashboardPayload([
    {id:'bad', title:'   ', summary:'', sourceUrl:null, evidenceQuality:20, freshness:20, authenticityScore:20, relevanceScore:20, reliability:0.2, confidence:0.2, audienceTags:[], narrativeTags:[], connector:'rss', collectedAt:'2026-07-22T00:00:00Z', publishedAt:'2026-07-22T00:00:00Z', status:'REVIEW'},
    {id:'good', title:'Israeli innovation supports healthcare in Israel', summary:'A practical story of better care and measurable impact for patients and communities.', sourceUrl:'https://example.com/good', evidenceQuality:82, freshness:91, authenticityScore:86, relevanceScore:84, reliability:0.92, confidence:0.9, audienceTags:['Healthcare Professionals'], narrativeTags:['innovation','humanitarian'], connector:'gdelt-doc', collectedAt:'2026-07-22T00:00:00Z', publishedAt:'2026-07-22T00:00:00Z', status:'VALIDATED'}
  ], true);
  assert.equal(payload.priorityDecision.title, 'Israeli innovation supports healthcare in Israel');
  assert.equal(payload.metrics.storiesValidated.value, 1);
});

test('audience tagging adds supported audiences where evidence fits', () => {
  const story = normalizeStoryItem({
    id:'aud_001',
    title:'Young Hispanic evangelical leaders see Israeli innovation as a model for community service',
    summary:'Healthcare professionals and sustainability leaders are discussing the impact of Israeli technology on public health.',
    published_at:'2026-07-21T08:00:00Z',
    url:'https://example.com/aud',
    geography:['Israel'],
    audiences:['community'],
    narratives:['innovation','humanitarian'],
    confidence:0.88,
    source:{connector:'gdelt-doc',source_name:'Reuters',source_url:'https://example.com/aud',collected_at:'2026-07-21T09:00:00Z',reliability:0.9,freshness:'live',license_note:'x'}
  }, 'gdelt-doc', 'GDELT DOC 2.0');
  assert.ok(story.audienceTags.includes('Young Hispanic Evangelicals'));
  assert.ok(story.audienceTags.includes('Healthcare Professionals'));
  assert.ok(story.audienceTags.includes('Sustainability Leaders'));
});

test('dashboard priority eligibility requires strong, recent, and relevant stories', () => {
  const payload = buildDashboardPayload([
    {id:'weak', title:'Political controversy dominates the news', summary:'A political story with no clear strategic value.', sourceUrl:'https://example.com/weak', evidenceQuality:55, freshness:50, authenticityScore:54, relevanceScore:52, reliability:0.6, confidence:0.6, audienceTags:['community'], narrativeTags:['politics'], connector:'rss', collectedAt:'2026-07-22T00:00:00Z', publishedAt:'2026-07-22T00:00:00Z', status:'REVIEW'},
    {id:'eligible', title:'Israeli technology strengthens healthcare access', summary:'A relevant and credible story about humanitarian impact and innovation.', sourceUrl:'https://example.com/eligible', evidenceQuality:82, freshness:91, authenticityScore:88, relevanceScore:84, reliability:0.92, confidence:0.9, audienceTags:['Healthcare Professionals'], narrativeTags:['innovation','humanitarian'], connector:'gdelt-doc', collectedAt:'2026-07-22T00:00:00Z', publishedAt:'2026-07-22T00:00:00Z', status:'VALIDATED'}
  ], true);
  assert.equal(payload.priorityDecision.title, 'Israeli technology strengthens healthcare access');
  assert.equal(payload.sourceMode, 'LIVE');
});

test('dashboard falls back when no eligible stories are available', () => {
  const payload = buildDashboardPayload([
    {id:'bad', title:'Homepage', summary:'Just a navigation page', sourceUrl:'https://example.com', evidenceQuality:40, freshness:40, authenticityScore:40, relevanceScore:35, reliability:0.4, confidence:0.4, audienceTags:[], narrativeTags:[], connector:'rss', collectedAt:'2026-07-22T00:00:00Z', publishedAt:'2026-07-22T00:00:00Z', status:'REVIEW'}
  ], true);
  assert.equal(payload.fallback, true);
  assert.equal(payload.sourceMode, 'FALLBACK');
  assert.equal(payload.priorityDecision.title, 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation');
});

test('dashboard priority selection uses the highest-ranked live story', () => {
  const payload = buildDashboardPayload([
    {id:'low', title:'Israeli story with moderate value', summary:'A useful but less compelling story about shared innovation and community impact.', audienceTags:['community'], narrativeTags:['innovation'], evidenceQuality:62, freshness:70, authenticityScore:70, relevanceScore:64, reliability:0.7, confidence:0.72, selected: false, connector:'rss', sourceUrl:'https://example.com/low', collectedAt:'2026-07-22T00:00:00Z', status:'REVIEW'},
    {id:'high', title:'Israeli technology strengthens healthcare access', summary:'A compelling live recommendation about humanitarian innovation and patient impact.', audienceTags:['Healthcare Professionals','community'], narrativeTags:['innovation','humanitarian'], evidenceQuality:84, freshness:92, authenticityScore:88, relevanceScore:88, reliability:0.93, confidence:0.95, selected: true, connector:'gdelt-doc', sourceUrl:'https://example.com/high', collectedAt:'2026-07-22T00:00:00Z', status:'VALIDATED'}
  ], true);
  assert.equal(payload.priorityDecision.title, 'Israeli technology strengthens healthcare access');
  assert.equal(payload.sourceMode, 'LIVE');
  assert.equal(payload.metrics.storiesValidated.value, 2);
});

test('dashboard falls back cleanly when no live stories are available', () => {
  const payload = buildDashboardPayload([], false);
  assert.equal(payload.fallback, true);
  assert.equal(payload.source, 'FALLBACK');
  assert.equal(payload.priorityDecision.title, 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation');
});

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


test('Institutional Learning Engine returns metrics, insights, and reusable patterns', async () => {
  await call('POST','/api/reset',{});
  const response = await call('GET','/api/learning-intelligence');
  assert.equal(response.status,200);
  assert.ok(response.payload.intelligence.metrics.totalDecisions >= 3);
  assert.ok(response.payload.intelligence.insights.length >= 1);
  assert.ok(response.payload.intelligence.reusablePatterns.length >= 1);
});

test('Institutional Learning workspace includes confidence evolution and outcome metrics', async () => {
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/CONFIDENCE EVOLUTION/);
  assert.match(source,/What KNIP now knows/);
  assert.match(source,/Positive sentiment/);
});


test('AI Advisory Board synthesizes multiple executive perspectives', async () => {
  const response=await call('GET','/api/advisory-board/brief_001');
  assert.equal(response.status,200);
  assert.ok(response.payload.session.advisors.length>=3);
  assert.ok(response.payload.session.agreements.length>=1);
  assert.ok(response.payload.session.disagreements.length>=1);
  assert.match(response.payload.session.recommendation,/APPROVE|RESEARCH|HOLD/);
});

test('AI Advisory Board workspace is wired into navigation', async () => {
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/AI EXECUTIVE ADVISORY BOARD/);
  assert.match(source,/AREAS OF AGREEMENT/);
  assert.match(source,/SYNTHESIZED RECOMMENDATION/);
});

test('primary navigation keeps shortcuts and restores Decision Center visibility', async () => {
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(source,/data-route="decisions"/);
  assert.match(source,/>Reports</);
  assert.match(source,/>Knowledge Graph/);
  assert.match(source,/>Settings/);
  assert.match(source,/data-route="research"/);
  assert.match(source,/data-route="admin"/);
  assert.match(source,/>Live<\/small>/);
  assert.match(source,/>Preview<\/small>/);
});

test('frontend includes endpoint capability maps for audit traceability', async () => {
  const {readFile}=await import('node:fs/promises');
  const publicApp=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const legacyApi=await readFile(new URL('../api.js',import.meta.url),'utf8');
  assert.match(publicApp,/ENDPOINT_CAPABILITY_MAP/);
  assert.match(publicApp,/window\.KNIP_ENDPOINT_CAPABILITY_MAP/);
  assert.match(legacyApi,/capabilityMap/);
  assert.match(legacyApi,/window\.KNIPApi/);
});

test('mode A endpoint smoke returns expected success codes', async () => {
  const checks = [
    ['GET', '/api/health'],
    ['GET', '/api/dashboard'],
    ['GET', '/api/stories'],
    ['GET', '/api/audience-intelligence'],
    ['GET', '/api/campaign-plans'],
    ['GET', '/api/decisions'],
    ['GET', '/api/advisory-board'],
    ['GET', '/api/learning-intelligence'],
    ['GET', '/api/audit']
  ];
  for (const [method, path] of checks) {
    const result = await call(method, path);
    assert.equal(result.status, 200, `${method} ${path} should return 200`);
  }
});

test('dual-runtime smoke assets are present for both entry UIs', async () => {
  const {readFile}=await import('node:fs/promises');
  const rootIndex=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const publicIndex=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const compose=await readFile(new URL('../docker-compose.yml',import.meta.url),'utf8');
  const nginx=await readFile(new URL('../nginx.conf',import.meta.url),'utf8');
  assert.match(rootIndex,/<script src="api\.js"><\/script>/);
  assert.match(rootIndex,/<script src="app\.js"><\/script>/);
  assert.match(publicIndex,/<script type="module" src="\/app\.js"><\/script>/);
  assert.match(compose,/services:/);
  assert.match(compose,/\n  api:/);
  assert.match(compose,/\n  ui:/);
  assert.match(nginx,/proxy_pass http:\/\/api:8000\/api\//);
});

test('docker root UI exposes Decision Center as a separate primary navigation item', async () => {
  const {readFile}=await import('node:fs/promises');
  const rootIndex=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(rootIndex,/data-view="brief"/);
  assert.match(rootIndex,/>Decision Center</);
  assert.match(rootIndex,/>Executive Brief</);
  assert.match(rootIndex,/>Executive Home</);
});
