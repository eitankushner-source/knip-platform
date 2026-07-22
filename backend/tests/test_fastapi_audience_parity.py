from app.main import aggregate_story_intelligence, app, build_dashboard_payload, normalize_story_item
from app.models import IntelligenceItem, SourceRecord
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from pathlib import Path


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
    source = Path(__file__).resolve().parents[1] / 'app' / 'main.py'
    contents = source.read_text(encoding='utf-8')
    expected = [
        '@app.get("/api/health")',
        '@app.get("/api/dashboard")',
        '@app.get("/api/connectors")',
        '@app.get("/api/stories")',
        '@app.get("/api/audiences")',
        '@app.get("/api/audiences/{audience_id}")',
        '@app.get("/api/stories/{story_id}/audiences")',
        '@app.get("/api/advisory-board")',
        '@app.get("/api/advisory-board/consensus")',
        '@app.post("/api/advisory-board/challenge")',
        '@app.get("/api/demographics/states")',
        '@app.get("/api/rss")',
        '@app.get("/api/research-agents")',
        '@app.post("/api/research-agents/{agent_id}/run")',
    ]
    for marker in expected:
        assert marker in contents


def test_fastapi_baseline_smoke_endpoints_return_ok():
    checks = [
        '/api/health',
        '/api/dashboard',
        '/api/connectors',
        '/api/stories',
        '/api/audiences',
        '/api/advisory-board',
    ]
    for path in checks:
        response = client.get(path)
        assert response.status_code == 200, f'{path} should return 200'
