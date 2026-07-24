/**
 * KNIP RC2 frontend API service.
 * The UI always calls this service rather than external providers directly.
 * Set window.KNIP_API_BASE before loading this file to point at a live backend.
 */
(function () {
  const baseUrl = window.KNIP_API_BASE || '/api';
  let supabaseClient = null;
  let currentSession = null;
  const capabilityMap = Object.freeze({
    dashboard: { method: 'GET', path: '/dashboard', mode: 'LIVE|FALLBACK', consumer: 'legacy executive home hydration' },
    stories: { method: 'GET', path: '/stories', mode: 'LIVE', consumer: 'legacy story repository integration' },
    connectors: { method: 'GET', path: '/connectors', mode: 'LIVE|DEGRADED', consumer: 'platform architecture diagnostics' },
    researchAgents: { method: 'GET', path: '/research-agents', mode: 'LIVE', consumer: 'research agent registry' },
    researchAgentRun: { method: 'POST', path: '/research-agents/{agentId}/run', mode: 'LIVE', consumer: 'research agent execution' },
    stateDemographics: { method: 'GET', path: '/demographics/states', mode: 'LIVE', consumer: 'audience demographic overlays' },
    audiences: { method: 'GET', path: '/audiences', mode: 'LIVE', consumer: 'audience profile directory' },
    audienceDetail: { method: 'GET', path: '/audiences/{audienceId}', mode: 'LIVE', consumer: 'audience drill-in' },
    audienceIntelligence: { method: 'GET', path: '/audience-intelligence', mode: 'LIVE', consumer: 'ranked audience-fit summaries' },
    campaignPlans: { method: 'GET', path: '/campaign-plans', mode: 'LIVE', consumer: 'campaign planning summaries' },
    campaignPlanDetail: { method: 'GET', path: '/campaign-plans/{planId}', mode: 'LIVE', consumer: 'campaign plan drill-in' }
  });

  function updateAuthUi() {
    const status = document.getElementById('authStatus');
    const loginForm = document.getElementById('authLoginForm');
    const logoutButton = document.getElementById('authLogout');
    const email = currentSession?.user?.email || 'Signed out';

    if (status) status.textContent = email;
    if (loginForm) loginForm.hidden = Boolean(currentSession);
    if (logoutButton) logoutButton.hidden = !currentSession;
  }

  async function loadAuthConfig() {
    const response = await fetch(`${baseUrl}/auth/config`);
    if (!response.ok) throw new Error('Unable to load auth configuration');
    return response.json();
  }

  async function initAuth() {
    if (!window.supabase?.createClient) return;
    try {
      const config = await loadAuthConfig();
      if (!config.supabaseUrl || !config.supabasePublishableKey) return;

      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      const { data } = await supabaseClient.auth.getSession();
      currentSession = data.session || null;
      updateAuthUi();

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        currentSession = session || null;
        updateAuthUi();
      });

      const loginForm = document.getElementById('authLoginForm');
      if (loginForm) {
        loginForm.addEventListener('submit', async event => {
          event.preventDefault();
          const emailInput = document.getElementById('authEmail');
          const passwordInput = document.getElementById('authPassword');
          const email = emailInput?.value || '';
          const password = passwordInput?.value || '';
          const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
        });
      }

      const logoutButton = document.getElementById('authLogout');
      if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
          await supabaseClient.auth.signOut();
        });
      }
    } catch (error) {
      console.warn('[KNIP auth] initialization skipped:', error.message);
    }
  }

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
    const authToken = currentSession?.access_token;
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        'Accept': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        ...(options.headers || {})
      },
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
    auth: {
      async login(email, password) {
        if (!supabaseClient) throw new Error('Supabase Auth is not configured');
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async logout() {
        if (!supabaseClient) return;
        await supabaseClient.auth.signOut();
      },
      async restoreSession() {
        if (!supabaseClient) return null;
        const { data } = await supabaseClient.auth.getSession();
        currentSession = data.session || null;
        updateAuthUi();
        return currentSession;
      },
      get accessToken() {
        return currentSession?.access_token || null;
      },
    },
    capabilityMap,
    request,
    baseUrl
  };

  initAuth();
})();
