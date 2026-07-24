import pytest
from app.auth import AuthenticatedProfile, require_authenticated_profile
from app.main import aggregate_story_intelligence, app, build_dashboard_payload, normalize_story_item
from app.models import IntelligenceItem, SourceRecord
from datetime import datetime, timezone
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


client = TestClient(app)


@pytest.fixture
def _decision_action_isolation(monkeypatch):
    class _Response:
        def __init__(self, data):
            self.data = data

    class _DecisionsInsertQuery:
        def insert(self, _payload: dict):
            return self

        def execute(self):
            # Return no inserted rows so endpoint skips downstream learning/campaign persistence branches.
            return _Response([])

    class _MinimalSupabaseClient:
        def table(self, table_name: str):
            if table_name != 'decisions':
                raise AssertionError(f'Unexpected table access in decision-action isolation fixture: {table_name}')
            return _DecisionsInsertQuery()

    def _fake_authenticated_profile() -> AuthenticatedProfile:
        return AuthenticatedProfile(
            supabase_user_id='11111111-1111-1111-1111-111111111111',
            profile_id='11111111-1111-1111-1111-111111111111',
            email='parity-test@example.com',
        )

    app.dependency_overrides[require_authenticated_profile] = _fake_authenticated_profile
    monkeypatch.setattr('app.main.get_supabase_admin_client', lambda: _MinimalSupabaseClient())
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_authenticated_profile, None)


def test_normalize_story_item_adds_audience_metadata():
    story = IntelligenceItem(
        id='story-1',
        title='Israeli water tech helps farmers in Texas',
        summary='A humanitarian innovation story with strong climate resilience and shared democratic values.',
        published_at=datetime.now(timezone.utc),
        url='https://example.com/story',
        geography=['Texas'],
        audiences=['Moderate Democrats'],
        narratives=['humanitarian activity', 'innovation and technology'],
        confidence=0.82,
        source=SourceRecord(
            connector='rss',
            source_name='Test Source',
            source_url='https://example.com/story',
            collected_at=datetime.now(timezone.utc),
            reliability=0.9,
            freshness='live',
            license_note='free',
        ),
        raw={},
    )
    normalized = normalize_story_item(story, 'rss', 'Curated RSS')
    assert normalized.audienceMatches
    assert normalized.bestAudienceMatch is not None
    assert normalized.audienceMatchScore >= 0
    assert normalized.audienceDataMode in {'RULE_BASED', 'PARTIAL'}


def test_build_dashboard_payload_hydrates_audience_fields():
    story = normalize_story_item(
        IntelligenceItem(
            id='story-2',
            title='Israeli innovation supports humanitarian work in California',
            summary='A climate and health story with strong relevance for moderate Democrats and sustainability leaders.',
            published_at=datetime.now(timezone.utc),
            url='https://example.com/story-2',
            geography=['California'],
            audiences=['Moderate Democrats'],
            narratives=['humanitarian activity', 'shared democratic values'],
            confidence=0.76,
            source=SourceRecord(
                connector='gdelt',
                source_name='Test Source',
                source_url='https://example.com/story-2',
                collected_at=datetime.now(timezone.utc),
                reliability=0.84,
                freshness='live',
                license_note='free',
            ),
            raw={},
        ),
        'gdelt-doc',
        'GDELT DOC 2.0',
    )
    story.eligibleForExecutiveUse = True
    payload = build_dashboard_payload([story], live=True)
    assert payload['fallback'] is False
    assert payload['priorityDecision']['bestAudienceName']
    assert payload['priorityDecision']['audienceMatchScore'] >= 0
    assert payload['priorityDecision']['audienceDataMode'] in {'RULE_BASED', 'PARTIAL'}


