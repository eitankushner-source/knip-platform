const $ = selector => document.querySelector(selector);
let selectedId = null;

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
        ${decisionRow('High', 'Kenyan heart surgeons', 'Publish', '94%')}
        ${decisionRow('Medium', 'Druze first responders', 'Research', '82%')}
        ${decisionRow('Normal', 'Israeli climate startup', 'Hold', '79%')}
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
function decisionRow(priority, story, recommendation, confidence) {
  return `<button class="tableRow decisionPreview" type="button"><span><i class="priority ${priority.toLowerCase()}"></i>${priority}</span><strong>${esc(story)}</strong><span>${esc(recommendation)}</span><span>${esc(confidence)}</span></button>`;
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

function comingSoonTemplate(route) {
  const config = routeConfig[route];
  return `<section class="page comingSoon"><div class="comingSoonIcon">◇</div><p class="eyebrow dark">SPRINT 3 FOUNDATION</p><h3>${esc(config.title)}</h3><p>The navigation route and executive workspace shell are now active. Functional implementation for this module follows in the next scheduled iteration.</p><button class="primaryAction" type="button" data-go="executive">Return to Executive Decision Center</button></section>`;
}

function storyRepositoryTemplate() {
  return `<section class="storyLayout">
    <aside class="panel repositoryPanel"><div class="sectionHeader"><div><p class="eyebrow dark">REPOSITORY</p><h3>Story intelligence</h3></div><button id="refresh" class="secondary">Refresh</button></div>
      <form id="storyForm" class="compact"><div class="formGrid"><label class="wide">Title<input id="title" required maxlength="180"></label><label class="wide">Executive summary<textarea id="summary" rows="3"></textarea></label><label class="wide">Full narrative<textarea id="fullNarrative" rows="4"></textarea></label><label>Country<input id="country"></label><label>Location<input id="location"></label><label>Language<input id="language" value="English"></label><label>Source type<select id="sourceType"><option value="">Select</option><option>Citizen testimony</option><option>News</option><option>NGO</option><option>Academic</option><option>Government</option><option>Interview</option></select></label><label>Source organization<input id="source"></label><label>Original author<input id="author"></label><label class="wide">Tags (comma-separated)<input id="tags" placeholder="water, farming, resilience"></label></div><button type="submit">Save story</button><p id="formMessage" class="message"></p></form>
      <div id="stories" class="cards"></div>
    </aside>
    <section id="detail" class="panel detail"><div class="empty"><h3>Select a story</h3><p>Choose a story to review evidence, scores, audience matches, and explainability.</p></div></section>
    <section class="panel auditPanel"><div class="sectionHeader"><div><p class="eyebrow dark">GOVERNANCE</p><h3>Audit trail</h3></div><button id="reset" class="danger">Reset demo data</button></div><div id="audit" class="audit"></div></section>
  </section>`;
}

async function renderRoute() {
  const route = currentRoute();
  setActiveNavigation(route);
  const content = $('#appContent');
  content.innerHTML = route === 'executive' ? executiveTemplate() : route === 'stories' ? storyRepositoryTemplate() : comingSoonTemplate(route);
  content.focus();
  document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => { location.hash = `#/${button.dataset.go}`; });
  if (route === 'stories') await loadStories();
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
  const [storyData, auditData] = await Promise.all([api('/api/stories'), api('/api/audit')]);
  $('#stories').innerHTML = storyData.stories.map(story => `<button class="storyCard ${selectedId === story.id ? 'selected' : ''}" data-id="${story.id}"><span class="storyTop"><strong>${esc(story.title)}</strong><span class="badge">${esc(story.status)}</span></span><small>${story.evidenceCount} evidence · ${story.latestAnalysis ? `${story.latestAnalysis.opportunity}% opportunity` : 'Not analyzed'}</small></button>`).join('') || '<p>No stories yet.</p>';
  document.querySelectorAll('.storyCard').forEach(button => button.onclick = () => selectStory(button.dataset.id));
  $('#audit').innerHTML = auditData.auditEvents.map(event => `<div class="auditRow"><span>${new Date(event.createdAt).toLocaleString()}</span><strong>${esc(event.action)}</strong><span>${esc(event.entityType)} · ${esc(event.detail || event.entityId)}</span></div>`).join('');
  bindStoryForm();
  $('#refresh').onclick = loadStories;
  $('#reset').onclick = async () => { if (!confirm('Reset KNIP demo data?')) return; await api('/api/reset', { method: 'POST', body: '{}' }); selectedId = null; await loadStories(); };
  if (selectedId && storyData.stories.some(story => story.id === selectedId)) await renderDetail();
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
function analysisHtml(analysis) {
  return `<section class="analysis"><div class="sectionHeader"><div><h3>Latest analysis</h3><small>${esc(analysis.model)} · ${new Date(analysis.createdAt).toLocaleString()}</small></div><strong class="score ${scoreClass(analysis.confidence)}">${analysis.confidence}% confidence</strong></div><div class="scoreGrid six">${scoreTile('Human impact', analysis.humanImpact)}${scoreTile('Strategic value', analysis.strategicValue)}${scoreTile('Credibility', analysis.credibility)}${scoreTile('Opportunity', analysis.opportunity)}${scoreTile('Risk', analysis.risk)}${scoreTile('Completeness', analysis.completeness)}</div><p><strong>Category:</strong> ${esc(analysis.category)}</p><p><strong>Recommendation:</strong> ${esc(analysis.recommendation)}</p><div class="explain"><h4>Why?</h4><p>${esc(analysis.explainability?.why || '')}</p><p><strong>How to improve:</strong> ${esc(analysis.explainability?.improve || '')}</p></div><div class="chips">${analysis.keywords.map(keyword => `<span>${esc(keyword)}</span>`).join('')}</div><div class="audiences"><h3>Recommended audiences</h3>${(analysis.audienceMatches || []).map(match => `<article class="audience"><div><strong>${esc(match.name)}</strong><span class="match">${match.match}% match</span></div><p>${esc(match.rationale)}</p></article>`).join('') || '<p>No audience matches yet.</p>'}</div></section>`;
}

window.addEventListener('hashchange', () => renderRoute().catch(console.error));
$('#globalSearch').onclick = () => alert('Global search framework is ready for Sprint 3 implementation.');
$('#notifications').onclick = () => alert('No new executive notifications.');
if (!location.hash) location.hash = '#/executive';
loadSystemHealth();
renderRoute().catch(error => { $('#appContent').innerHTML = `<section class="panel notice">${esc(error.message)}</section>`; });
