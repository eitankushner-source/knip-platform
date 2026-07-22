from app.main import aggregate_story_intelligence, app, build_dashboard_payload, normalize_story_item
from app.models import IntelligenceItem, SourceRecord
from datetime import datetime, timezone
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


client = TestClient(app)


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
    response = client.post('/api/advisory-board/challenge', json={'challenge': 'The evidence is too thin and the risk is reputational.'})
    assert response.status_code == 200
    assert response.json()['revisedRecommendation'] in {'MODIFY', 'MONITOR', 'DELAY'}
    assert response.json()['sourceMode'] in {'LIVE', 'RULE_BASED', 'FALLBACK'}


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
        if method in {'GET', 'POST'}
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
    ]
    for path in checks:
        response = client.get(path)
        assert response.status_code == 200, f'{path} should return 200'


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
        assert 'topStories' in audience
        assert 'averageMatch' in audience
        assert isinstance(audience['topStories'], list)


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
