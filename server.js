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
const VERSION = '0.9.0-alpha-ai-advisory-board';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const AUDIENCE_PROFILES = [
  { id: 'aud_mod_dems', name: 'Moderate Democrats', signals: ['democracy', 'bipartisan cooperation', 'climate resilience', 'healthcare', 'humanitarian impact', 'pragmatic u.s.–israel cooperation'], values: ['cooperation', 'pragmatism', 'shared values'], geography: ['United States'], channels: ['email', 'digital video'], messengers: ['community leaders'] },
  { id: 'aud_yh_evang', name: 'Young Hispanic Evangelicals', signals: ['faith', 'family', 'community development', 'entrepreneurship', 'agriculture', 'water and food security'], values: ['family', 'service', 'opportunity'], geography: ['Texas', 'Florida', 'California'], channels: ['podcast', 'social video'], messengers: ['faith leaders'] },
  { id: 'aud_genz_jews', name: 'Gen Z Jewish Students', signals: ['campus', 'identity', 'pluralism', 'technology', 'democracy', 'social impact', 'authentic peer voices'], values: ['identity', 'belonging', 'impact'], geography: ['New York', 'California', 'Illinois'], channels: ['short-form video', 'campus events'], messengers: ['student leaders'] },
  { id: 'aud_health', name: 'Healthcare Professionals', signals: ['medicine', 'digital health', 'public health', 'emergency care', 'medical research', 'patient outcomes'], values: ['evidence', 'care', 'innovation'], geography: ['United States'], channels: ['professional networks', 'journals'], messengers: ['clinicians'] },
  { id: 'aud_sustain', name: 'Sustainability Leaders', signals: ['climate', 'water', 'agriculture', 'renewable energy', 'conservation', 'resilience', 'food security'], values: ['stewardship', 'resilience', 'impact'], geography: ['United States', 'Israel'], channels: ['executive briefings', 'industry forums'], messengers: ['industry experts'] },
  { id: 'aud_black_faith', name: 'African-American Faith Leaders', signals: ['faith', 'civil rights', 'community resilience', 'healthcare equity', 'humanitarian activity', 'shared historical experience'], values: ['justice', 'community', 'service'], geography: ['United States'], channels: ['faith networks', 'community forums'], messengers: ['pastors'] }
];
const STATE_DEMOGRAPHIC_PROFILES = {
  california: { medianIncome: 95000, hispanicShare: 39.4, urbanity: 0.92 },
  texas: { medianIncome: 76000, hispanicShare: 40.2, urbanity: 0.87 },
  florida: { medianIncome: 71000, hispanicShare: 26.1, urbanity: 0.83 },
  newyork: { medianIncome: 82000, hispanicShare: 19.0, urbanity: 0.95 },
  illinois: { medianIncome: 78000, hispanicShare: 17.5, urbanity: 0.88 },
  pennsylvania: { medianIncome: 73000, hispanicShare: 7.8, urbanity: 0.81 }
};
const STATE_ALIASES = new Map([
  ['ca', 'california'], ['california', 'california'], ['tx', 'texas'], ['texas', 'texas'], ['fl', 'florida'], ['florida', 'florida'], ['ny', 'newyork'], ['new york', 'newyork'], ['newyork', 'newyork'], ['il', 'illinois'], ['illinois', 'illinois'], ['pa', 'pennsylvania'], ['pennsylvania', 'pennsylvania']
]);

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

function decodeHtmlEntities(value) {
  let text = String(value || '');
  const entityMap = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'"
  };
  for (const [entity, replacement] of Object.entries(entityMap)) {
    text = text.split(entity).join(replacement);
  }
  text = text.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
  return text;
}
function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|ul|ol|section|article|h[1-6]|blockquote|tr|td|th)>/gi, '\n');
  text = text.replace(/<(script|style|svg|img|iframe|object|embed|noscript|canvas|link|meta|input|button)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<(script|style|svg|img|iframe|object|embed|noscript|canvas|link|meta|input|button)[^>]*>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}
