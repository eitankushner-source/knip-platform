const $ = selector => document.querySelector(selector);
let selectedId = null;
let selectedCampaignId = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

const routeConfig = {
  executive: { title: 'Executive Decision Center', eyebrow: 'EXECUTIVE WORKSPACE' },
  stories: { title: 'Story Repository', eyebrow: 'STORY INTELLIGENCE' },
  decisions: { title: 'Decision Center', eyebrow: 'STRATEGIC DECISIONS' },
  audiences: { title: 'Audience Intelligence', eyebrow: 'COMMUNITY INTELLIGENCE' },
  campaigns: { title: 'Campaign Lab', eyebrow: 'CAMPAIGN DEVELOPMENT' },
  research: { title: 'Research Archive', eyebrow: 'KNOWLEDGE REPOSITORY' },
  learning: { title: 'Institutional Learning', eyebrow: 'ORGANIZATIONAL MEMORY' },
  admin: { title: 'Administration', eyebrow: 'PLATFORM GOVERNANCE' }
};

function currentRoute() {
  const route = location.hash.replace('#/', '').split('/')[0];
  return routeConfig[route] ? route : 'executive';
}

function setActiveNavigation(route) {
  document.querySelectorAll('[data-route]').forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = routeConfig[route].title;
  $('#pageEyebrow').textContent = routeConfig[route].eyebrow;
}

function executiveTemplate() {
  return `<section class="page introSection">
    <div>
      <p class="eyebrow dark">GOOD MORNING</p>
      <h3>Your strategic picture is ready.</h3>
      <p>Review what needs attention, understand why it matters, and move the organization toward a clear decision.</p>
    </div>
    <button class="primaryAction" type="button" data-go="stories">Review story intelligence</button>
  </section>
  <section class="kpiGrid" aria-label="Executive metrics">
    ${kpiCard('New Signals', '24', '+6 since yesterday', 'neutral')}
    ${kpiCard('Stories Ready', '8', '3 high opportunity', 'positive')}
    ${kpiCard('Awaiting Decision', '5', '2 require attention', 'warning')}
    ${kpiCard('Campaigns Active', '3', 'All on track', 'positive')}
    ${kpiCard('Narrative Health', '84%', 'Stable this week', 'positive')}
    ${kpiCard('AI Confidence', '91%', 'Across open briefs', 'neutral')}
  </section>
  <section class="dashboardGrid">
    <article class="panel spanTwo">
      <div class="sectionHeader"><div><p class="eyebrow dark">DECISION QUEUE</p><h3>Items requiring executive attention</h3></div><button class="textButton" type="button" data-go="decisions">View all</button></div>
      <div class="placeholderTable">
        <div class="tableRow tableHead"><span>Priority</span><span>Story</span><span>Recommendation</span><span>Confidence</span></div>
        ${decisionRow('brief_001', 'High', 'Israeli water technology', 'Approve', '92%')}
        ${decisionRow('brief_002', 'Medium', 'Druze first responders', 'Research', '82%')}
        ${decisionRow('brief_003', 'Normal', 'Israeli climate startup', 'Hold', '79%')}
      </div>
    </article>
    <article class="panel">
      <div class="sectionHeader"><div><p class="eyebrow dark">PIPELINE</p><h3>Story flow</h3></div></div>
      <div class="pipelineList">
        ${pipelineStage('Signal', 24)}${pipelineStage('Story', 16)}${pipelineStage('Analyzing', 8)}${pipelineStage('Decision Ready', 5)}${pipelineStage('Campaign', 3)}
      </div>
    </article>
    <article class="panel">
      <div class="sectionHeader"><div><p class="eyebrow dark">AI ACTIVITY</p><h3>Advisory board</h3></div><span class="liveDot">Live</span></div>
      <div class="advisorList">
        ${advisor('Shani', 'Evidence review complete', 'Knowledge')}
        ${advisor('Ruby', 'Strategic analysis in progress', 'Strategy')}
        ${advisor('Amit', 'Operational readiness checked', 'Operations')}
        ${advisor('CTA', 'Confidence model healthy', 'Technology')}
      </div>
    </article>
    <article class="panel spanTwo">
      <div class="sectionHeader"><div><p class="eyebrow dark">RECENT ACTIVITY</p><h3>Executive workspace timeline</h3></div></div>
      <div class="timeline">
        ${timelineItem('09:14', 'Ruby completed strategic analysis', 'Kenyan heart surgeons')}
        ${timelineItem('08:59', 'Shani added new evidence', 'Druze first responders')}
        ${timelineItem('08:33', 'Story moved to decision ready', 'Israeli climate startup')}
      </div>
    </article>
  </section>`;
}

