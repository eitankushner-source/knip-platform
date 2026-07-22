/**
 * KNIP RC2 frontend API service.
 * The UI always calls this service rather than external providers directly.
 * Set window.KNIP_API_BASE before loading this file to point at a live backend.
 */
(function () {
  const baseUrl = window.KNIP_API_BASE || '/api';
  const capabilityMap = Object.freeze({
    dashboard: { method: 'GET', path: '/dashboard', mode: 'LIVE|FALLBACK', consumer: 'legacy executive home hydration' },
    stories: { method: 'GET', path: '/stories', mode: 'LIVE', consumer: 'legacy story repository integration' },
    connectors: { method: 'GET', path: '/connectors', mode: 'LIVE|DEGRADED', consumer: 'platform architecture diagnostics' },
    researchAgents: { method: 'GET', path: '/research-agents', mode: 'LIVE', consumer: 'research agent registry' },
    researchAgentRun: { method: 'POST', path: '/research-agents/{agentId}/run', mode: 'LIVE', consumer: 'research agent execution' },
    stateDemographics: { method: 'GET', path: '/demographics/states', mode: 'LIVE', consumer: 'audience demographic overlays' }
  });

  const fallbackDashboard = {
    generatedAt: '2026-07-22T07:00:00+03:00',
    lastLogin: 'Yesterday, 8:32 AM',
    metrics: {
      storiesValidated: { value: 4, trend: '↑ 33%' },
      campaignsCompleted: { value: 2, trend: '↑ 100%' },
      narrativesEmerging: { value: 1, trend: 'NEW' },
      audienceSentiment: { value: '+4%', trend: '↑ 4%' }
    },
    priorityDecision: {
      title: 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation',
      summary: 'A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.',
      audienceMatch: 94,
      evidenceQuality: 92,
      strategicImpact: 'High',
      strategicImpactScore: 88,
      readiness: 96,
      readinessState: 'READY',
      approvedImpact: 'Reach 2.4M people · expected engagement +18%',
      delayImpact: 'Opportunity likely declines within 72 hours'
    },
    source: 'RC1 demonstration fallback'
  };

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'Accept': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) throw new Error(`KNIP API ${response.status}: ${response.statusText}`);
    return response.json();
  }

  window.KNIPApi = {
    async getDashboard() {
      try {
        return await request('/dashboard');
      } catch (error) {
        console.info('[KNIP RC2] Dashboard API unavailable; using demonstration fallback.', error.message);
        return fallbackDashboard;
      }
    },
    getStories(query = '', limit = 20) { return request(`/stories?q=${encodeURIComponent(query)}&limit=${limit}`); },
    getConnectors() { return request('/connectors'); },
    getResearchAgents() { return request('/research-agents'); },
    runResearchAgent(agentId, limit = 20) { return request(`/research-agents/${encodeURIComponent(agentId)}/run?limit=${limit}`, { method: 'POST' }); },
    getStateDemographics(year = 2024) { return request(`/demographics/states?year=${year}`); },
    capabilityMap,
    request,
    baseUrl
  };
})();