def test_advisory_board_contains_all_roles_and_live_labeling():
    story = normalize_story_item(
        IntelligenceItem(
            id='story-3',
            title='Israeli water tech improves lives for farmers in Texas',
            summary='A humanitarian story with strong evidence quality and audience relevance for moderate Democrats.',
            published_at=datetime.now(timezone.utc),
            url='https://example.com/story-3',
            geography=['Texas'],
            audiences=['Moderate Democrats'],
            narratives=['humanitarian activity', 'innovation and technology'],
            confidence=0.82,
            source=SourceRecord(
                connector='rss',
                source_name='Test Source',
                source_url='https://example.com/story-3',
                collected_at=datetime.now(timezone.utc),
                reliability=0.88,
                freshness='live',
                license_note='free',
            ),
            raw={},
        ),
        'rss',
        'Curated RSS',
    )
    story.eligibleForExecutiveUse = True
    payload = build_dashboard_payload([story], live=True)
    assert len(payload['advisoryBoard']) == 5
    assert payload['advisoryConsensus']['consensusRecommendation'] in {'APPROVE', 'MODIFY', 'DELAY', 'MONITOR', 'REJECT'}
    assert payload['advisoryConsensus']['sourceMode'] == 'LIVE'
    assert payload['minorityOpinion']
    assert payload['decisionReadiness'] in {'READY', 'CONDITIONAL', 'HOLD'}


def test_challenge_endpoint_returns_revised_recommendation():
    def _fake_authenticated_profile() -> AuthenticatedProfile:
        return AuthenticatedProfile(
            supabase_user_id='11111111-1111-1111-1111-111111111111',
            profile_id='11111111-1111-1111-1111-111111111111',
            email='parity-test@example.com',
        )

    app.dependency_overrides[require_authenticated_profile] = _fake_authenticated_profile
    try:
        response = client.post('/api/advisory-board/challenge', json={'challenge': 'The evidence is too thin and the risk is reputational.'})
        assert response.status_code == 200
        assert response.json()['revisedRecommendation'] in {'MODIFY', 'MONITOR', 'DELAY'}
        assert response.json()['sourceMode'] in {'LIVE', 'RULE_BASED', 'FALLBACK'}
    finally:
        app.dependency_overrides.pop(require_authenticated_profile, None)


def test_consensus_endpoint_exposes_consensus_and_minorities():
    response = client.get('/api/advisory-board/consensus')
    assert response.status_code == 200
    payload = response.json()
    assert payload['consensus']['consensusRecommendation']
    assert payload['minorityOpinion']
    assert payload['decisionReadiness'] in {'READY', 'CONDITIONAL', 'HOLD'}


def test_fastapi_route_inventory_contains_baseline_endpoints():
    route_inventory = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
        if method in {'GET', 'POST', 'PUT'}
    }

    canonical_required = {
        ('GET', '/api/health'),
        ('GET', '/api/dashboard'),
        ('GET', '/api/connectors'),
        ('GET', '/api/stories'),
        ('GET', '/api/audiences'),
        ('GET', '/api/audiences/{audience_id}'),
        ('GET', '/api/stories/{story_id}/audiences'),
        ('GET', '/api/advisory-board/consensus'),
        ('POST', '/api/advisory-board/challenge'),
        ('GET', '/api/demographics/states'),
        ('GET', '/api/rss'),
        ('GET', '/api/research-agents'),
        ('POST', '/api/research-agents/{agent_id}/run'),
    }
    assert canonical_required.issubset(route_inventory)

    compatibility_required = {
        ('GET', '/api/audience-intelligence'),
        ('GET', '/api/advisory-board'),
        ('GET', '/api/campaign-plans'),
        ('GET', '/api/campaign-plans/{plan_id}'),
        ('GET', '/api/decisions'),
        ('GET', '/api/decisions/{decision_id}'),
        ('POST', '/api/decisions/{decision_id}/actions'),
        ('GET', '/api/learning/{learning_id}'),
        ('PUT', '/api/learning/{learning_id}'),
        ('GET', '/api/learning-intelligence'),
    }
    assert compatibility_required.issubset(route_inventory)

    has_advisory_detail_compatibility = any(
        method == 'GET' and path.startswith('/api/advisory-board/{') and path.endswith('}')
        for method, path in route_inventory
    )
    assert has_advisory_detail_compatibility


def test_fastapi_baseline_smoke_endpoints_return_ok():
    checks = [
        '/api/health',
        '/api/dashboard',
        '/api/connectors',
        '/api/stories',
        '/api/audiences',
        '/api/audience-intelligence',
        '/api/advisory-board',
        '/api/campaign-plans',
        '/api/decisions',
        '/api/learning-intelligence',
    ]
    for path in checks:
        response = client.get(path)
        assert response.status_code == 200, f'{path} should return 200'