function kpiCard(label, value, detail, tone) {
  return `<article class="kpiCard"><span>${esc(label)}</span><strong>${esc(value)}</strong><small class="${tone}">${esc(detail)}</small></article>`;
}
function decisionRow(id, priority, story, recommendation, confidence) {
  return `<button class="tableRow decisionPreview" type="button" data-brief="${esc(id)}"><span><i class="priority ${priority.toLowerCase()}"></i>${priority}</span><strong>${esc(story)}</strong><span>${esc(recommendation)}</span><span>${esc(confidence)}</span></button>`;
}
function pipelineStage(label, count) {
  return `<div><span>${esc(label)}</span><div class="pipelineBar"><i style="width:${Math.min(100, count * 4)}%"></i></div><strong>${count}</strong></div>`;
}
function advisor(name, activity, role) {
  return `<div class="advisor"><span class="avatar">${esc(name[0])}</span><div><strong>${esc(name)}</strong><p>${esc(activity)}</p></div><small>${esc(role)}</small></div>`;
}
function timelineItem(time, action, subject) {
  return `<div class="timelineItem"><time>${time}</time><span></span><div><strong>${esc(action)}</strong><p>${esc(subject)}</p></div></div>`;
}


function decisionCenterTemplate() {
  return `<section class="decisionWorkspace"><aside class="panel decisionQueuePanel"><div class="sectionHeader"><div><p class="eyebrow dark">DECISION QUEUE</p><h3>Executive attention</h3></div><span class="badge">Live</span></div><div id="decisionQueue" class="decisionQueue"><p>Loading briefs…</p></div></aside><section id="decisionBrief" class="panel decisionBrief"><div class="empty"><h3>Select a decision brief</h3><p>Review evidence, advisor positions, explainability, and record an executive decision.</p></div></section></section>`;
}
function priorityLabel(value='NORMAL') { return value.charAt(0)+value.slice(1).toLowerCase(); }
async function loadDecisions(preferredId) {
  const { decisionBriefs } = await api('/api/decisions');
  $('#decisionQueue').innerHTML = decisionBriefs.map(brief => `<button class="decisionCard ${preferredId===brief.id?'selected':''}" data-decision-id="${esc(brief.id)}"><span class="storyTop"><span><i class="priority ${priorityLabel(brief.priority).toLowerCase()}"></i><strong>${esc(brief.title)}</strong></span><span class="badge">${esc(brief.status.replaceAll('_',' '))}</span></span><p>${esc(brief.audience)}</p><div class="decisionMeta"><span>${esc(brief.recommendation)}</span><strong>${brief.confidence}% confidence</strong><span>Due ${esc(brief.dueDate)}</span></div></button>`).join('') || '<p>No decision briefs.</p>';
  document.querySelectorAll('[data-decision-id]').forEach(button => button.onclick=()=>openDecision(button.dataset.decisionId));
  if (preferredId && decisionBriefs.some(item=>item.id===preferredId)) await renderDecisionBrief(preferredId);
}
async function openDecision(id) { location.hash=`#/decisions/${id}`; await loadDecisions(id); }
function advisorPosition(advisor) { return `<article class="advisorOpinion"><div class="advisorOpinionHead"><span class="avatar">${esc(advisor.name[0])}</span><div><strong>${esc(advisor.name)}</strong><small>${esc(advisor.role)}</small></div><span class="position">${esc(advisor.position.replaceAll('_',' '))}</span></div><p>${esc(advisor.assessment)}</p><div class="confidenceLine"><span>Confidence</span><i><b style="width:${advisor.confidence}%"></b></i><strong>${advisor.confidence}%</strong></div></article>`; }
function driverBar(driver) { return `<div class="driver"><span>${esc(driver.label)}</span><i><b style="width:${driver.value}%"></b></i><strong>${driver.value}%</strong></div>`; }
async function renderDecisionBrief(id) {
  const { brief, decisions } = await api(`/api/decisions/${id}`);
  let learningRecord=null;try{learningRecord=(await api(`/api/learning/${id}`)).learningRecord;}catch(error){if(!error.message.includes('Learning record not found'))throw error;}
  document.querySelectorAll('[data-decision-id]').forEach(button=>button.classList.toggle('selected',button.dataset.decisionId===id));
  $('#decisionBrief').innerHTML = `<div class="briefHeader"><div><p class="eyebrow dark">EXECUTIVE DECISION BRIEF</p><h3>${esc(brief.title)}</h3><div class="briefTags"><span class="badge">${esc(priorityLabel(brief.priority))} priority</span><span>${esc(brief.audience)}</span><span>Owner: ${esc(brief.owner)}</span><span>Due: ${esc(brief.dueDate)}</span></div></div><div class="recommendationBlock"><small>AI recommendation</small><strong>${esc(brief.recommendation)}</strong><span>${brief.confidence}% confidence</span></div></div>
  <section class="briefSection"><h4>Executive summary</h4><p class="lead">${esc(brief.executiveSummary)}</p></section>
  <section class="briefSection"><h4>Strategic assessment</h4><p>${esc(brief.strategicAssessment)}</p><div class="opportunityRisk"><div><h5>Opportunities</h5><ul>${brief.opportunities.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div><div><h5>Risks</h5><ul>${brief.risks.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div></div></section>
  <section class="briefSection"><div class="sectionHeader"><div><p class="eyebrow dark">AI ADVISORY BOARD</p><h4>Four perspectives, one explainable recommendation</h4></div></div><div class="advisorBoard">${brief.advisors.map(advisorPosition).join('')}</div></section>
  <section class="briefSection explainabilityPanel"><div><p class="eyebrow dark">EXPLAINABILITY</p><h4>Why KNIP recommends ${esc(brief.recommendation.toLowerCase())}</h4><p>${esc(brief.explainability.why)}</p><h5>Approval conditions</h5><ul>${brief.explainability.conditions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div><div class="drivers">${brief.explainability.drivers.map(driverBar).join('')}</div></section>
  <section class="briefSection"><h4>Evidence reviewed</h4><div class="briefEvidence">${brief.evidence.map(item=>`<article><div><strong>${esc(item.title)}</strong><span>${item.reliability}% reliable</span></div><p>${esc(item.claim)}</p></article>`).join('')}</div></section>
  <section class="decisionActionPanel"><div><p class="eyebrow dark">HUMAN AUTHORITY</p><h4>Record executive decision</h4><p>AI advises. The executive decides. Every action is preserved in the audit trail.</p><textarea id="decisionNote" rows="2" placeholder="Optional decision rationale or instructions"></textarea></div><div class="decisionButtons"><button data-action="APPROVE">Approve</button><button class="secondary" data-action="RESEARCH">Research</button><button class="secondary" data-action="ESCALATE">Escalate</button><button class="rejectAction" data-action="REJECT">Reject</button><button class="archiveAction" data-action="ARCHIVE">Archive</button></div><p id="decisionMessage" class="message"></p></section>
  ${learningPanel(learningRecord,brief)}
  <section class="briefSection"><h4>Decision history</h4><div class="historyList">${brief.history.map(item=>`<div><time>${new Date(item.at).toLocaleString()}</time><strong>${esc(item.actor)}</strong><span>${esc(item.action)}</span></div>`).join('')}${decisions.length?'':''}</div></section>`;
  $('#saveLearning').onclick=async()=>{const message=$('#learningMessage');message.textContent='Saving learning record…';try{await api(`/api/learning/${id}`,{method:'PUT',body:JSON.stringify({outcome:$('#learningOutcome').value,lessonsLearned:$('#lessonsLearned').value})});message.textContent='Learning record saved.';await renderDecisionBrief(id);}catch(error){message.textContent=error.message;}};
  document.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{ const action=button.dataset.action; if(!confirm(`Record ${action.toLowerCase()} decision?`))return; const message=$('#decisionMessage'); message.textContent='Recording decision…'; try{await api(`/api/decisions/${id}/actions`,{method:'POST',body:JSON.stringify({action,note:$('#decisionNote').value})});message.textContent='Decision recorded.';await loadDecisions(id);}catch(error){message.textContent=error.message;} });
}


