const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

async function load() {
  const [health, storyData, auditData] = await Promise.all([
    api('/api/health'), api('/api/stories'), api('/api/audit')
  ]);

  $('#health').textContent = `System ${health.status} · ${health.version}`;
  $('#storyCount').textContent = storyData.stories.length;
  $('#auditCount').textContent = auditData.auditEvents.length;

  $('#stories').innerHTML = storyData.stories.map((story) => `
    <article class="card">
      <h3>${escapeHtml(story.title)}</h3>
      <p>${escapeHtml(story.summary || 'No summary yet.')}</p>
      <div class="meta">${escapeHtml(story.source || 'No source')} · ${new Date(story.createdAt).toLocaleString()}</div>
      <span class="badge">${escapeHtml(story.status)}</span>
    </article>
  `).join('') || '<p>No stories yet.</p>';

  $('#audit').innerHTML = auditData.auditEvents.map((event) => `
    <div class="auditRow">
      <span>${new Date(event.createdAt).toLocaleString()}</span>
      <strong>${escapeHtml(event.action)}</strong>
      <span>${escapeHtml(event.entityType)} · ${escapeHtml(event.entityId)}</span>
    </div>
  `).join('');
}

$('#storyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#formMessage');
  message.textContent = 'Saving…';
  try {
    await api('/api/stories', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#title').value,
        summary: $('#summary').value,
        source: $('#source').value
      })
    });
    event.target.reset();
    message.textContent = 'Story saved.';
    await load();
  } catch (error) {
    message.textContent = error.message;
  }
});

$('#refresh').addEventListener('click', load);
$('#reset').addEventListener('click', async () => {
  if (!confirm('Reset KNIP demo data?')) return;
  await api('/api/reset', { method: 'POST', body: '{}' });
  await load();
});

load().catch((error) => {
  $('#health').textContent = `System error: ${error.message}`;
});