def test_decisions_list_compatibility_shape():
    response = client.get('/api/decisions')
    assert response.status_code == 200
    payload = response.json()
    assert 'decisionBriefs' in payload
    assert 'executiveDecisions' in payload
    assert isinstance(payload['decisionBriefs'], list)
    assert isinstance(payload['executiveDecisions'], list)
    if payload['decisionBriefs']:
        brief = payload['decisionBriefs'][0]
        assert 'id' in brief
        assert 'title' in brief
        assert 'recommendation' in brief
        assert 'confidence' in brief
        assert 'status' in brief


def test_decision_detail_compatibility_shape_and_404():
    listing = client.get('/api/decisions')
    assert listing.status_code == 200
    briefs = listing.json()['decisionBriefs']
    assert briefs
    decision_id = briefs[0]['id']

    response = client.get(f'/api/decisions/{decision_id}')
    assert response.status_code == 200
    payload = response.json()
    assert 'brief' in payload
    assert 'decisions' in payload
    assert payload['brief']['id'] == decision_id
    assert isinstance(payload['decisions'], list)

    missing = client.get('/api/decisions/does-not-exist')
    assert missing.status_code == 404
    assert missing.json()['detail'] == 'Decision brief not found'


def test_decision_action_compatibility_shape_and_unknown_id_404(_decision_action_isolation):
    listing = client.get('/api/decisions')
    assert listing.status_code == 200
    briefs = listing.json()['decisionBriefs']
    assert briefs
    decision_id = briefs[0]['id']

    response = client.post(
        f'/api/decisions/{decision_id}/actions',
        json={'action': 'APPROVE', 'note': 'Approved in compatibility test.'},
    )
    assert response.status_code == 200
    payload = response.json()
    assert 'decision' in payload
    assert 'brief' in payload
    assert 'learningRecord' in payload
    assert payload['decision']['briefId'] == decision_id
    assert payload['brief']['id'] == decision_id

    missing = client.post('/api/decisions/does-not-exist/actions', json={'action': 'APPROVE'})
    assert missing.status_code == 404
    assert missing.json()['detail'] == 'Decision brief not found'


def test_learning_detail_compatibility_shape_and_404():
    listing = client.get('/api/decisions')
    assert listing.status_code == 200
    briefs = listing.json()['decisionBriefs']
    assert briefs
    brief_id = briefs[0]['id']

    response = client.get(f'/api/learning/{brief_id}')
    assert response.status_code == 200
    payload = response.json()
    assert 'learningRecord' in payload
    assert payload['learningRecord']['briefId'] == brief_id

    missing = client.get('/api/learning/does-not-exist')
    assert missing.status_code == 404
    assert missing.json()['detail'] == 'Learning record not found'


def test_learning_update_compatibility_shape_and_preservation():
    def _fake_authenticated_profile() -> AuthenticatedProfile:
        return AuthenticatedProfile(
            supabase_user_id='11111111-1111-1111-1111-111111111111',
            profile_id='11111111-1111-1111-1111-111111111111',
            email='parity-test@example.com',
        )

    app.dependency_overrides[require_authenticated_profile] = _fake_authenticated_profile
    try:
        listing = client.get('/api/decisions')
        assert listing.status_code == 200
        briefs = listing.json()['decisionBriefs']
        assert briefs
        brief_id = briefs[0]['id']

        before = client.get(f'/api/learning/{brief_id}')
        assert before.status_code == 200
        original = before.json()['learningRecord']

        response = client.put(
            f'/api/learning/{brief_id}',
            json={'outcome': 'SUCCESS', 'lessonsLearned': 'Compatibility path verified.'},
        )
        assert response.status_code == 200
        payload = response.json()
        assert 'learningRecord' in payload
        updated = payload['learningRecord']
        assert updated['briefId'] == brief_id
        assert updated['id'] == original['id']
        assert updated['outcome'] == 'SUCCESS'
        assert updated['lessonsLearned'] == 'Compatibility path verified.'
    finally:
        app.dependency_overrides.pop(require_authenticated_profile, None)