function learningWorkspaceTemplate(){return `<section class="page"><div class="sectionHeader"><div><p class="eyebrow dark">ORGANIZATIONAL MEMORY</p><h3>Institutional Learning</h3><p>Every executive decision becomes reusable organizational knowledge.</p></div></div><section id="learningRecords" class="learningGrid"><p>Loading learning records…</p></section></section>`;}
async function loadLearningRecords(){const {learningRecords}=await api('/api/learning');$('#learningRecords').innerHTML=learningRecords.map(record=>`<article class="panel learningCard"><div class="sectionHeader"><div><p class="eyebrow dark">LEARNING RECORD</p><h4>${esc(record.storyTitle)}</h4></div><span class="badge">${esc(record.outcome)}</span></div><div class="learningMeta"><div><span>Decision</span><strong>${esc(record.decision)}</strong></div><div><span>Decision maker</span><strong>${esc(record.decisionMaker)}</strong></div><div><span>Decision date</span><strong>${record.decisionDate?new Date(record.decisionDate).toLocaleDateString():'Pending'}</strong></div></div><p><strong>Lessons learned:</strong> ${esc(record.lessonsLearned||'No lessons recorded yet.')}</p><button data-brief="${esc(record.briefId)}">Open decision brief</button></article>`).join('')||'<article class="panel empty"><h3>No learning records yet</h3><p>Record an executive decision to create the first learning record.</p></article>';document.querySelectorAll('[data-brief]').forEach(button=>button.onclick=()=>openDecision(button.dataset.brief));}
function learningPanel(record,brief){const advisorEntries=Object.entries(record?.advisorRecommendations||Object.fromEntries((brief.advisors||[]).map(item=>[item.name,item.position])));return `<section class="briefSection institutionalPanel"><div class="sectionHeader"><div><p class="eyebrow dark">INSTITUTIONAL LEARNING</p><h4>Turn this decision into organizational memory</h4></div><span class="badge">${esc(record?.outcome||'PENDING')}</span></div><div class="learningMeta"><div><span>Decision status</span><strong>${esc(record?.decision||brief.status)}</strong></div><div><span>Decision maker</span><strong>${esc(record?.decisionMaker||'Pending')}</strong></div><div><span>Decision date</span><strong>${record?.decisionDate?new Date(record.decisionDate).toLocaleDateString():'Pending'}</strong></div></div><div class="advisorSnapshot">${advisorEntries.map(([name,position])=>`<span><strong>${esc(name)}</strong>${esc(String(position).replaceAll('_',' '))}</span>`).join('')}</div><label>Outcome<select id="learningOutcome"><option ${record?.outcome==='PENDING'?'selected':''}>PENDING</option><option ${record?.outcome==='SUCCESS'?'selected':''}>SUCCESS</option><option ${record?.outcome==='PARTIAL'?'selected':''}>PARTIAL</option><option ${record?.outcome==='NO_ACTION'?'selected':''}>NO_ACTION</option><option ${record?.outcome==='NEGATIVE'?'selected':''}>NEGATIVE</option></select></label><label>Lessons learned<textarea id="lessonsLearned" rows="3" placeholder="What should KNIP remember for future decisions?">${esc(record?.lessonsLearned||'')}</textarea></label><button id="saveLearning">Save learning record</button><p id="learningMessage" class="message"></p></section>`;}