function normalizeUrl(value) {
  const raw = sanitizeText(value).replace(/\s+/g, '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  }
  catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}
function normalizeTitle(value) {
  return sanitizeText(value).replace(/\s+/g, ' ').trim();
}
function normalizeTitleKey(value) {
  return normalizeTitle(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function titleSimilarity(a, b) {
  const left = normalizeTitleKey(a);
  const right = normalizeTitleKey(b);
  if (!left || !right) return 0;
  const leftTokens = left.split(/\s+/).filter(Boolean);
  const rightTokens = right.split(/\s+/).filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const overlap = leftTokens.filter(token => rightTokens.includes(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}
function classifyStrategicRelevance(text, audienceTags = [], narrativeTags = []) {
  const combined = `${text} ${audienceTags.join(' ')} ${narrativeTags.join(' ')}`.toLowerCase();
  if (/(scandal|accus|lawsuit|investigation|fraud|misconduct|corruption|controversy)/i.test(combined)) {
    return { label: 'reputational risk', score: 30 };
  }
  if (/(political|partisan|election|campaign|congress|senate|boycott|protest|war|conflict|division)/i.test(combined)) {
    return { label: 'political controversy', score: 25 };
  }
  if (/(audience|framing|risk|sensitive)/i.test(combined)) {
    return { label: 'audience risk', score: 35 };
  }
  if (/(humanitarian|relief|aid|healthcare|medical|hospital|patient|food|water|shelter|education|support)/i.test(combined)) {
    return { label: 'humanitarian activity', score: 83 };
  }
  if (/(innovation|technology|tech|startup|ai|artificial intelligence|research|digital|platform)/i.test(combined)) {
    return { label: 'innovation and technology', score: 81 };
  }
  if (/(family|community|students|children|farmers|people|lives|benefit|help|care|impact)/i.test(combined)) {
    return { label: 'positive human impact', score: 79 };
  }
  if (/(democracy|democratic|rights|freedom|coexistence|shared values|allies|partnership)/i.test(combined)) {
    return { label: 'shared democratic values', score: 74 };
  }
  if (/(culture|society|faith|youth|student|identity|community|arts)/i.test(combined)) {
    return { label: 'culture and society', score: 72 };
  }
  if (/(u\.s|united states|american|washington|alliance|relationship)/i.test(combined)) {
    return { label: 'U.S.–Israel relationship', score: 70 };
  }
  return { label: 'low relevance', score: 20 };
}
function inferAudienceTags(story) {
  const text = `${story.title} ${story.summary} ${story.fullNarrative || ''}`.toLowerCase();
  const existing = Array.isArray(story.audienceTags) ? story.audienceTags.filter(Boolean) : [];
  const inferred = [];
  if (/(moderate|democrat|democratic|shared values|coexistence|rights|freedom)/i.test(text)) inferred.push('Moderate Democrats');
  if (/(young|hispanic|evangelical|faith|church|community service)/i.test(text)) inferred.push('Young Hispanic Evangelicals');
  if (/(gen z|student|students|campus|college|jewish)/i.test(text)) inferred.push('Gen Z Jewish Students');
  if (/(health|healthcare|medical|hospital|patient)/i.test(text)) inferred.push('Healthcare Professionals');
  if (/(sustainability|climate|water|environment|resilience|energy)/i.test(text)) inferred.push('Sustainability Leaders');
  if (/(african-american|black|faith|church|community|civil rights|pastor)/i.test(text)) inferred.push('African-American Faith Leaders');
  return [...new Set([...existing, ...inferred])];
}
function isNavigationPage(story) {
  const title = normalizeTitle(story.title || '').toLowerCase();
  const summary = normalizeTitle(story.summary || '').toLowerCase();
  const url = String(story.sourceUrl || story.url || story.source_url || '').toLowerCase();
  const navTerms = ['homepage', 'home page', 'index', 'search', 'tag', 'category', 'archive', 'media index', 'latest stories', 'newsroom', 'all stories', 'navigation page'];
  if (navTerms.some(term => title.includes(term) || summary.includes(term))) return true;
  const cleanUrl = url.replace(/^https?:\/\//, '').replace(/^[^/]+/, '');
  return /(^|\/)(home|index|search|tag|category|archive|latest|newsroom)(\/|$)/i.test(cleanUrl);
}
function isContentRelevant(story) {
  const text = `${story.title || ''} ${story.summary || ''} ${story.fullNarrative || ''}`.toLowerCase();
  const geography = Array.isArray(story.geography) ? story.geography.join(' ').toLowerCase() : '';
  return /(israel|israeli|jewish|jerusalem|haifa|tel aviv|zion|middle east|u\.s|united states|american|democracy|coexistence|humanitarian|innovation|technology|healthcare|water|sustainability|community|society)/i.test(`${text} ${geography}`);
}
function isStoryRecentEnough(story, now = new Date()) {
  const publishedAt = story.publishedAt ? new Date(story.publishedAt) : (story.collectedAt ? new Date(story.collectedAt) : null);
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return true;
  const ageDays = (now.getTime() - publishedAt.getTime()) / 86400000;
  return ageDays <= 30;
}
function isExecutiveEligible(story) {
  const title = normalizeTitle(story.title || '');
  const summary = normalizeTitle(story.summary || '');
  const sourceUrl = normalizeUrl(story.sourceUrl || story.url || story.source_url || null);
  const strategic = story.strategicRelevance || { label: 'low relevance' };
  return Boolean(sourceUrl)
    && Number(story.evidenceQuality || 0) >= 60
    && Number(story.relevanceScore || 0) >= 60
    && !['low relevance', 'audience risk', 'reputational risk', 'political controversy'].includes(strategic.label)
    && title.length >= 8
    && summary.length >= 20
    && !isNavigationPage(story)
    && isContentRelevant(story)
    && isStoryRecentEnough(story);
}
function normalizeGeography(value) {
  const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
  const normalized = [];
  for (const item of rawValues) {
    const text = sanitizeText(item);
    if (!text) continue;
    const lowered = text.toLowerCase();
    const alias = STATE_ALIASES.get(lowered) || STATE_ALIASES.get(lowered.replace(/\s+/g, ''));
    const label = alias ? alias.replace(/\b\w/g, ch => ch.toUpperCase()) : text;
    normalized.push(label);
  }
  return [...new Set(normalized)];
}
function getDemographicSignals(story) {
  const geography = normalizeGeography(story.geography || []);
  const profiles = [];
  for (const item of geography) {
    const key = item.toLowerCase();
    if (STATE_DEMOGRAPHIC_PROFILES[key]) {
      profiles.push({ state: item, ...STATE_DEMOGRAPHIC_PROFILES[key] });
    }
  }
  return profiles;
}
function getAudienceProfiles() {
  return AUDIENCE_PROFILES.map(profile => ({ ...profile }));
}
function buildAudienceMatches(story) {
  const text = `${story.title || ''} ${story.summary || ''} ${story.narrativeTags?.join(' ') || ''}`.toLowerCase();
  const demographicSignals = getDemographicSignals(story);
  const dataMode = demographicSignals.length ? 'PARTIAL' : 'RULE_BASED';
  const matches = getAudienceProfiles().map(profile => {
    const matchedSignals = profile.signals.filter(signal => text.includes(signal.toLowerCase()));
    const sharedValueAlignment = profile.values.filter(value => text.includes(value.toLowerCase())).length;
    const narrativeRelevance = clamp(30 + matchedSignals.length * 12 + (profile.signals.some(signal => text.includes(signal.toLowerCase())) ? 15 : 0));
    const geographicRelevance = demographicSignals.length ? clamp(20 + demographicSignals.length * 10 + (profile.geography.some(geo => story.geography?.some(item => sanitizeText(item).toLowerCase().includes(geo.toLowerCase()))) ? 15 : 0)) : 20;
    const demographicRelevance = demographicSignals.length ? clamp(35 + demographicSignals.reduce((sum, signal) => sum + (signal.hispanicShare && (profile.id === 'aud_yh_evang' ? signal.hispanicShare / 10 : 0) + (signal.medianIncome && (profile.id === 'aud_health' ? signal.medianIncome / 2000 : 0))), 0)) : 25;
    const evidenceQuality = Number(story.evidenceQuality || 60);
    const score = Math.round((narrativeRelevance * 0.35) + (demographicRelevance * 0.25) + (geographicRelevance * 0.15) + (sharedValueAlignment * 15 * 0.15) + (evidenceQuality * 0.1));
    const confidence = clamp(score >= 75 ? 88 : score >= 60 ? 78 : 66);
    return {
      audienceId: profile.id,
      audienceName: profile.name,
      matchScore: clamp(score),
      confidence,
      reasons: [
        ...(matchedSignals.length ? [`Matched ${matchedSignals.slice(0, 3).join(', ')}.`] : []),
        ...(sharedValueAlignment ? ['Aligned with shared values and audience framing.'] : []),
        ...(demographicSignals.length ? ['Demographic context supports relevance.'] : [])
      ],
      supportingSignals: matchedSignals.slice(0, 5),
      geographicRelevance: clamp(geographicRelevance),
      demographicRelevance: clamp(demographicRelevance),
      narrativeRelevance: clamp(narrativeRelevance),
      dataMode: demographicSignals.length ? 'PARTIAL' : 'RULE_BASED',
      evidenceSources: [...(demographicSignals.length ? ['demographic_context'] : []), 'story_text', 'knip_profile'],
      lastUpdated: new Date().toISOString()
    };
  }).sort((a, b) => b.matchScore - a.matchScore);
  return matches;
}
function normalizeStoryItem(story, connector='local', connectorLabel='Local story repository') {
  const title = normalizeTitle(story.title || story.name || 'Untitled story');
  const summary = normalizeTitle(story.summary || story.description || 'Story summary unavailable.');
  const publishedAt = story.publishedAt || story.published_at || story.createdAt || null;
  const sourceUrl = normalizeUrl(story.sourceUrl || story.url || story.source_url || story.source?.source_url || story.source?.sourceUrl || null);
  const sourceName = sanitizeText(story.sourceName || story.source?.source_name || story.source?.sourceName || story.source || story.source_name || connectorLabel);
  const collectedAt = story.collectedAt || story.collected_at || new Date().toISOString();
  const geography = Array.isArray(story.geography) ? story.geography.filter(Boolean).map(item => sanitizeText(item)) : (story.geography ? [sanitizeText(story.geography)] : []);
  const audienceTags = inferAudienceTags({
    ...story,
    title,
    summary,
    audienceTags: Array.isArray(story.audienceTags) ? story.audienceTags.filter(Boolean).map(item => sanitizeText(item)) : (Array.isArray(story.audiences) ? story.audiences.filter(Boolean).map(item => sanitizeText(item)) : [])
  });
  const narrativeTags = Array.isArray(story.narrativeTags) ? story.narrativeTags.filter(Boolean).map(item => sanitizeText(item)) : (Array.isArray(story.narratives) ? story.narratives.filter(Boolean).map(item => sanitizeText(item)) : []);
  const reliability = Number(story.reliability ?? story.source?.reliability ?? 0.72);
  const confidence = Number(story.confidence ?? 0.76);
  const evidenceQuality = Number(story.evidenceQuality ?? Math.min(100, Math.max(0, Math.round((reliability * 100) * 0.7 + confidence * 100 * 0.3))));
  const freshness = Number(story.freshness ?? 90);
  const authenticityScore = Number(story.authenticityScore ?? Math.min(100, Math.max(0, Math.round((confidence * 100 * 0.55) + (evidenceQuality * 0.45)))));
  const strategicRelevance = classifyStrategicRelevance(`${title} ${summary}`, audienceTags, narrativeTags);
  const audienceRelevance = Math.min(100, Math.max(0, Math.round((audienceTags.length * 12) + (evidenceQuality * 0.35))));
  const strategicScore = Math.min(100, Math.max(0, Math.round(strategicRelevance.score + (narrativeTags.length * 3))));
  const sourceReliability = Math.min(100, Math.max(0, Math.round(reliability * 100)));
  const freshnessScore = Math.min(100, Math.max(0, Number.isFinite(freshness) ? Number(freshness) : 90));
  const relevanceScore = Math.round((evidenceQuality * 0.25) + (audienceRelevance * 0.25) + (strategicScore * 0.2) + (freshnessScore * 0.15) + (authenticityScore * 0.1) + (sourceReliability * 0.05));
  const audienceMatches = buildAudienceMatches({ ...story, title, summary, geography, audienceTags, narrativeTags, evidenceQuality, sourceUrl });
  const bestAudienceMatch = audienceMatches[0] || null;
  return {
    id: String(story.id || `${connector}:${title}`),
    title,
    summary,
    sourceName,
    sourceUrl,
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    collectedAt: new Date(collectedAt).toISOString(),
    connector: connectorLabel,
    geography,
    audienceTags,
    narrativeTags,
    reliability: Math.min(1, Math.max(0, reliability)),
    confidence: Math.min(1, Math.max(0, confidence)),
    freshness: freshnessScore,
    relevanceScore,
    authenticityScore,
    evidenceQuality,
    strategicRelevanceLabel: strategicRelevance.label,
    strategicRelevanceScore: strategicScore,
    sourceReliability,
    eligibleForExecutiveUse: isExecutiveEligible({ ...story, title, summary, sourceUrl, evidenceQuality, relevanceScore, strategicRelevance: strategicRelevance, audienceTags, narrativeTags, publishedAt, collectedAt }),
    audienceMatches,
    bestAudienceMatch,
    audienceMatchScore: bestAudienceMatch ? bestAudienceMatch.matchScore : 0,
    audienceDataMode: bestAudienceMatch ? bestAudienceMatch.dataMode : 'RULE_BASED',
    status: relevanceScore >= 78 ? 'VALIDATED' : 'REVIEW'
  };
}
function deduplicateStories(stories) {
  const deduped = [];
  for (const story of [...stories].sort((a, b) => b.relevanceScore - a.relevanceScore)) {
    const titleKey = normalizeTitleKey(story.title || '');
    const sourceKey = story.sourceName ? String(story.sourceName).toLowerCase() : '';
    const dateKey = story.publishedAt ? story.publishedAt.slice(0, 10) : '';
    const urlKey = story.sourceUrl ? normalizeUrl(story.sourceUrl) : '';
    const isDuplicate = deduped.some(existing => {
      const existingTitle = normalizeTitleKey(existing.title || '');
      const existingUrl = existing.sourceUrl ? normalizeUrl(existing.sourceUrl) : '';
      const existingSource = existing.sourceName ? String(existing.sourceName).toLowerCase() : '';
      const existingDate = existing.publishedAt ? existing.publishedAt.slice(0, 10) : '';
      const sourceDateMatch = sourceKey && existingSource && sourceKey === existingSource && (dateKey && existingDate ? dateKey === existingDate : (!dateKey && !existingDate));
      const sameUrl = Boolean(urlKey && existingUrl && urlKey === existingUrl);
      const normalizedTitleMatch = Boolean(titleKey && existingTitle && (titleKey === existingTitle || titleKey.includes(existingTitle) || existingTitle.includes(titleKey)));
      const highTitleSimilarity = titleSimilarity(story.title, existing.title) >= 0.6;
      return sameUrl || normalizedTitleMatch || highTitleSimilarity || sourceDateMatch;
    });
    if (isDuplicate) continue;
    deduped.push(story);
  }
  return deduped;
}
function scoreStory(story) {
  return normalizeStoryItem({ ...story, evidenceQuality: story.evidenceQuality, freshness: story.freshness, authenticityScore: story.authenticityScore, audienceTags: story.audienceTags, narrativeTags: story.narrativeTags, reliability: story.reliability, confidence: story.confidence }, story.connector || 'local', story.connector || 'Local story repository');
}
function filterEligibleStories(stories = []) {
  return (stories || [])
    .map(story => scoreStory(story))
    .filter(story => {
      const title = normalizeTitle(story.title || '');
      const summary = normalizeTitle(story.summary || '');
      const sourceUrl = normalizeUrl(story.sourceUrl || story.url || story.source_url || null);
      const strategic = story.strategicRelevanceLabel || 'low relevance';
      return Boolean(sourceUrl)
        && Number(story.evidenceQuality || 0) >= 60
        && Number(story.relevanceScore || 0) >= 60
        && !['low relevance', 'audience risk', 'reputational risk', 'political controversy'].includes(strategic)
        && title.length >= 8
        && summary.length >= 20
        && !isNavigationPage(story)
        && isContentRelevant(story)
        && isStoryRecentEnough(story);
    });
}
function prepareStoryCandidates(stories = []) {
  const normalized = (stories || []).map(story => normalizeStoryItem(story, story.connector || 'local', story.connector || 'Local story repository'));
  const deduped = deduplicateStories(normalized);
  return filterEligibleStories(deduped);
}
function buildDashboardPayload(stories = [], live = false) {
  const inputStories = Array.isArray(stories) ? stories : [];
  const normalized = prepareStoryCandidates(inputStories);
  if (!normalized.length) {
    return {
      fallback: true,
      source: 'FALLBACK',
      sourceMode: 'FALLBACK',
      metrics: { storiesValidated: { value: inputStories.length || 4, trend: 'FALLBACK' } },
      priorityDecision: {
        title: 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation',
        summary: 'A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.',
        audienceMatch: 82,
        evidenceQuality: 92,
        strategicImpact: 'High',
        strategicImpactScore: 88,
        readiness: 96,
        readinessState: 'READY',
        approvedImpact: 'Potential reach and engagement require human validation before publication.',
        delayImpact: 'Opportunity freshness declines as the news cycle advances.',
        sourceUrl: null,
        connector: null,
        bestAudienceName: 'Moderate Democrats',
        audienceMatchScore: 82,
        audienceConfidence: 78,
        audienceReasons: ['Fallback audience profile.'],
        audienceDataMode: 'RULE_BASED',
      },
    };
  }
  const priority = normalized[0];
  return {
    fallback: false,
    source: 'LIVE',
    sourceMode: 'LIVE',
    metrics: { storiesValidated: { value: normalized.length, trend: 'LIVE' } },
    priorityDecision: {
      title: priority.title,
      summary: priority.summary,
      audienceMatch: Math.round(priority.audienceMatchScore || Math.min(99, Math.max(70, Math.round(priority.relevanceScore * 0.9)))),
      evidenceQuality: Math.round(priority.evidenceQuality),
      strategicImpact: priority.relevanceScore >= 80 ? 'High' : 'Medium',
      strategicImpactScore: Math.round(priority.relevanceScore),
      readiness: Math.round(priority.relevanceScore * 0.95),
      readinessState: priority.status,
      approvedImpact: 'Potential reach and engagement require human validation before publication.',
      delayImpact: 'Opportunity freshness declines as the news cycle advances.',
      sourceUrl: priority.sourceUrl,
      connector: priority.connector,
      bestAudienceName: priority.bestAudienceMatch?.audienceName || 'Moderate Democrats',
      audienceMatchScore: priority.audienceMatchScore || 0,
      audienceConfidence: priority.bestAudienceMatch?.confidence || 0,
      audienceReasons: priority.bestAudienceMatch?.reasons || [],
      audienceDataMode: priority.audienceDataMode || 'RULE_BASED',
    },
  };
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


function buildAdvisorySynthesis(brief){
  const advisors=brief.advisors||[];
  const core=advisors.filter(a=>['Shani','Ruby','Amit'].includes(a.name));
  const avg=Math.round(core.reduce((sum,a)=>sum+Number(a.confidence||0),0)/Math.max(1,core.length));
  const positive=new Set(['APPROVE','ADVANCE','READY','READY_WITH_CONDITIONS','RELIABLE','PROCEED']);
  const supportive=core.filter(a=>positive.has(a.position)).length;
  const consensus=supportive===core.length?'STRONG CONSENSUS':supportive>=2?'QUALIFIED CONSENSUS':'MIXED VIEW';
  const agreements=[];
  if(core.length) agreements.push('The story has meaningful strategic potential and a credible human beneficiary.');
  if(core.every(a=>Number(a.confidence||0)>=75)) agreements.push('All advisors express decision-grade confidence in their assessment.');
  if(supportive>=2) agreements.push('A majority supports advancement, with safeguards before public activation.');
  const disagreements=[];
  const positions=[...new Set(core.map(a=>a.position))];
  if(positions.length>1) disagreements.push('Advisors differ on readiness: strategy favors movement while knowledge and operations require conditions.');
  disagreements.push('Evidence completeness and operational readiness carry different weight across the advisory roles.');
  const conditions=[...(brief.explainability?.conditions||[])];
  const recommendation=supportive>=2?'APPROVE WITH CONDITIONS':supportive===1?'RESEARCH MORE':'HOLD';
  return {briefId:brief.id,title:brief.title,audience:brief.audience,advisors,consensus,agreements,disagreements,conditions,recommendation,confidence:Math.round((avg+Number(brief.confidence||avg))/2),executiveQuestion:`Should KNIP advance “${brief.title}” for ${brief.audience}?`};
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

export { normalizeStoryItem, deduplicateStories, scoreStory, buildDashboardPayload, getAudienceProfiles, buildAudienceMatches };

export async function handleRequest(req,res) {
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/api/health') return sendJson(res,200,{status:'ok',service:'knip-platform',version:VERSION,timestamp:new Date().toISOString()});
  if(req.method==='GET'&&url.pathname==='/api/audiences'){return sendJson(res,200,{audiences:getAudienceProfiles()});}
  if(req.method==='GET'&&url.pathname.startsWith('/api/audiences/')){
    const audienceId=url.pathname.split('/').pop();
    const audience=getAudienceProfiles().find(item=>item.id===audienceId);
    if(!audience) return sendJson(res,404,{error:'Audience not found'});
    return sendJson(res,200,{audience});
  }
  if(req.method==='GET'&&url.pathname==='/api/dashboard'){
    const db=await readDb();
    const sourceStories = (db.stories||[]).map(story => ({
      ...story,
      sourceName: story.source || 'Local story repository',
      sourceUrl: story.urls?.[0] || story.sourceUrl || null,
      publishedAt: story.publishedAt || story.createdAt || null,
      collectedAt: story.updatedAt || story.createdAt || new Date().toISOString(),
      connector: story.sourceType ? 'Local Story Repository' : 'Local story repository',
      geography: story.country ? [story.country] : [],
      audienceTags: story.tags?.length ? story.tags : ['community'],
      narrativeTags: story.tags?.length ? story.tags : ['innovation'],
      reliability: 0.78,
      confidence: 0.8,
      evidenceQuality: 82,
      freshness: 88,
      authenticityScore: 84,
      status: 'REVIEW',
    }));
    const stories = sourceStories.map(story => scoreStory(normalizeStoryItem(story, 'local', story.connector || 'Local Story Repository')));
    return sendJson(res,200,buildDashboardPayload(stories, stories.length > 0));
  }
  if(req.method==='GET'&&url.pathname==='/api/audience-intelligence'){
    const db=await readDb();
    const stories=(db.stories||[]).map(story=>{const analysis=(db.analyses||[]).find(item=>item.storyId===story.id)||null;return{story,analysis,matches:analysis?matchAudiences(story,analysis,db.audiences||[]):[]};});
    const audienceSummaries=(db.audiences||[]).map(audience=>{const ranked=stories.filter(item=>item.analysis).map(item=>{const match=item.matches.find(m=>m.audienceId===audience.id);return match?{storyId:item.story.id,storyTitle:item.story.title,...match}:null;}).filter(Boolean).sort((a,b)=>b.match-a.match);return{...audience,topStories:ranked.slice(0,5),averageMatch:ranked.length?clamp(ranked.reduce((sum,item)=>sum+item.match,0)/ranked.length):0};});
    return sendJson(res,200,{audiences:audienceSummaries,stories});
  }
  if(req.method==='GET'&&url.pathname==='/api/stories'){
    const db=await readDb();
    const sourceStories = (db.stories||[]).map(story => ({
      ...story,
      evidenceCount:(db.evidence||[]).filter(e=>e.storyId===story.id).length,
      latestAnalysis:(db.analyses||[]).find(a=>a.storyId===story.id)||null,
      sourceName: story.source || 'Local story repository',
      sourceUrl: story.urls?.[0] || story.sourceUrl || null,
      publishedAt: story.publishedAt || story.createdAt || null,
      collectedAt: story.updatedAt || story.createdAt || new Date().toISOString(),
      connector: story.sourceType ? 'Local Story Repository' : 'Local story repository',
      geography: story.country ? [story.country] : [],
      audienceTags: story.tags?.length ? story.tags : ['community'],
      narrativeTags: story.tags?.length ? story.tags : ['innovation'],
      reliability: 0.78,
      confidence: 0.8,
      evidenceQuality: 82,
      freshness: 88,
      authenticityScore: 84,
      status: 'REVIEW',
    }));
    const normalized = deduplicateStories(sourceStories.map(story => scoreStory(normalizeStoryItem(story, 'local', story.connector || 'Local Story Repository'))));
    const storiesPayload = normalized.map(item => ({...item, evidenceCount:(db.evidence||[]).filter(e=>e.storyId===item.id).length, latestAnalysis:(db.analyses||[]).find(a=>a.storyId===item.id)||null, audienceMatches:item.audienceMatches, bestAudienceMatch:item.bestAudienceMatch, audienceMatchScore:item.audienceMatchScore, audienceDataMode:item.audienceDataMode}));
    return sendJson(res,200,{stories:storiesPayload,items:storiesPayload,count:storiesPayload.length});
  }
  const storyMatch=url.pathname.match(/^\/api\/stories\/([^/]+)$/);
  if(req.method==='GET'&&storyMatch){const db=await readDb();const story=db.stories.find(s=>s.id===storyMatch[1]);if(!story)return sendJson(res,404,{error:'Story not found'});const normalizedStory=normalizeStoryItem({...story, sourceUrl:story.urls?.[0]||story.sourceUrl||null, sourceName:story.source||'Local story repository', connector:story.sourceType?'Local Story Repository':'Local story repository', audienceTags:story.tags?.length?story.tags:['community'], narrativeTags:story.tags?.length?story.tags:['innovation'], evidenceQuality:82, freshness:88, authenticityScore:84, reliability:0.78, confidence:0.8}, 'local', story.sourceType?'Local Story Repository':'Local story repository');return sendJson(res,200,{story:{...story, audienceMatches:normalizedStory.audienceMatches, bestAudienceMatch:normalizedStory.bestAudienceMatch, audienceMatchScore:normalizedStory.audienceMatchScore, audienceDataMode:normalizedStory.audienceDataMode},evidence:(db.evidence||[]).filter(e=>e.storyId===story.id),analyses:(db.analyses||[]).filter(a=>a.storyId===story.id)});}
  if(req.method==='GET'&&url.pathname.match(/^\/api\/stories\/([^/]+)\/audiences$/)){const storyId=url.pathname.split('/')[3];const db=await readDb();const story=db.stories.find(s=>s.id===storyId);if(!story)return sendJson(res,404,{error:'Story not found'});const normalizedStory=normalizeStoryItem({...story, sourceUrl:story.urls?.[0]||story.sourceUrl||null, sourceName:story.source||'Local story repository', connector:story.sourceType?'Local Story Repository':'Local story repository', audienceTags:story.tags?.length?story.tags:['community'], narrativeTags:story.tags?.length?story.tags:['innovation'], evidenceQuality:82, freshness:88, authenticityScore:84, reliability:0.78, confidence:0.8}, 'local', story.sourceType?'Local Story Repository':'Local story repository');return sendJson(res,200,{storyId, audienceMatches:normalizedStory.audienceMatches, bestAudienceMatch:normalizedStory.bestAudienceMatch, audienceDataMode:normalizedStory.audienceDataMode});}
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
  if(req.method==='GET'&&url.pathname==='/api/advisory-board'){const db=await readDb();return sendJson(res,200,{sessions:(db.decisionBriefs||[]).map(buildAdvisorySynthesis)});}
  const advisoryMatch=url.pathname.match(/^\/api\/advisory-board\/([^/]+)$/);
  if(req.method==='GET'&&advisoryMatch){const db=await readDb();const brief=(db.decisionBriefs||[]).find(item=>item.id===advisoryMatch[1]);if(!brief)return sendJson(res,404,{error:'Advisory session not found'});return sendJson(res,200,{session:buildAdvisorySynthesis(brief)});}
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