def test_learning_intelligence_compatibility_shape():
    response = client.get('/api/learning-intelligence')
    assert response.status_code == 200
    payload = response.json()
    assert 'intelligence' in payload
    intelligence = payload['intelligence']
    assert 'metrics' in intelligence
    assert 'records' in intelligence
    assert 'insights' in intelligence
    assert 'reusablePatterns' in intelligence
    assert isinstance(intelligence['records'], list)


def test_audience_intelligence_compatibility_shape():
    response = client.get('/api/audience-intelligence')
    assert response.status_code == 200
    payload = response.json()
    assert 'audiences' in payload
    assert 'stories' in payload
    assert isinstance(payload['audiences'], list)
    assert isinstance(payload['stories'], list)
    if payload['audiences']:
        audience = payload['audiences'][0]
        assert 'id' in audience
        assert 'name' in audience
        assert 'values' in audience
        assert 'channels' in audience
        assert 'messengers' in audience
        assert 'topStories' in audience
        assert 'averageMatch' in audience
        assert isinstance(audience['topStories'], list)


def test_audience_detail_compatibility_shape_preserves_profile_fields():
    listing = client.get('/api/audiences')
    assert listing.status_code == 200
    audiences = listing.json()['audiences']
    assert audiences
    audience_id = audiences[0]['id']

    response = client.get(f'/api/audiences/{audience_id}')
    assert response.status_code == 200
    payload = response.json()
    assert 'audience' in payload

    audience = payload['audience']
    assert audience['id'] == audience_id
    assert set(audiences[0]).issubset(audience.keys())
    assert 'name' in audience
    assert 'channels' in audience
    assert 'messengers' in audience


def test_advisory_board_compatibility_shape_includes_sessions_without_removing_canonical_fields():
    response = client.get('/api/advisory-board')
    assert response.status_code == 200
    payload = response.json()
    assert 'advisoryBoard' in payload
    assert 'advisoryConsensus' in payload
    assert 'sessions' in payload
    assert isinstance(payload['sessions'], list)
    if payload['sessions']:
        session = payload['sessions'][0]
        assert 'briefId' in session
        assert 'title' in session
        assert 'advisors' in session
        assert 'agreements' in session
        assert 'disagreements' in session


def test_advisory_board_detail_compatibility_shape():
    listing = client.get('/api/advisory-board')
    assert listing.status_code == 200
    sessions = listing.json()['sessions']
    assert sessions
    brief_id = sessions[0]['briefId']
    response = client.get(f'/api/advisory-board/{brief_id}')
    assert response.status_code == 200
    payload = response.json()
    assert 'session' in payload
    assert payload['session']['briefId'] == brief_id
    assert isinstance(payload['session']['advisors'], list)


def test_campaign_plans_compatibility_shape():
    response = client.get('/api/campaign-plans')
    assert response.status_code == 200
    payload = response.json()
    assert 'campaignPlans' in payload
    assert isinstance(payload['campaignPlans'], list)
    if payload['campaignPlans']:
        plan = payload['campaignPlans'][0]
        assert 'title' in plan
        assert 'channels' in plan
        assert 'dependencies' in plan
        assert 'ruby' in plan
        assert plan['ruby']['name'] == 'Ruby'


def test_campaign_plan_detail_compatibility_shape_preserves_plan_fields():
    listing = client.get('/api/campaign-plans')
    assert listing.status_code == 200
    plans = listing.json()['campaignPlans']
    assert plans

    plan_id = plans[0]['id']
    response = client.get(f'/api/campaign-plans/{plan_id}')
    assert response.status_code == 200
    payload = response.json()
    assert 'campaignPlan' in payload

    plan = payload['campaignPlan']
    assert plan['id'] == plan_id
    assert set(plans[0]).issubset(plan.keys())
    assert 'ruby' in plan
    assert 'channels' in plan
    assert 'dependencies' in plan


def test_campaign_plan_detail_returns_404_for_missing_plan():
    response = client.get('/api/campaign-plans/does-not-exist')
    assert response.status_code == 404
    assert response.json()['detail'] == 'Campaign plan not found'