function campaignPlannerTemplate(){return `<section class="campaignWorkspace"><aside class="panel"><div class="sectionHeader"><div><p class="eyebrow dark">APPROVED STORIES</p><h3>Campaign opportunities</h3></div><span class="badge">Ruby live</span></div><div id="campaignList" class="campaignList"><p>Loading campaign plans…</p></div></aside><section id="campaignDetail" class="panel"><div class="empty"><h3>Select a campaign</h3><p>Review Ruby’s strategic recommendation and execution plan.</p></div></section></section>`;}
async function loadCampaignPlanner(){const {campaignPlans}=await api('/api/campaign-plans');if(!selectedCampaignId&&campaignPlans.length)selectedCampaignId=campaignPlans[0].id;$('#campaignList').innerHTML=campaignPlans.map(plan=>`<button class="campaignCard ${plan.id===selectedCampaignId?'selected':''}" data-campaign-id="${esc(plan.id)}"><strong>${esc(plan.title)}</strong><span>${esc(plan.audience)}</span><small>${plan.confidence}% confidence · ${esc(plan.priority)}</small></button>`).join('')||'<p>No campaign opportunities.</p>';document.querySelectorAll('[data-campaign-id]').forEach(b=>b.onclick=()=>{selectedCampaignId=b.dataset.campaignId;loadCampaignPlanner();});const plan=campaignPlans.find(p=>p.id===selectedCampaignId);if(plan)renderCampaignPlan(plan);}
function list(items){return `<ul>${(items||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`;}
function renderCampaignPlan(plan){const r=plan.ruby;$('#campaignDetail').innerHTML=`<div class="briefHeader"><div><p class="eyebrow dark">CAMPAIGN PLANNER</p><h3>${esc(plan.title)}</h3><div class="briefTags"><span>${esc(plan.audience)}</span><span>${plan.durationWeeks} weeks</span><span>${esc(plan.status)}</span></div></div><div class="recommendationBlock"><small>Ruby recommends</small><strong>${esc(r.recommendation.replaceAll('_',' '))}</strong><span>${r.confidence}% confidence</span></div></div><section class="rubyPanel"><div class="sectionHeader"><div><p class="eyebrow dark">RUBY · CHIEF STRATEGY OFFICER</p><h3>Strategic recommendation</h3></div><span class="badge">${esc(r.priority)} priority</span></div><p class="lead">${esc(r.summary)}</p><div class="strategyMetrics"><div><span>Objective</span><strong>${esc(r.objective)}</strong></div><div><span>Narrative</span><strong>${esc(r.narrative)}</strong></div><div><span>Budget</span><strong>${esc(r.budget)}</strong></div><div><span>Complexity</span><strong>${esc(r.complexity)}</strong></div></div><div class="opportunityRisk"><div><h4>Strengths</h4>${list(r.strengths)}</div><div><h4>Risks</h4>${list(r.risks)}</div></div><div class="explain"><h4>Why this recommendation?</h4><p>${esc(r.why)}</p></div></section><section class="campaignGrid"><article><h4>Recommended framing</h4><p>${esc(plan.framing)}</p><h4>Core messages</h4>${list(plan.coreMessages)}</article><article><h4>Trusted messengers</h4>${list(plan.messengers)}<h4>Channels</h4>${list(plan.channels)}</article><article><h4>Creative assets</h4>${list(plan.assets)}<h4>Call to action</h4><p>${esc(plan.cta)}</p></article><article><h4>Dependencies</h4>${list(plan.dependencies)}<h4>KPIs</h4>${list(plan.kpis)}</article></section><div class="decisionButtons"><button>Save draft</button><button class="secondary">Export campaign brief</button><button class="secondary">Send to operations</button></div>`;}

