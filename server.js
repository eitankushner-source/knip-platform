import http from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.resolve(__dirname, process.env.KNIP_DATA_FILE || './data/database.json');
const SEED_FILE = path.resolve(__dirname, './data/seed.json');
const VERSION = '0.8.0-alpha-institutional-learning-engine';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

async function ensureDatabase() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  try { await access(DATA_FILE); }
  catch { await writeFile(DATA_FILE, await readFile(SEED_FILE, 'utf8'), 'utf8'); }
}
async function readDb() { await ensureDatabase(); return JSON.parse(await readFile(DATA_FILE, 'utf8')); }
async function writeDb(db) { await writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); }
function sendJson(res, status, payload) { res.writeHead(status, jsonHeaders); res.end(JSON.stringify(payload)); }
function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') { res.writeHead(status, { 'content-type': contentType }); res.end(body); }
async function readBody(req) {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON body'); }
}
function audit(db, action, entityType, entityId, actorId = 'usr_admin', detail = '') {
  db.auditEvents ??= [];
  db.auditEvents.unshift({ id:`audit_${crypto.randomUUID()}`, action, entityType, entityId, actorId, detail, createdAt:new Date().toISOString() });
}
function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(value))); }
function keywords(text) {
  const stop = new Set(['about','after','again','against','because','been','being','between','could','from','have','into','more','other','should','their','there','these','they','this','through','under','using','were','which','with','would']);
  const counts = new Map();
  for (const token of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) {
    if (stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,10).map(([word])=>word);
}
function classify(text) {
  const t = text.toLowerCase();
  const categories = [
    ['Climate & Sustainability', ['water','climate','drought','agriculture','energy','environment','sustainability']],
    ['Health & Human Impact', ['health','medical','hospital','patient','therapy','disease','care']],
    ['Technology & Innovation', ['technology','innovation','startup','software','cyber','research','science']],
    ['Community & Civil Society', ['community','education','volunteer','coexistence','civil','school','society']],
    ['Security & Resilience', ['security','resilience','emergency','defense','recovery','preparedness']]
  ];
  return categories.find(([, terms]) => terms.some(term => t.includes(term)))?.[0] || 'General Human Impact';
}
function scoreSignals(story, evidence) {
  const text = `${story.title} ${story.summary} ${story.fullNarrative || ''} ${evidence.map(e=>`${e.title} ${e.claim}`).join(' ')}`.toLowerCase();
  const humanTerms = ['family','farmer','patient','student','child','community','livelihood','life','people','human'];
  const strategyTerms = ['innovation','solution','impact','scale','replicate','partnership','technology','community'];
  const riskTerms = ['unverified','claim','conflict','political','controversy','unclear','anonymous'];
  const termScore = terms => terms.filter(term=>text.includes(term)).length;
  const evidenceCount = evidence.length;
  const sourceCount = new Set(evidence.map(e=>e.sourceUrl || e.sourceName).filter(Boolean)).size;
  const avgReliability = evidenceCount ? evidence.reduce((sum,e)=>sum+Number(e.reliability||50),0)/evidenceCount : 25;
  const completeness = clamp(28 + (story.summary?.length > 100 ? 16 : 6) + (story.fullNarrative?.length > 250 ? 14 : 0) + evidenceCount*11 + sourceCount*6 + (story.country ? 4 : 0) + (story.sourceType ? 4 : 0));
  const credibility = clamp(avgReliability*.62 + sourceCount*9 + evidenceCount*4);
  const humanImpact = clamp(42 + termScore(humanTerms)*7 + (story.summary?.length > 120 ? 8 : 0));
  const strategicValue = clamp(38 + termScore(strategyTerms)*6 + (evidenceCount>=2 ? 12 : 0) + (story.tags?.length||0)*2);
  const opportunity = clamp(humanImpact*.34 + strategicValue*.38 + credibility*.28);
  const risk = clamp(58 - credibility*.38 + termScore(riskTerms)*9 + (sourceCount<2 ? 14 : 0) + (evidenceCount<2 ? 12 : 0));
  const confidence = clamp(completeness*.42 + credibility*.38 + Math.max(0,100-risk)*.20);
  return { evidenceCount, sourceCount, completeness, credibility, humanImpact, strategicValue, opportunity, risk, confidence };
}

function uniqueMatches(text, catalog) {
  const lower = text.toLowerCase();
  return catalog.filter(([label, terms]) => terms.some(term => lower.includes(term))).map(([label]) => label);
}
function buildNarrativeDna(story, evidence, scores, combined) {
  const humanValues = uniqueMatches(combined, [
    ['Innovation',['innovation','technology','solution','research','science']],
    ['Sustainability',['sustainability','water','climate','drought','environment','agriculture']],
    ['Community',['community','family','local','volunteer','together']],
    ['Compassion',['care','patient','humanitarian','support','help']],
    ['Education',['student','school','education','learning']],
    ['Resilience',['resilience','recovery','emergency','preparedness','drought']],
    ['Equality',['equality','access','inclusive','diversity']]
  ]);
  const emotions = uniqueMatches(combined, [
    ['Hope',['hope','helps','solution','future','improve']],
    ['Empathy',['family','patient','farmer','child','livelihood']],
    ['Optimism',['innovation','opportunity','success','growth']],
    ['Trust',['evidence','verified','research','independent']],
    ['Inspiration',['transform','breakthrough','resilience','impact']],
    ['Gratitude',['thank','gratitude','appreciation']]
  ]);
  const themes = uniqueMatches(combined, [
    ['Water',['water','irrigation']],['Agriculture',['farmer','agriculture','crop']],
    ['Climate Resilience',['climate','drought','resilience']],['Health',['health','medical','patient']],
    ['Technology',['technology','innovation','startup','software']],['Education',['education','school','student']],
    ['Humanitarian Impact',['humanitarian','aid','relief']],['Emergency Response',['emergency','first responder','rescue']],
    ['Diversity',['diversity','coexistence','inclusive']],['Science',['science','research','academic']]
  ]);
  const beneficiaries = uniqueMatches(combined, [
    ['Farmers',['farmer','agriculture','crop']],['Children',['child','children']],['Patients',['patient','medical']],
    ['Students',['student','school']],['First responders',['first responder','emergency worker']],
    ['Entrepreneurs',['entrepreneur','startup']],['Local communities',['community','local']],['Families',['family','livelihood']]
  ]);
  const evidenceQuality = clamp(scores.credibility * .65 + scores.completeness * .35);
  const narrativeStrength = clamp(scores.humanImpact * .30 + scores.strategicValue * .25 + evidenceQuality * .25 + (100 - scores.risk) * .20);
  const riskLevel = scores.risk >= 65 ? 'High' : scores.risk >= 40 ? 'Moderate' : 'Low';
  const trustSignals = [
    ...(scores.sourceCount > 1 ? ['Multiple independent sources'] : []),
    ...(evidence.some(item => Number(item.reliability || 0) >= 75) ? ['High-reliability evidence'] : []),
    ...(story.author ? ['Named author or witness'] : []),
    ...(evidence.some(item => /interview|testimony/i.test(item.sourceType || item.title || '')) ? ['Direct testimony'] : [])
  ];
  return {
    humanValues: humanValues.length ? humanValues : ['Human impact'],
    emotionalSignals: emotions.length ? emotions : ['Curiosity'],
    themes: themes.length ? themes : ['Human Impact'],
    beneficiaries: beneficiaries.length ? beneficiaries : ['Local communities'],
    trustSignals, evidenceQuality, narrativeStrength, strategicRisk: riskLevel,
    scoring: { humanImpact:scores.humanImpact, emotionalResonance:clamp(45 + emotions.length*9 + scores.humanImpact*.25), evidenceQuality, credibility:scores.credibility, novelty:clamp(55 + (story.tags?.length||0)*5), relevance:scores.strategicValue, clarity:scores.completeness }
  };
}

function matchAudiences(story, analysis, audiences) {
  const dna = analysis.narrativeDna || {};
  const text = `${story.title} ${story.summary} ${story.fullNarrative || ''} ${analysis.category} ${analysis.keywords.join(' ')} ${(dna.humanValues||[]).join(' ')} ${(dna.themes||[]).join(' ')} ${(dna.emotionalSignals||[]).join(' ')}`.toLowerCase();
  return audiences.map(audience => {
    const matched = (audience.signals || []).filter(signal => text.includes(signal.toLowerCase()));
    const valueMatches = (audience.values || []).filter(value => (dna.humanValues || []).some(item => item.toLowerCase() === value.toLowerCase()));
    const themeMatches = (audience.themes || []).filter(theme => (dna.themes || []).some(item => item.toLowerCase().includes(theme.toLowerCase()) || theme.toLowerCase().includes(item.toLowerCase())));
    const thematicFit = clamp(35 + matched.length*10 + valueMatches.length*9 + themeMatches.length*8);
    const emotionalFit = clamp(40 + (dna.emotionalSignals || []).length*6 + analysis.humanImpact*.25);
    const credibilityFit = clamp((dna.evidenceQuality ?? analysis.credibility)*.75 + analysis.completeness*.25);
    const opportunity = clamp(thematicFit*.38 + emotionalFit*.22 + credibilityFit*.22 + analysis.strategicValue*.18);
    const risk = clamp(analysis.risk + (matched.length===0 ? 12 : 0) + ((audience.sensitivities||[]).some(term=>text.includes(term.toLowerCase())) ? 18 : 0));
    const match = clamp(opportunity - risk*.18 + 10, 20, 98);
    const reasons = [
      ...(matched.length ? [`Strong signal alignment: ${matched.slice(0,4).join(', ')}.`] : []),
      ...(valueMatches.length ? [`Shared values: ${valueMatches.slice(0,3).join(', ')}.`] : []),
      ...(themeMatches.length ? [`Relevant themes: ${themeMatches.slice(0,3).join(', ')}.`] : []),
      ...(analysis.humanImpact >= 70 ? ['The human impact is concrete and accessible.'] : []),
      ...(credibilityFit >= 70 ? ['Evidence quality supports initial audience testing.'] : []),
      ...(risk >= 55 ? ['Use careful framing and small-scale message testing before broad distribution.'] : [])
    ];
    return {
      audienceId: audience.id, name: audience.name, description: audience.description || '',
      match, opportunity, risk, thematicFit, emotionalFit, credibilityFit,
      rationale: reasons[0] || 'Moderate fit; additional evidence and audience testing would improve confidence.',
      reasons, channels: audience.channels || [], messengers: audience.messengers || [],
      framing: audience.framing || 'Lead with concrete human impact and avoid political abstraction.'
    };
  }).sort((a,b)=>b.match-a.match).slice(0,7);
}

function analyzeStory(story, evidence, audiences) {
  const combined = `${story.title} ${story.summary} ${story.fullNarrative || ''} ${evidence.map(e=>`${e.title} ${e.claim}`).join(' ')}`;
  const scores = scoreSignals(story,evidence);
  const narrativeDna = buildNarrativeDna(story, evidence, scores, combined);
  const analysis = {
    id:`analysis_${crypto.randomUUID()}`, storyId:story.id, category:classify(combined), keywords:keywords(combined),
    ...scores, narrativeDna, summary:story.summary || `A story concerning ${story.title}.`,
    strengths:[
      ...(scores.humanImpact>=70 ? ['Strong, relatable human impact'] : []),
      ...(scores.sourceCount>1 ? ['Multiple distinct sources support review'] : []),
      ...(scores.strategicValue>=70 ? ['Clear strategic narrative potential'] : []),
      ...(scores.evidenceCount ? [`${scores.evidenceCount} evidence item${scores.evidenceCount===1?'':'s'} catalogued`] : ['Clear story premise'])
    ],
    risks:[
      ...(scores.evidenceCount<2 ? ['Insufficient corroborating evidence'] : []),
      ...(scores.sourceCount<2 ? ['Limited source diversity'] : []),
      ...(story.summary.length<100 ? ['Story summary needs more context'] : []),
      ...(scores.risk>=60 ? ['Elevated reputational or framing risk'] : [])
    ],
    missingEvidence:[
      ...(scores.sourceCount<2 ? ['Add a second independent source.'] : []),
      ...(scores.evidenceCount<3 ? ['Add a direct quote, outcome metric, or primary document.'] : []),
      ...(!story.author ? ['Identify the original author or witness where possible.'] : [])
    ],
    recommendation:scores.confidence>=75 && scores.risk<55?'Advance to audience matching':scores.confidence>=55?'Continue research before campaign planning':'Hold for additional evidence',
    explainability:{
      why:`The recommendation balances evidence completeness (${scores.completeness}%), credibility (${scores.credibility}%), strategic value (${scores.strategicValue}%), human impact (${scores.humanImpact}%), and risk (${scores.risk}%).`,
      improve:scores.sourceCount<2?'Add another independent source and a measurable outcome.':'Validate audience fit through human review and small-scale message testing.'
    },
    model:'KNIP Narrative DNA deterministic analyzer v1', createdAt:new Date().toISOString()
  };
  analysis.audienceMatches = matchAudiences(story,analysis,audiences||[]);
  return analysis;
}

function buildCampaignPlans(db){
  const briefs=db.decisionBriefs||[]; const audiences=db.audiences||[];
  return briefs.map((brief,index)=>{
    const audience=audiences.find(a=>a.name===brief.audience)||audiences[index%Math.max(audiences.length,1)]||{};
    const confidence=Number(brief.confidence||80); const risk=(brief.risks||[]).length*12+18;
    const objective=confidence>=88?'Change perceptions':confidence>=78?'Build trust':'Increase awareness';
    const framing=audience.framing||'Lead with authentic human impact, shared values, and measurable outcomes.';
    const priority=confidence>=90?'IMMEDIATE':confidence>=82?'HIGH':'NORMAL';
    const recommendation=confidence>=88&&risk<55?'PROCEED':confidence>=75?'PROCEED_WITH_REVISIONS':'HOLD';
    return {id:`campaign_${brief.id}`,briefId:brief.id,storyId:brief.storyId,title:brief.title,audience:brief.audience,status:'DRAFT',durationWeeks:4,confidence,objective,priority,budget:confidence>=90?'MEDIUM':'SMALL',complexity:(audience.channels||[]).length>3?'COMPLEX':'MEDIUM',framing,channels:audience.channels||['Instagram','Partner newsletters'],messengers:audience.messengers||['Field practitioners'],coreMessages:['Lead with the people affected','Show measurable outcomes','Mention Israel after the human benefit'],assets:['60-second video','Infographic','Human-interest article','Social media carousel'],cta:'Learn how practical Israeli innovation is improving lives.',kpis:['Reach','Engagement','Positive sentiment','Click-through rate'],dependencies:['Confirm one additional independent outcome source','Secure participant permissions','Prepare audience-specific creative assets'],ruby:{name:'Ruby',role:'Chief Strategy Officer',recommendation,confidence,objective,priority,budget:confidence>=90?'MEDIUM':'SMALL',complexity:(audience.channels||[]).length>3?'COMPLEX':'MEDIUM',narrative:'Human Story',summary:`Position this as a ${objective.toLowerCase()} campaign. Lead with the beneficiaries, mention Israel second, avoid political framing, and emphasize verified human impact.`,strengths:['Strong human-interest angle','Clear audience relevance','Practical and measurable benefit'],risks:brief.risks||['Avoid promotional tone','Verify all outcome claims'],why:`This recommendation reflects ${confidence}% decision confidence, the selected audience profile, evidence quality, and execution feasibility.`}};
  });
}

async function serveStatic(req,res) {
  const requested=req.url==='/'?'/index.html':req.url;
  const safe=path.normalize(requested).replace(/^\.\.(\/|\\|$)/,'');
  const filePath=path.join(__dirname,'public',safe);
  if(!filePath.startsWith(path.join(__dirname,'public'))) return false;
  try { const body=await readFile(filePath); const ext=path.extname(filePath); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}; sendText(res,200,body,types[ext]||'application/octet-stream'); return true; }
  catch { return false; }
}

