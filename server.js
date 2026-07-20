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
const VERSION = '0.2.0-alpha-story-intelligence';
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
function keywords(text) {
  const stop = new Set(['about','after','again','against','because','been','being','between','could','from','have','into','more','other','should','their','there','these','they','this','through','under','using','were','which','with','would']);
  const counts = new Map();
  for (const token of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) {
    if (stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,8).map(([word])=>word);
}
function classify(text) {
  const t = text.toLowerCase();
  const categories = [
    ['Climate & Sustainability', ['water','climate','drought','agriculture','energy','environment']],
    ['Health & Human Impact', ['health','medical','hospital','patient','therapy','disease']],
    ['Technology & Innovation', ['technology','innovation','startup','software','cyber','research']],
    ['Community & Civil Society', ['community','education','volunteer','coexistence','civil','school']],
    ['Security & Resilience', ['security','resilience','emergency','defense','recovery']]
  ];
  return categories.find(([, terms]) => terms.some(term => t.includes(term)))?.[0] || 'General Human Impact';
}
function analyzeStory(story, evidence) {
  const combined = `${story.title} ${story.summary} ${evidence.map(e=>`${e.title} ${e.claim}`).join(' ')}`;
  const evidenceCount = evidence.length;
  const sourceCount = new Set(evidence.map(e=>e.sourceUrl || e.sourceName).filter(Boolean)).size;
  const completeness = Math.min(100, 35 + (story.summary.length > 100 ? 20 : 8) + evidenceCount * 12 + sourceCount * 8);
  const reliability = evidenceCount === 0 ? 25 : Math.min(92, 45 + evidence.reduce((sum,e)=>sum + Number(e.reliability || 50),0) / evidenceCount * .45);
  const confidence = Math.round((completeness * .55) + (reliability * .45));
  return {
    id:`analysis_${crypto.randomUUID()}`,
    storyId:story.id,
    category:classify(combined),
    keywords:keywords(combined),
    evidenceCount,
    sourceCount,
    completeness:Math.round(completeness),
    reliability:Math.round(reliability),
    confidence,
    summary: story.summary || `A story concerning ${story.title}.`,
    strengths:[
      evidenceCount ? `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} catalogued` : 'Clear story title and narrative premise',
      sourceCount > 1 ? 'Multiple distinct sources support review' : 'Source provenance can be strengthened'
    ],
    risks:[
      ...(evidenceCount < 2 ? ['Insufficient corroborating evidence'] : []),
      ...(sourceCount < 2 ? ['Limited source diversity'] : []),
      ...(story.summary.length < 100 ? ['Story summary needs more context'] : [])
    ],
    recommendation: confidence >= 75 ? 'Advance to audience matching' : confidence >= 55 ? 'Continue research before audience matching' : 'Hold for additional evidence',
    model:'KNIP deterministic Alpha analyzer',
    createdAt:new Date().toISOString()
  };
}
async function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url;
  const safe = path.normalize(requested).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(__dirname, 'public', safe);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return false;
  try {
    const body = await readFile(filePath); const ext = path.extname(filePath);
    const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml' };
    sendText(res, 200, body, types[ext] || 'application/octet-stream'); return true;
  } catch { return false; }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { status:'ok', service:'knip-platform', version:VERSION, timestamp:new Date().toISOString() });
  if (req.method === 'GET' && url.pathname === '/api/stories') {
    const db = await readDb();
    const stories = (db.stories || []).map(s => ({ ...s, evidenceCount:(db.evidence || []).filter(e=>e.storyId===s.id).length, latestAnalysis:(db.analyses || []).find(a=>a.storyId===s.id) || null }));
    return sendJson(res, 200, { stories });
  }
  const storyMatch = url.pathname.match(/^\/api\/stories\/([^/]+)$/);
  if (req.method === 'GET' && storyMatch) {
    const db = await readDb(); const story = db.stories.find(s=>s.id===storyMatch[1]);
    if (!story) return sendJson(res,404,{error:'Story not found'});
    return sendJson(res,200,{ story, evidence:(db.evidence||[]).filter(e=>e.storyId===story.id), analyses:(db.analyses||[]).filter(a=>a.storyId===story.id) });
  }
  if (req.method === 'POST' && url.pathname === '/api/stories') {
    try {
      const body = await readBody(req); if (!body.title || typeof body.title !== 'string') return sendJson(res,400,{error:'title is required'});
      const db = await readDb(); db.stories ??= []; db.evidence ??= []; db.analyses ??= [];
      const story = { id:`story_${crypto.randomUUID()}`, title:body.title.trim(), summary:String(body.summary||'').trim(), source:String(body.source||'').trim(), status:'NEW', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      db.stories.unshift(story); audit(db,'STORY_CREATED','STORY',story.id); await writeDb(db); return sendJson(res,201,{story});
    } catch (error) { return sendJson(res,400,{error:error.message}); }
  }
  const evidenceMatch = url.pathname.match(/^\/api\/stories\/([^/]+)\/evidence$/);
  if (req.method === 'POST' && evidenceMatch) {
    try {
      const body = await readBody(req); if (!body.title || !body.claim) return sendJson(res,400,{error:'title and claim are required'});
      const db = await readDb(); const story = db.stories.find(s=>s.id===evidenceMatch[1]); if (!story) return sendJson(res,404,{error:'Story not found'});
      db.evidence ??= [];
      const item = { id:`evidence_${crypto.randomUUID()}`, storyId:story.id, title:String(body.title).trim(), claim:String(body.claim).trim(), sourceName:String(body.sourceName||'').trim(), sourceUrl:String(body.sourceUrl||'').trim(), reliability:Math.max(0,Math.min(100,Number(body.reliability||50))), createdAt:new Date().toISOString() };
      db.evidence.unshift(item); story.status='RESEARCHING'; story.updatedAt=new Date().toISOString(); audit(db,'EVIDENCE_ADDED','EVIDENCE',item.id,'usr_admin',`Story ${story.id}`); await writeDb(db); return sendJson(res,201,{evidence:item});
    } catch (error) { return sendJson(res,400,{error:error.message}); }
  }
  const analyzeMatch = url.pathname.match(/^\/api\/stories\/([^/]+)\/analyze$/);
  if (req.method === 'POST' && analyzeMatch) {
    const db = await readDb(); const story = db.stories.find(s=>s.id===analyzeMatch[1]); if (!story) return sendJson(res,404,{error:'Story not found'});
    db.analyses ??= []; const analysis = analyzeStory(story,(db.evidence||[]).filter(e=>e.storyId===story.id));
    db.analyses.unshift(analysis); story.status='ANALYZED'; story.updatedAt=new Date().toISOString(); audit(db,'STORY_ANALYZED','STORY',story.id,'usr_admin',`Confidence ${analysis.confidence}`); await writeDb(db); return sendJson(res,201,{analysis});
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') { const db=await readDb(); return sendJson(res,200,{auditEvents:db.auditEvents||[]}); }
  if (req.method === 'POST' && url.pathname === '/api/reset') { const seed=JSON.parse(await readFile(SEED_FILE,'utf8')); audit(seed,'DATABASE_RESET','SYSTEM','story-intelligence'); await writeDb(seed); return sendJson(res,200,{ok:true}); }
  if (await serveStatic(req,res)) return;
  return sendJson(res,404,{error:'Not found'});
}

if (path.resolve(process.argv[1] || '') === __filename) {
  await ensureDatabase();
  const server=http.createServer((req,res)=>handleRequest(req,res).catch(error=>{ console.error(JSON.stringify({level:'error',message:error.message,stack:error.stack,timestamp:new Date().toISOString()})); if(!res.headersSent) sendJson(res,500,{error:'Internal server error'}); else res.end(); }));
  server.listen(PORT,'0.0.0.0',()=>console.log(JSON.stringify({level:'info',message:`KNIP listening on port ${PORT}`,version:VERSION,timestamp:new Date().toISOString()})));
}