function audienceIntelligenceTemplate(){return `<section class="page"><div class="sectionHeader"><div><p class="eyebrow dark">AUDIENCE INTELLIGENCE</p><h3>Match each story to the audiences most likely to care</h3><p>Explainable scoring connects Narrative DNA to audience values, themes, channels, messengers, and framing.</p></div><button id="refreshAudiences" class="secondary">Refresh</button></div><section class="audienceIntelligenceLayout"><aside class="panel"><h3>Audience profiles</h3><div id="audienceProfiles" class="audienceProfileList"><p>Loading profiles…</p></div></aside><section class="panel"><div id="audienceDetail"><div class="empty"><h3>Select an audience</h3><p>Review strategic fit, recommended stories, channels, messengers, and framing.</p></div></div></section></section></section>`;}
let selectedAudienceId=null;
async function loadAudienceIntelligence(){const data=await api('/api/audience-intelligence');const audiences=data.audiences||[];if(!selectedAudienceId&&audiences.length)selectedAudienceId=audiences[0].id;$('#audienceProfiles').innerHTML=audiences.map(a=>`<button class="audienceProfileCard ${a.id===selectedAudienceId?'selected':''}" data-audience-id="${esc(a.id)}"><strong>${esc(a.name)}</strong><span>${a.averageMatch}% average fit</span><small>${esc(a.description||'')}</small></button>`).join('')||'<p>No audience profiles found.</p>';document.querySelectorAll('[data-audience-id]').forEach(button=>button.onclick=()=>{selectedAudienceId=button.dataset.audienceId;loadAudienceIntelligence();});const audience=audiences.find(a=>a.id===selectedAudienceId);if(audience)renderAudienceDetail(audience);$('#refreshAudiences').onclick=loadAudienceIntelligence;}
function miniMetric(label,value,tone=''){return `<div class="audienceMetric"><span>${esc(label)}</span><strong class="${tone}">${esc(value)}</strong></div>`;}
function renderAudienceDetail(audience){$('#audienceDetail').innerHTML=`<div class="sectionHeader"><div><p class="eyebrow dark">AUDIENCE PROFILE</p><h3>${esc(audience.name)}</h3><p>${esc(audience.description||'')}</p></div><strong class="audienceAverage">${audience.averageMatch}% avg.</strong></div><div class="audienceStrategyGrid">${dnaGroup('Values',audience.values)}${dnaGroup('Themes',audience.themes)}${dnaGroup('Preferred channels',audience.channels)}${dnaGroup('Trusted messengers',audience.messengers)}</div><div class="explain"><h4>Recommended framing</h4><p>${esc(audience.framing||'Lead with concrete human impact.')}</p></div><section class="audienceStoryMatches"><h3>Best story matches</h3>${(audience.topStories||[]).map(item=>`<article class="audienceStoryMatch"><div class="sectionHeader"><div><strong>${esc(item.storyTitle)}</strong><p>${esc(item.rationale)}</p></div><span class="match">${item.match}% match</span></div><div class="audienceMetrics">${miniMetric('Opportunity',item.opportunity+'%','good')}${miniMetric('Risk',item.risk+'%',item.risk>=55?'low':'good')}${miniMetric('Thematic fit',item.thematicFit+'%')}${miniMetric('Emotional fit',item.emotionalFit+'%')}${miniMetric('Credibility',item.credibilityFit+'%')}</div><ul>${(item.reasons||[]).slice(0,4).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><button data-story-open="${esc(item.storyId)}">Open story</button></article>`).join('')||'<div class="notice">No analyzed stories yet. Run Narrative DNA analysis on a story first.</div>'}</section>`;document.querySelectorAll('[data-story-open]').forEach(button=>button.onclick=()=>{selectedId=button.dataset.storyOpen;location.hash='#/stories';});}

function comingSoonTemplate(route) {
  const config = routeConfig[route];
  return `<section class="page comingSoon"><div class="comingSoonIcon">◇</div><p class="eyebrow dark">SPRINT 3 FOUNDATION</p><h3>${esc(config.title)}</h3><p>The navigation route and executive workspace shell are now active. Functional implementation for this module follows in the next scheduled iteration.</p><button class="primaryAction" type="button" data-go="executive">Return to Executive Decision Center</button></section>`;
}

function storyRepositoryTemplate() {
  return `<section class="storyLayout">
    <aside class="panel repositoryPanel"><div class="sectionHeader"><div><p class="eyebrow dark">REPOSITORY</p><h3>Story intelligence</h3></div><button id="refresh" class="secondary">Refresh</button></div>
      <div id="storyLoadState" class="notice compactNotice">Loading stories…</div>
      <div id="stories" class="cards repositoryCards"></div>
      <details class="storyCreate"><summary>Add a new story</summary><form id="storyForm" class="compact"><div class="formGrid"><label class="wide">Title<input id="title" required maxlength="180"></label><label class="wide">Executive summary<textarea id="summary" rows="3"></textarea></label><label class="wide">Full narrative<textarea id="fullNarrative" rows="4"></textarea></label><label>Country<input id="country"></label><label>Location<input id="location"></label><label>Language<input id="language" value="English"></label><label>Source type<select id="sourceType"><option value="">Select</option><option>Citizen testimony</option><option>News</option><option>NGO</option><option>Academic</option><option>Government</option><option>Interview</option></select></label><label>Source organization<input id="source"></label><label>Original author<input id="author"></label><label class="wide">Tags (comma-separated)<input id="tags" placeholder="water, farming, resilience"></label></div><button type="submit">Save story</button><p id="formMessage" class="message"></p></form></details>
    </aside>
    <section id="detail" class="panel detail"><div class="empty"><h3>Select a story</h3><p>Choose a story to review evidence, scores, audience matches, and explainability.</p></div></section>
    <section class="panel auditPanel"><div class="sectionHeader"><div><p class="eyebrow dark">GOVERNANCE</p><h3>Audit trail</h3></div><button id="reset" class="danger">Reset demo data</button></div><div id="audit" class="audit"></div></section>
  </section>`;
}

async function renderRoute() {
  const route = currentRoute();
  setActiveNavigation(route);
  const content = $('#appContent');
  content.innerHTML = route === 'executive' ? executiveTemplate() : route === 'stories' ? storyRepositoryTemplate() : route === 'decisions' ? decisionCenterTemplate() : route === 'audiences' ? audienceIntelligenceTemplate() : route === 'campaigns' ? campaignPlannerTemplate() : route === 'learning' ? learningWorkspaceTemplate() : comingSoonTemplate(route);
  content.focus();
  document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => { location.hash = `#/${button.dataset.go}`; });
  document.querySelectorAll('[data-brief]').forEach(button => button.onclick = () => openDecision(button.dataset.brief));
  if (route === 'stories') await loadStories();
  if (route === 'decisions') { const id = location.hash.split('/')[2]; await loadDecisions(id); }
  if (route === 'audiences') await loadAudienceIntelligence();
  if (route === 'campaigns') await loadCampaignPlanner();
  if (route === 'learning') await loadLearningRecords();
}

