from app.main import aggregate_story_intelligence, build_dashboard_payload, normalize_story_item
from app.models import IntelligenceItem, SourceRecord
from datetime import datetime, timezone


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