function buildLearningIntelligence(db) {
  const records = db.learningRecords || [];
  const completed = records.filter(r => r.outcome && r.outcome !== 'PENDING');
  const successful = completed.filter(r => r.outcome === 'SUCCESS');
  const partial = completed.filter(r => r.outcome === 'PARTIAL');
  const successRate = completed.length ? clamp((successful.length + partial.length * .5) / completed.length * 100) : 0;
  const patterns = new Map();
  for (const record of records) for (const tag of record.patterns || []) patterns.set(tag, (patterns.get(tag) || 0) + 1);
  const reusablePatterns = [...patterns.entries()].sort((a,b)=>b[1]-a[1]).map(([label,count])=>({label,count}));
  const insights = records.flatMap(r => r.insights || []).map((text,index)=>({id:`insight_${index}`,text})).slice(0,8);
  return { metrics:{totalDecisions:records.length,completedCampaigns:completed.length,successRate,lessonsCaptured:records.filter(r=>r.lessonsLearned).length,reusablePatterns:reusablePatterns.length}, reusablePatterns, insights, records };
}

export async function handleRequest(req,res) {
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/api/health') return sendJson(res,200,{status:'ok',service:'knip-platform',version:VERSION,timestamp:new Date().toISOString()});
  if(req.method==='GET'&&url.pathname==='/api/audiences'){const db=await readDb();return sendJson(res,200,{audiences:db.audiences||[]});}
  if(req.method==='GET'&&url.pathname==='/api/audience-intelligence'){
    const db=await readDb();
    const stories=(db.stories||[]).map(story=>{const analysis=(db.analyses||[]).find(item=>item.storyId===story.id)||null;return{story,analysis,matches:analysis?matchAudiences(story,analysis,db.audiences||[]):[]};});
    const audienceSummaries=(db.audiences||[]).map(audience=>{const ranked=stories.filter(item=>item.analysis).map(item=>{const match=item.matches.find(m=>m.audienceId===audience.id);return match?{storyId:item.story.id,storyTitle:item.story.title,...match}:null;}).filter(Boolean).sort((a,b)=>b.match-a.match);return{...audience,topStories:ranked.slice(0,5),averageMatch:ranked.length?clamp(ranked.reduce((sum,item)=>sum+item.match,0)/ranked.length):0};});
    return sendJson(res,200,{audiences:audienceSummaries,stories});
  }
  if(req.method==='GET'&&url.pathname==='/api/stories'){
    const db=await readDb(); const stories=(db.stories||[]).map(s=>({...s,evidenceCount:(db.evidence||[]).filter(e=>e.storyId===s.id).length,latestAnalysis:(db.analyses||[]).find(a=>a.storyId===s.id)||null})); return sendJson(res,200,{stories});
  }
  const storyMatch=url.pathname.match(/^\/api\/stories\/([^/]+)$/);
  if(req.method==='GET'&&storyMatch){const db=await readDb();const story=db.stories.find(s=>s.id===storyMatch[1]);if(!story)return sendJson(res,404,{error:'Story not found'});return sendJson(res,200,{story,evidence:(db.evidence||[]).filter(e=>e.storyId===story.id),analyses:(db.analyses||[]).filter(a=>a.storyId===story.id)});}
  if(req.method==='POST'&&url.pathname==='/api/stories'){
    try{const body=await readBody(req);if(!body.title||typeof body.title!=='string')return sendJson(res,400,{error:'title is required'});const db=await readDb();db.stories??=[];db.evidence??=[];db.analyses??=[];const now=new Date().toISOString();const story={id:`story_${crypto.randomUUID()}`,title:body.title.trim(),summary:String(body.summary||'').trim(),fullNarrative:String(body.fullNarrative||'').trim(),source:String(body.source||'').trim(),sourceType:String(body.sourceType||'').trim(),author:String(body.author||'').trim(),country:String(body.country||'').trim(),location:String(body.location||'').trim(),language:String(body.language||'English').trim(),publishedAt:String(body.publishedAt||'').trim(),urls:Array.isArray(body.urls)?body.urls.filter(Boolean):[],tags:Array.isArray(body.tags)?body.tags.filter(Boolean):[],status:'NEW',createdAt:now,updatedAt:now};db.stories.unshift(story);audit(db,'STORY_CREATED','STORY',story.id);await writeDb(db);return sendJson(res,201,{story});}catch(error){return sendJson(res,400,{error:error.message});}
  }
  if(req.method==='PATCH'&&storyMatch){
    try{const body=await readBody(req);const db=await readDb();const story=db.stories.find(s=>s.id===storyMatch[1]);if(!story)return sendJson(res,404,{error:'Story not found'});const allowed=['title','summary','fullNarrative','source','sourceType','author','country','location','language','publishedAt','status'];for(const key of allowed)if(key in body)story[key]=String(body[key]).trim();if(Array.isArray(body.tags))story.tags=body.tags.filter(Boolean);if(Array.isArray(body.urls))story.urls=body.urls.filter(Boolean);story.updatedAt=new Date().toISOString();audit(db,'STORY_UPDATED','STORY',story.id);await writeDb(db);return sendJson(res,200,{story});}catch(error){return sendJson(res,400,{error:error.message});}
  }
  const evidenceMatch=url.pathname.match(/^\/api\/stories\/([^/]+)\/evidence$/);
  if(req.method==='POST'&&evidenceMatch){try{const body=await readBody(req);if(!body.title||!body.claim)return sendJson(res,400,{error:'title and claim are required'});const db=await readDb();const story=db.stories.find(s=>s.id===evidenceMatch[1]);if(!story)return sendJson(res,404,{error:'Story not found'});db.evidence??=[];const item={id:`evidence_${crypto.randomUUID()}`,storyId:story.id,title:String(body.title).trim(),claim:String(body.claim).trim(),sourceName:String(body.sourceName||'').trim(),sourceUrl:String(body.sourceUrl||'').trim(),sourceType:String(body.sourceType||'').trim(),reliability:clamp(Number(body.reliability||50)),createdAt:new Date().toISOString()};db.evidence.unshift(item);story.status='RESEARCHING';story.updatedAt=new Date().toISOString();audit(db,'EVIDENCE_ADDED','EVIDENCE',item.id,'usr_admin',`Story ${story.id}`);await writeDb(db);return sendJson(res,201,{evidence:item});}catch(error){return sendJson(res,400,{error:error.message});}}
  const analyzeMatch=url.pathname.match(/^\/api\/stories\/([^/]+)\/analyze$/);
  if(req.method==='POST'&&analyzeMatch){const db=await readDb();const story=db.stories.find(s=>s.id===analyzeMatch[1]);if(!story)return sendJson(res,404,{error:'Story not found'});db.analyses??=[];const analysis=analyzeStory(story,(db.evidence||[]).filter(e=>e.storyId===story.id),db.audiences||[]);db.analyses.unshift(analysis);story.status='NEEDS_REVIEW';story.updatedAt=new Date().toISOString();audit(db,'STORY_ANALYZED','STORY',story.id,'usr_admin',`Confidence ${analysis.confidence}; opportunity ${analysis.opportunity}`);await writeDb(db);return sendJson(res,201,{analysis});}
  if(req.method==='GET'&&url.pathname==='/api/campaign-plans'){const db=await readDb();return sendJson(res,200,{campaignPlans:buildCampaignPlans(db)});}
  const campaignMatch=url.pathname.match(/^\/api\/campaign-plans\/([^/]+)$/);
  if(req.method==='GET'&&campaignMatch){const db=await readDb();const plan=buildCampaignPlans(db).find(item=>item.id===campaignMatch[1]);if(!plan)return sendJson(res,404,{error:'Campaign plan not found'});return sendJson(res,200,{campaignPlan:plan});}
  if(req.method==='GET'&&url.pathname==='/api/decisions'){const db=await readDb();return sendJson(res,200,{decisionBriefs:db.decisionBriefs||[],executiveDecisions:db.executiveDecisions||[]});}
  const decisionMatch=url.pathname.match(/^\/api\/decisions\/([^/]+)$/);
  if(req.method==='GET'&&decisionMatch){const db=await readDb();const brief=(db.decisionBriefs||[]).find(item=>item.id===decisionMatch[1]);if(!brief)return sendJson(res,404,{error:'Decision brief not found'});const decisions=(db.executiveDecisions||[]).filter(item=>item.briefId===brief.id);return sendJson(res,200,{brief,decisions});}
  const decisionActionMatch=url.pathname.match(/^\/api\/decisions\/([^/]+)\/actions$/);
  if(req.method==='POST'&&decisionActionMatch){try{const body=await readBody(req);const allowed=['APPROVE','REJECT','RESEARCH','ESCALATE','ARCHIVE'];if(!allowed.includes(body.action))return sendJson(res,400,{error:'A valid decision action is required'});const db=await readDb();const brief=(db.decisionBriefs||[]).find(item=>item.id===decisionActionMatch[1]);if(!brief)return sendJson(res,404,{error:'Decision brief not found'});db.executiveDecisions??=[];db.learningRecords??=[];const decision={id:`decision_${crypto.randomUUID()}`,briefId:brief.id,storyId:brief.storyId,action:body.action,note:String(body.note||'').trim(),actorId:'usr_admin',createdAt:new Date().toISOString()};db.executiveDecisions.unshift(decision);brief.status=body.action==='RESEARCH'?'RESEARCH_REQUESTED':body.action==='ESCALATE'?'ESCALATED':body.action==='ARCHIVE'?'ARCHIVED':body.action==='APPROVE'?'APPROVED':'REJECTED';brief.history??=[];brief.history.unshift({at:decision.createdAt,actor:'Ethan Kushner',action:`Executive decision: ${body.action}${decision.note?` — ${decision.note}`:''}`});let learning=db.learningRecords.find(item=>item.briefId===brief.id);const advisors=Object.fromEntries((brief.advisors||[]).map(item=>[item.name,item.position]));if(!learning){learning={id:`learning_${crypto.randomUUID()}`,briefId:brief.id,storyId:brief.storyId,storyTitle:brief.title,decision:body.action,decisionMaker:'Ethan Kushner',advisorRecommendations:advisors,outcome:'PENDING',lessonsLearned:'',decisionDate:decision.createdAt,updatedAt:decision.createdAt};db.learningRecords.unshift(learning);}else{Object.assign(learning,{decision:body.action,decisionMaker:'Ethan Kushner',advisorRecommendations:advisors,decisionDate:decision.createdAt,updatedAt:decision.createdAt});}audit(db,'EXECUTIVE_DECISION','DECISION_BRIEF',brief.id,'usr_admin',body.action);audit(db,'LEARNING_RECORD_UPDATED','LEARNING_RECORD',learning.id,'usr_admin',`Decision ${body.action}`);await writeDb(db);return sendJson(res,201,{decision,brief,learningRecord:learning});}catch(error){return sendJson(res,400,{error:error.message});}}
  if(req.method==='GET'&&url.pathname==='/api/learning'){const db=await readDb();return sendJson(res,200,{learningRecords:db.learningRecords||[],intelligence:buildLearningIntelligence(db)});}
  if(req.method==='GET'&&url.pathname==='/api/learning-intelligence'){const db=await readDb();return sendJson(res,200,{intelligence:buildLearningIntelligence(db)});}
  const learningMatch=url.pathname.match(/^\/api\/learning\/([^/]+)$/);
  if(req.method==='GET'&&learningMatch){const db=await readDb();const record=(db.learningRecords||[]).find(item=>item.briefId===learningMatch[1]||item.id===learningMatch[1]);if(!record)return sendJson(res,404,{error:'Learning record not found'});return sendJson(res,200,{learningRecord:record});}
  if(req.method==='PUT'&&learningMatch){try{const body=await readBody(req);const db=await readDb();db.learningRecords??=[];const brief=(db.decisionBriefs||[]).find(item=>item.id===learningMatch[1]);if(!brief)return sendJson(res,404,{error:'Decision brief not found'});let record=db.learningRecords.find(item=>item.briefId===brief.id);const now=new Date().toISOString();if(!record){record={id:`learning_${crypto.randomUUID()}`,briefId:brief.id,storyId:brief.storyId,storyTitle:brief.title,decision:'PENDING',decisionMaker:'Unassigned',advisorRecommendations:Object.fromEntries((brief.advisors||[]).map(item=>[item.name,item.position])),outcome:'PENDING',lessonsLearned:'',decisionDate:null,updatedAt:now};db.learningRecords.unshift(record);}if('outcome' in body)record.outcome=String(body.outcome||'PENDING').trim().toUpperCase();if('lessonsLearned' in body)record.lessonsLearned=String(body.lessonsLearned||'').trim();record.updatedAt=now;audit(db,'LEARNING_RECORD_SAVED','LEARNING_RECORD',record.id,'usr_admin',record.outcome);await writeDb(db);return sendJson(res,200,{learningRecord:record});}catch(error){return sendJson(res,400,{error:error.message});}}
  if(req.method==='GET'&&url.pathname==='/api/audit'){const db=await readDb();return sendJson(res,200,{auditEvents:db.auditEvents||[]});}
  if(req.method==='POST'&&url.pathname==='/api/reset'){const seed=JSON.parse(await readFile(SEED_FILE,'utf8'));audit(seed,'DATABASE_RESET','SYSTEM','story-intelligence');await writeDb(seed);return sendJson(res,200,{ok:true});}
  if(await serveStatic(req,res))return;
  return sendJson(res,404,{error:'Not found'});
}

if(path.resolve(process.argv[1]||'')===__filename){await ensureDatabase();const server=http.createServer((req,res)=>handleRequest(req,res).catch(error=>{console.error(JSON.stringify({level:'error',message:error.message,stack:error.stack,timestamp:new Date().toISOString()}));if(!res.headersSent)sendJson(res,500,{error:'Internal server error'});else res.end();}));server.listen(PORT,'0.0.0.0',()=>console.log(JSON.stringify({level:'info',message:`KNIP listening on port ${PORT}`,version:VERSION,timestamp:new Date().toISOString()})));}