async function loadSystemHealth() {
  try {
    const health = await api('/api/health');
    $('#health').innerHTML = `<span></span>System ${esc(health.status)}<small>${esc(health.version)}</small>`;
  } catch (error) {
    $('#health').textContent = `System error: ${error.message}`;
  }
}

async function loadStories() {
  const loadState = $('#storyLoadState');
  if (loadState) { loadState.hidden = false; loadState.textContent = 'Loading stories…'; }
  try {
    const [storyData, auditData] = await Promise.all([api('/api/stories'), api('/api/audit')]);
    const stories = Array.isArray(storyData.stories) ? storyData.stories : [];
    if (!selectedId && stories.length) selectedId = stories[0].id;
    $('#stories').innerHTML = stories.map(story => `<button class="storyCard ${selectedId === story.id ? 'selected' : ''}" data-id="${story.id}"><span class="storyTop"><strong>${esc(story.title)}</strong><span class="badge">${esc(story.status)}</span></span><small>${story.evidenceCount} evidence · ${story.latestAnalysis ? `${story.latestAnalysis.opportunity}% opportunity` : 'Not analyzed'}</small></button>`).join('') || '<div class="notice"><strong>No stories found.</strong><p>Use “Add a new story” or reset the demo data.</p></div>';
    document.querySelectorAll('.storyCard').forEach(button => button.onclick = () => selectStory(button.dataset.id));
    $('#audit').innerHTML = auditData.auditEvents.map(event => `<div class="auditRow"><span>${new Date(event.createdAt).toLocaleString()}</span><strong>${esc(event.action)}</strong><span>${esc(event.entityType)} · ${esc(event.detail || event.entityId)}</span></div>`).join('');
    bindStoryForm();
    $('#refresh').onclick = loadStories;
    $('#reset').onclick = async () => { if (!confirm('Reset KNIP demo data?')) return; await api('/api/reset', { method: 'POST', body: '{}' }); selectedId = null; await loadStories(); };
    if (selectedId && stories.some(story => story.id === selectedId)) await renderDetail();
    if (loadState) loadState.hidden = true;
  } catch (error) {
    if (loadState) { loadState.hidden = false; loadState.textContent = `Unable to load stories: ${error.message}`; }
    $('#stories').innerHTML = '<div class="notice">Story data could not be loaded. Check that the KNIP server is running, then press Refresh.</div>';
    throw error;
  }
}

function bindStoryForm() {
  $('#storyForm').onsubmit = async event => {
    event.preventDefault(); const message = $('#formMessage'); message.textContent = 'Saving…';
    try {
      const { story } = await api('/api/stories', { method: 'POST', body: JSON.stringify({ title: $('#title').value, summary: $('#summary').value, fullNarrative: $('#fullNarrative').value, country: $('#country').value, location: $('#location').value, language: $('#language').value, sourceType: $('#sourceType').value, source: $('#source').value, author: $('#author').value, tags: $('#tags').value.split(',').map(value => value.trim()).filter(Boolean) }) });
      event.target.reset(); $('#language').value = 'English'; selectedId = story.id; message.textContent = 'Story saved.'; await loadStories();
    } catch (error) { message.textContent = error.message; }
  };
}

async function selectStory(id) { selectedId = id; await loadStories(); }

async function renderDetail() {
  const { story, evidence, analyses } = await api(`/api/stories/${selectedId}`);
  const analysis = analyses[0];
  $('#detail').innerHTML = `<div class="sectionHeader"><div><p class="eyebrow dark">STORY WORKSPACE</p><h3>${esc(story.title)}</h3></div><span class="badge">${esc(story.status)}</span></div><p class="lead">${esc(story.summary || 'No summary yet.')}</p><div class="metadataGrid"><div><span>Country</span><strong>${esc(story.country || '—')}</strong></div><div><span>Location</span><strong>${esc(story.location || '—')}</strong></div><div><span>Language</span><strong>${esc(story.language || '—')}</strong></div><div><span>Source type</span><strong>${esc(story.sourceType || '—')}</strong></div><div><span>Source</span><strong>${esc(story.source || '—')}</strong></div><div><span>Author</span><strong>${esc(story.author || '—')}</strong></div></div>${story.fullNarrative ? `<details><summary>Full narrative</summary><p class="narrative">${esc(story.fullNarrative)}</p></details>` : ''}<div class="chips">${(story.tags || []).map(tag => `<span>${esc(tag)}</span>`).join('')}</div><div class="actionRow"><button id="analyze">Run analysis</button><button id="approve" class="secondary">Mark approved</button></div>${analysis ? analysisHtml(analysis) : '<div class="notice">No analysis yet. Add evidence, then run analysis.</div>'}<div class="twoCol"><section><h3>Evidence (${evidence.length})</h3><div class="evidenceList">${evidence.map(item => `<article class="evidence"><div><strong>${esc(item.title)}</strong><span class="reliability">${item.reliability}% reliability</span></div><p>${esc(item.claim)}</p><small>${esc(item.sourceName || 'No source name')}${item.sourceType ? ` · ${esc(item.sourceType)}` : ''}</small></article>`).join('') || '<p>No evidence catalogued.</p>'}</div></section><form id="evidenceForm" class="inset"><h3>Add evidence</h3><label>Evidence title<input id="eTitle" required></label><label>Claim<textarea id="eClaim" rows="3" required></textarea></label><label>Source name<input id="eSource"></label><label>Source URL<input id="eUrl" type="url"></label><label>Source type<input id="eType" placeholder="Interview, report, data"></label><label>Reliability (0–100)<input id="eReliability" type="number" min="0" max="100" value="60"></label><button type="submit">Add evidence</button><p id="eMessage" class="message"></p></form></div>`;
  $('#analyze').onclick = async () => { await api(`/api/stories/${selectedId}/analyze`, { method: 'POST', body: '{}' }); await loadStories(); };
  $('#approve').onclick = async () => { await api(`/api/stories/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) }); await loadStories(); };
  $('#evidenceForm').onsubmit = async event => { event.preventDefault(); const message = $('#eMessage'); message.textContent = 'Saving…'; try { await api(`/api/stories/${selectedId}/evidence`, { method: 'POST', body: JSON.stringify({ title: $('#eTitle').value, claim: $('#eClaim').value, sourceName: $('#eSource').value, sourceUrl: $('#eUrl').value, sourceType: $('#eType').value, reliability: Number($('#eReliability').value) }) }); message.textContent = 'Evidence added.'; await loadStories(); } catch (error) { message.textContent = error.message; } };
}

function scoreClass(value) { return value >= 75 ? 'good' : value >= 55 ? 'warn' : 'low'; }
function scoreTile(label, value) { return `<div class="scoreTile"><span>${esc(label)}</span><strong class="${scoreClass(label === 'Risk' ? 100 - value : value)}">${value}%</strong></div>`; }
function dnaGroup(label, items) { return `<div class="dnaGroup"><span>${esc(label)}</span><div class="chips">${(items || []).map(item => `<span>${esc(item)}</span>`).join('') || '<em>None identified</em>'}</div></div>`; }
function analysisHtml(analysis) {
  const dna = analysis.narrativeDna || {};
  return `<section class="analysis"><div class="sectionHeader"><div><h3>Latest analysis</h3><small>${esc(analysis.model)} · ${new Date(analysis.createdAt).toLocaleString()}</small></div><strong class="score ${scoreClass(analysis.confidence)}">${analysis.confidence}% confidence</strong></div><section class="narrativeDna"><div class="sectionHeader"><div><p class="eyebrow dark">NARRATIVE DNA</p><h3>Story intelligence profile</h3></div><div class="dnaScores"><strong>${dna.narrativeStrength ?? '—'}%</strong><span>Narrative strength</span><strong>${dna.evidenceQuality ?? '—'}%</strong><span>Evidence quality</span><strong>${esc(dna.strategicRisk || '—')}</strong><span>Strategic risk</span></div></div><div class="dnaGrid">${dnaGroup('Human values', dna.humanValues)}${dnaGroup('Emotional signals', dna.emotionalSignals)}${dnaGroup('Themes', dna.themes)}${dnaGroup('Beneficiaries', dna.beneficiaries)}${dnaGroup('Trust signals', dna.trustSignals)}</div></section><div class="scoreGrid six">${scoreTile('Human impact', analysis.humanImpact)}${scoreTile('Strategic value', analysis.strategicValue)}${scoreTile('Credibility', analysis.credibility)}${scoreTile('Opportunity', analysis.opportunity)}${scoreTile('Risk', analysis.risk)}${scoreTile('Completeness', analysis.completeness)}</div><p><strong>Category:</strong> ${esc(analysis.category)}</p><p><strong>Recommendation:</strong> ${esc(analysis.recommendation)}</p><div class="explain"><h4>Why?</h4><p>${esc(analysis.explainability?.why || '')}</p><p><strong>How to improve:</strong> ${esc(analysis.explainability?.improve || '')}</p></div><div class="chips">${analysis.keywords.map(keyword => `<span>${esc(keyword)}</span>`).join('')}</div><div class="audiences"><h3>Recommended audiences</h3>${(analysis.audienceMatches || []).map(match => `<article class="audience"><div><strong>${esc(match.name)}</strong><span class="match">${match.match}% match</span></div><p>${esc(match.rationale)}</p></article>`).join('') || '<p>No audience matches yet.</p>'}</div></section>`;
}

window.addEventListener('hashchange', () => renderRoute().catch(console.error));
$('#globalSearch').onclick = () => alert('Global search framework is ready for Sprint 3 implementation.');
$('#notifications').onclick = () => alert('No new executive notifications.');
if (!location.hash) location.hash = '#/executive';
loadSystemHealth();
renderRoute().catch(error => { $('#appContent').innerHTML = `<section class="panel notice">${esc(error.message)}</section>`; });
