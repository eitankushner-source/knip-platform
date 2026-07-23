from datetime import datetime, timedelta, timezone
import asyncio
import re
from html import unescape
from hashlib import sha256
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.supabase_client import get_admin_profile_id, get_supabase_admin_client
from app.connectors.census import CensusConnector
from app.connectors.gdelt import GdeltConnector
from app.connectors.research_agents import ResearchAgentConnector
from app.connectors.rss import RssConnector
from app.models import AudienceMatch, IntelligenceItem, NormalizedStory, SourceRecord
from app.services.advisory_board import build_advisory_board, challenge_advisory_board
from app.services.dashboard import DashboardService

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.2.0-rc2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

dashboard_service = DashboardService()
gdelt = GdeltConnector()
census = CensusConnector()
rss = RssConnector()
research_agents = ResearchAgentConnector()
_ADVISORY_SESSION_CACHE: dict[str, dict] = {}
_CAMPAIGN_PLAN_CACHE: dict[str, dict] = {}
_DECISION_BRIEF_CACHE: dict[str, dict] = {}
_LEARNING_RECORD_CACHE: dict[str, dict] = {}
_EXECUTIVE_DECISIONS: list[dict] = []

AUDIENCE_PROFILES = [
    {'id': 'aud_mod_dems', 'name': 'Moderate Democrats', 'signals': ['democracy', 'bipartisan cooperation', 'climate resilience', 'healthcare', 'humanitarian impact', 'pragmatic u.s.–israel cooperation'], 'values': ['cooperation', 'pragmatism', 'shared values'], 'geography': ['United States'], 'channels': ['email', 'digital video'], 'messengers': ['community leaders']},
    {'id': 'aud_yh_evang', 'name': 'Young Hispanic Evangelicals', 'signals': ['faith', 'family', 'community development', 'entrepreneurship', 'agriculture', 'water and food security'], 'values': ['family', 'service', 'opportunity'], 'geography': ['Texas', 'Florida', 'California'], 'channels': ['podcast', 'social video'], 'messengers': ['faith leaders']},
    {'id': 'aud_genz_jews', 'name': 'Gen Z Jewish Students', 'signals': ['campus', 'identity', 'pluralism', 'technology', 'democracy', 'social impact', 'authentic peer voices'], 'values': ['identity', 'belonging', 'impact'], 'geography': ['New York', 'California', 'Illinois'], 'channels': ['short-form video', 'campus events'], 'messengers': ['student leaders']},
    {'id': 'aud_health', 'name': 'Healthcare Professionals', 'signals': ['medicine', 'digital health', 'public health', 'emergency care', 'medical research', 'patient outcomes'], 'values': ['evidence', 'care', 'innovation'], 'geography': ['United States'], 'channels': ['professional networks', 'journals'], 'messengers': ['clinicians']},
    {'id': 'aud_sustain', 'name': 'Sustainability Leaders', 'signals': ['climate', 'water', 'agriculture', 'renewable energy', 'conservation', 'resilience', 'food security'], 'values': ['stewardship', 'resilience', 'impact'], 'geography': ['United States', 'Israel'], 'channels': ['executive briefings', 'industry forums'], 'messengers': ['industry experts']},
    {'id': 'aud_black_faith', 'name': 'African-American Faith Leaders', 'signals': ['faith', 'civil rights', 'community resilience', 'healthcare equity', 'humanitarian activity', 'shared historical experience'], 'values': ['justice', 'community', 'service'], 'geography': ['United States'], 'channels': ['faith networks', 'community forums'], 'messengers': ['pastors']},
]
STATE_DEMOGRAPHIC_PROFILES = {
    'california': {'medianIncome': 95000, 'hispanicShare': 39.4, 'urbanity': 0.92},
    'texas': {'medianIncome': 76000, 'hispanicShare': 40.2, 'urbanity': 0.87},
    'florida': {'medianIncome': 71000, 'hispanicShare': 26.1, 'urbanity': 0.83},
    'newyork': {'medianIncome': 82000, 'hispanicShare': 19.0, 'urbanity': 0.95},
    'illinois': {'medianIncome': 78000, 'hispanicShare': 17.5, 'urbanity': 0.88},
    'pennsylvania': {'medianIncome': 73000, 'hispanicShare': 7.8, 'urbanity': 0.81},
}
STATE_ALIASES = {
    'ca': 'california', 'california': 'california', 'tx': 'texas', 'texas': 'texas', 'fl': 'florida', 'florida': 'florida', 'ny': 'newyork', 'new york': 'newyork', 'newyork': 'newyork', 'il': 'illinois', 'illinois': 'illinois', 'pa': 'pennsylvania', 'pennsylvania': 'pennsylvania',
}


def coerce_datetime(value: object) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def sanitize_text(value: object) -> str:
    text = str(value or '')
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</(p|div|li|ul|ol|section|article|h[1-6]|blockquote|tr|td|th)>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<(script|style|svg|img|iframe|object|embed|noscript|canvas|link|meta|input|button)[^>]*>[\s\S]*?</\1>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<(script|style|svg|img|iframe|object|embed|noscript|canvas|link|meta|input|button)[^>]*>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def normalize_url(value: object) -> str | None:
    text = sanitize_text(value).replace(' ', '')
    if not text:
        return None
    try:
        parsed = urlparse(text)
        parsed = parsed._replace(fragment='')
        parsed = parsed._replace(query='')
        return parsed.geturl().rstrip('/')
    except Exception:
        return text.rstrip('/')


def normalize_title(value: object) -> str:
    return sanitize_text(value)


def normalize_title_key(value: object) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', normalize_title(value).lower()).strip()


def title_similarity(left: object, right: object) -> float:
    left_key = normalize_title_key(left)
    right_key = normalize_title_key(right)
    if not left_key or not right_key:
        return 0.0
    left_tokens = left_key.split()
    right_tokens = right_key.split()
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = sum(1 for token in left_tokens if token in right_tokens)
    return overlap / max(len(left_tokens), len(right_tokens))


def classify_strategic_relevance(text: str, audience_tags: list[str], narrative_tags: list[str]) -> tuple[str, float]:
    combined = f"{text} {' '.join(audience_tags)} {' '.join(narrative_tags)}".lower()
    if re.search(r'(scandal|accus|lawsuit|investigation|fraud|misconduct|corruption|controversy)', combined):
        return 'reputational risk', 30.0
    if re.search(r'(political|partisan|election|campaign|congress|senate|boycott|protest|war|conflict|division)', combined):
        return 'political controversy', 25.0
    if re.search(r'(audience|framing|risk|sensitive)', combined):
        return 'audience risk', 35.0
    if re.search(r'(humanitarian|relief|aid|healthcare|medical|hospital|patient|food|water|shelter|education|support)', combined):
        return 'humanitarian activity', 83.0
    if re.search(r'(innovation|technology|tech|startup|ai|artificial intelligence|research|digital|platform)', combined):
        return 'innovation and technology', 81.0
    if re.search(r'(family|community|students|children|farmers|people|lives|benefit|help|care|impact)', combined):
        return 'positive human impact', 79.0
    if re.search(r'(democracy|democratic|rights|freedom|coexistence|shared values|allies|partnership)', combined):
        return 'shared democratic values', 74.0
    if re.search(r'(culture|society|faith|youth|student|identity|community|arts)', combined):
        return 'culture and society', 72.0
    if re.search(r'(u\.s|united states|american|washington|alliance|relationship)', combined):
        return 'U.S.–Israel relationship', 70.0
    return 'low relevance', 20.0


def infer_audience_tags(title: str, summary: str, story: dict | None = None) -> list[str]:
    combined = f"{title} {summary}".lower()
    existing = []
    if story and isinstance(story, dict):
        existing = [sanitize_text(item) for item in story.get('audienceTags', []) if sanitize_text(item)]
    inferred: list[str] = []
    if re.search(r'(moderate|democrat|democratic|shared values|coexistence|rights|freedom)', combined):
        inferred.append('Moderate Democrats')
    if re.search(r'(young|hispanic|evangelical|faith|church|community service)', combined):
        inferred.append('Young Hispanic Evangelicals')
    if re.search(r'(gen z|student|students|campus|college|jewish)', combined):
        inferred.append('Gen Z Jewish Students')
    if re.search(r'(health|healthcare|medical|hospital|patient)', combined):
        inferred.append('Healthcare Professionals')
    if re.search(r'(sustainability|climate|water|environment|resilience|energy)', combined):
        inferred.append('Sustainability Leaders')
    if re.search(r'(african-american|black|faith|church|community|civil rights|pastor)', combined):
        inferred.append('African-American Faith Leaders')
    return list(dict.fromkeys(existing + inferred))


def is_navigation_page(title: str, summary: str, source_url: str | None) -> bool:
    haystack = f"{title} {summary} {source_url or ''}".lower()
    if any(term in haystack for term in ['homepage', 'home page', 'index', 'search', 'tag', 'category', 'archive', 'media index', 'latest stories', 'newsroom', 'all stories', 'navigation page']):
        return True
    if source_url:
        parsed = urlparse(source_url)
        path = parsed.path.lower()
        if re.search(r'(^|/)(home|index|search|tag|category|archive|latest|newsroom)(/|$)', path):
            return True
    return False


def is_content_relevant(title: str, summary: str, geography: list[str] | None = None) -> bool:
    combined = f"{title} {summary} {' '.join(geography or [])}".lower()
    return bool(re.search(r'(israel|israeli|jewish|jerusalem|haifa|tel aviv|zion|middle east|u\.s|united states|american|democracy|coexistence|humanitarian|innovation|technology|healthcare|water|sustainability|community|society)', combined))


def is_story_recent_enough(published_at: datetime | None, collected_at: datetime | None, now: datetime | None = None) -> bool:
    reference = published_at or collected_at
    if not reference:
        return True
    if now is None:
        now = datetime.now(timezone.utc)
    age_days = (now - reference).total_seconds() / 86400
    return age_days <= 30


def is_executive_eligible(story: NormalizedStory) -> bool:
    title = normalize_title(story.title)
    summary = normalize_title(story.summary)
    source_url = normalize_url(story.sourceUrl)
    strategic_label = story.strategicRelevanceLabel
    return bool(source_url) and story.evidenceQuality >= 60 and story.relevanceScore >= 60 and strategic_label not in {'low relevance', 'audience risk', 'reputational risk', 'political controversy'} and len(title) >= 8 and len(summary) >= 20 and not is_navigation_page(title, summary, source_url) and is_content_relevant(title, summary, story.geography) and is_story_recent_enough(story.publishedAt, story.collectedAt)


def normalize_geography(value: object) -> list[str]:
    values = value if isinstance(value, list) else ([value] if value else [])
    normalized: list[str] = []
    for item in values:
        text = sanitize_text(item)
        if not text:
            continue
        lowered = text.lower().replace(' ', '')
        alias = STATE_ALIASES.get(lowered) or STATE_ALIASES.get(text.lower())
        normalized.append(alias or text)
    return list(dict.fromkeys(normalized))


def get_demographic_signals(story: NormalizedStory | dict) -> list[dict]:
    geography = normalize_geography(getattr(story, 'geography', None) or story.get('geography', []) if isinstance(story, dict) else getattr(story, 'geography', []))
    signals = []
    for location in geography:
        profile = STATE_DEMOGRAPHIC_PROFILES.get(location.lower())
        if profile:
            signals.append({'state': location, **profile})
    return signals


def get_audience_profiles() -> list[dict]:
    return [dict(profile) for profile in AUDIENCE_PROFILES]


def build_audience_matches(story: NormalizedStory | dict) -> list[AudienceMatch]:
    text = f"{getattr(story, 'title', '')} {getattr(story, 'summary', '')} {' '.join(getattr(story, 'narrativeTags', []) or [])}".lower()
    demographic_signals = get_demographic_signals(story)
    matches = []
    for profile in get_audience_profiles():
        matched_signals = [signal for signal in profile['signals'] if signal.lower() in text]
        shared_value_alignment = sum(1 for value in profile['values'] if value.lower() in text)
        narrative_relevance = min(100, max(0, 30 + len(matched_signals) * 12 + (15 if matched_signals else 0)))
        geographic_relevance = min(100, max(0, 20 + len(demographic_signals) * 10 + (15 if any(geo.lower() in text for geo in profile['geography']) else 0))) if demographic_signals else 20
        demographic_relevance = min(100, max(0, 35 + (sum(signal.get('hispanicShare', 0) for signal in demographic_signals if profile['id'] == 'aud_yh_evang') / 10) + (sum(signal.get('medianIncome', 0) for signal in demographic_signals if profile['id'] == 'aud_health') / 2000))) if demographic_signals else 25
        evidence_quality = getattr(story, 'evidenceQuality', 60) or 60
        score = round((narrative_relevance * 0.35) + (demographic_relevance * 0.25) + (geographic_relevance * 0.15) + ((shared_value_alignment * 15) * 0.15) + (evidence_quality * 0.1))
        confidence = 88 if score >= 75 else 78 if score >= 60 else 66
        matches.append(AudienceMatch(
            audienceId=profile['id'],
            audienceName=profile['name'],
            matchScore=float(score),
            confidence=float(confidence),
            reasons=[f"Matched {', '.join(matched_signals[:3])}." if matched_signals else 'Narrative signals are moderately aligned.'] + (['Aligned with shared values and audience framing.'] if shared_value_alignment else []) + (['Demographic context supports relevance.'] if demographic_signals else []),
            supportingSignals=matched_signals[:5],
            geographicRelevance=float(geographic_relevance),
            demographicRelevance=float(demographic_relevance),
            narrativeRelevance=float(narrative_relevance),
            dataMode='PARTIAL' if demographic_signals else 'RULE_BASED',
            evidenceSources=[*(['demographic_context'] if demographic_signals else []), 'story_text', 'knip_profile'],
            lastUpdated=datetime.now(timezone.utc),
        ))
    return sorted(matches, key=lambda item: item.matchScore, reverse=True)


def normalize_story_item(item: IntelligenceItem | dict, connector_name: str, connector_label: str) -> NormalizedStory:
    source = item.source if isinstance(item, IntelligenceItem) else item.get("source")
    if isinstance(source, dict):
        source_record = SourceRecord(**source)
    else:
        source_record = SourceRecord(
            connector=connector_name,
            source_name=getattr(source, "source_name", None) or getattr(source, "sourceName", None) or connector_label,
            source_url=getattr(source, "source_url", None) or getattr(source, "sourceUrl", None),
            collected_at=getattr(source, "collected_at", None) or datetime.now(timezone.utc),
            reliability=getattr(source, "reliability", 0.7),
            freshness=getattr(source, "freshness", "live"),
            license_note=getattr(source, "license_note", ""),
        )

    title = normalize_title(item.title if isinstance(item, IntelligenceItem) else item.get("title", "Untitled story"))
    summary = normalize_title(item.summary if isinstance(item, IntelligenceItem) else item.get("summary", ""))
    published_at = item.published_at if isinstance(item, IntelligenceItem) else coerce_datetime(item.get("published_at"))
    url = item.url if isinstance(item, IntelligenceItem) else item.get("url")
    geography = [sanitize_text(value) for value in (item.geography if isinstance(item, IntelligenceItem) else item.get("geography", [])) if sanitize_text(value)]
    audiences = list(item.audiences if isinstance(item, IntelligenceItem) else item.get("audiences", []))
    narratives = list(item.narratives if isinstance(item, IntelligenceItem) else item.get("narratives", []))
    confidence = float(item.confidence if isinstance(item, IntelligenceItem) else item.get("confidence", 0.7))

    evidence_quality = min(100, max(0, round((source_record.reliability * 100) * 0.7 + confidence * 100 * 0.3)))
    freshness_score = 90 if source_record.freshness == "live" else 72
    authenticity_score = min(100, max(0, round((0.55 * confidence * 100) + (0.45 * evidence_quality))))
    audience_tags = infer_audience_tags(title, summary, {'audienceTags': audiences})
    strategic_label, strategic_score = classify_strategic_relevance(f"{title} {summary}", audience_tags, narratives)
    audience_relevance = min(100, max(0, round((len(audience_tags) * 12) + (evidence_quality * 0.35))))
    strategic_relevance = min(100, max(0, round(strategic_score + (len(narratives) * 3))))
    source_reliability = min(100, max(0, round(source_record.reliability * 100)))
    relevance_score = round((evidence_quality * 0.25) + (audience_relevance * 0.25) + (strategic_relevance * 0.2) + (freshness_score * 0.15) + (authenticity_score * 0.1) + (source_reliability * 0.05))
    story_payload = NormalizedStory(
        id=item.id if isinstance(item, IntelligenceItem) else item.get("id") or sha256(f"{connector_name}:{title}:{url or ''}".encode()).hexdigest()[:24],
        title=title,
        summary=summary[:900],
        sourceName=sanitize_text(source_record.source_name or connector_label),
        sourceUrl=normalize_url(source_record.source_url or url),
        publishedAt=published_at,
        collectedAt=source_record.collected_at or datetime.now(timezone.utc),
        connector=connector_label,
        geography=geography,
        audienceTags=audience_tags,
        narrativeTags=[sanitize_text(value) for value in narratives if sanitize_text(value)],
        reliability=source_record.reliability,
        confidence=confidence,
        freshness=freshness_score,
        relevanceScore=relevance_score,
        authenticityScore=authenticity_score,
        evidenceQuality=evidence_quality,
        strategicRelevanceLabel=strategic_label,
        strategicRelevanceScore=strategic_relevance,
        sourceReliability=source_reliability,
        eligibleForExecutiveUse=is_executive_eligible(NormalizedStory(
            id=item.id if isinstance(item, IntelligenceItem) else item.get("id") or sha256(f"{connector_name}:{title}:{url or ''}".encode()).hexdigest()[:24],
            title=title,
            summary=summary[:900],
            sourceName=sanitize_text(source_record.source_name or connector_label),
            sourceUrl=normalize_url(source_record.source_url or url),
            publishedAt=published_at,
            collectedAt=source_record.collected_at or datetime.now(timezone.utc),
            connector=connector_label,
            geography=geography,
            audienceTags=audience_tags,
            narrativeTags=[sanitize_text(value) for value in narratives if sanitize_text(value)],
            reliability=source_record.reliability,
            confidence=confidence,
            freshness=freshness_score,
            relevanceScore=relevance_score,
            authenticityScore=authenticity_score,
            evidenceQuality=evidence_quality,
            strategicRelevanceLabel=strategic_label,
            strategicRelevanceScore=strategic_relevance,
            sourceReliability=source_reliability,
            eligibleForExecutiveUse=False,
        )),
        status='VALIDATED' if relevance_score >= 78 else 'REVIEW',
    )
    audience_matches = build_audience_matches(story_payload)
    story_payload.audienceMatches = audience_matches
    story_payload.bestAudienceMatch = audience_matches[0] if audience_matches else None
    story_payload.audienceMatchScore = float(story_payload.bestAudienceMatch.matchScore) if story_payload.bestAudienceMatch else 0.0
    story_payload.audienceDataMode = story_payload.bestAudienceMatch.dataMode if story_payload.bestAudienceMatch else 'RULE_BASED'
    return story_payload


def deduplicate_stories(stories: list[NormalizedStory]) -> list[NormalizedStory]:
    if not stories:
        return []
    deduped: list[NormalizedStory] = []
    for story in sorted(stories, key=lambda item: (-item.relevanceScore, item.title)):
        is_duplicate = False
        for existing in deduped:
            title_key = normalize_title_key(story.title)
            existing_title_key = normalize_title_key(existing.title)
            title_match = bool(title_key and existing_title_key and (title_key == existing_title_key or title_key.startswith(existing_title_key) or existing_title_key.startswith(title_key)))
            title_similarity_score = title_similarity(story.title, existing.title)
            same_url = bool(story.sourceUrl and existing.sourceUrl and story.sourceUrl == existing.sourceUrl)
            same_source_date = bool(story.sourceName and existing.sourceName and story.sourceName.lower() == existing.sourceName.lower() and ((story.publishedAt and existing.publishedAt and story.publishedAt.date() == existing.publishedAt.date()) or (not story.publishedAt and not existing.publishedAt)))
            if same_url or title_match or title_similarity_score >= 0.6 or same_source_date:
                is_duplicate = True
                break
        if is_duplicate:
            continue
        deduped.append(story)
    return deduped


def score_story(story: NormalizedStory) -> NormalizedStory:
    updated = story.model_copy()
    audience_relevance = min(100, max(0, round((len(updated.audienceTags) * 12) + (updated.evidenceQuality * 0.35))))
    strategic_relevance = min(100, max(0, round(updated.strategicRelevanceScore + (len(updated.narrativeTags) * 3))))
    source_reliability = min(100, max(0, round(updated.reliability * 100)))
    updated.relevanceScore = round((updated.evidenceQuality * 0.25) + (audience_relevance * 0.25) + (strategic_relevance * 0.2) + (updated.freshness * 0.15) + (updated.authenticityScore * 0.1) + (source_reliability * 0.05))
    updated.status = 'VALIDATED' if updated.relevanceScore >= 78 else 'REVIEW'
    updated.eligibleForExecutiveUse = is_executive_eligible(updated)
    audience_matches = build_audience_matches(updated)
    updated.audienceMatches = audience_matches
    updated.bestAudienceMatch = audience_matches[0] if audience_matches else None
    updated.audienceMatchScore = float(updated.bestAudienceMatch.matchScore) if updated.bestAudienceMatch else 0.0
    updated.audienceDataMode = updated.bestAudienceMatch.dataMode if updated.bestAudienceMatch else 'RULE_BASED'
    return updated


async def aggregate_story_intelligence(limit: int = 20) -> list[NormalizedStory]:
    payloads = []
    try:
        payloads.append((await gdelt.fetch(query='(Israel OR Israeli) (innovation OR coexistence OR humanitarian OR technology)', limit=limit), 'gdelt-doc', 'GDELT DOC 2.0'))
    except Exception:
        payloads.append(([], 'gdelt-doc', 'GDELT DOC 2.0'))
    try:
        payloads.append((await rss.fetch(feed_url='https://www.timesofisrael.com/feed/', limit=max(3, limit // 2)), 'rss', 'Curated RSS'))
    except Exception:
        payloads.append(([], 'rss', 'Curated RSS'))
    try:
        agent_items = await research_agents.run('story-intelligence', limit=max(3, limit // 3))
        payloads.append((agent_items, 'research-agents', 'KNIP Research Agents'))
    except Exception:
        payloads.append(([], 'research-agents', 'KNIP Research Agents'))

    normalized = []
    for items, connector_name, connector_label in payloads:
        for item in items:
            normalized.append(normalize_story_item(item, connector_name, connector_label))

    scored = [score_story(item) for item in normalized]
    deduped = deduplicate_stories(scored)
    eligible = [item for item in deduped if item.eligibleForExecutiveUse]
    eligible.sort(key=lambda item: (-item.relevanceScore, item.title))
    if eligible:
        return eligible[:limit]
    deduped.sort(key=lambda item: (-item.relevanceScore, item.title))
    return deduped[:limit]


def build_dashboard_payload(stories: list[NormalizedStory] | None = None, live: bool | None = None) -> dict:
    story_list = list(stories or [])
    eligible = [story for story in story_list if getattr(story, 'eligibleForExecutiveUse', False)]
    source = 'LIVE' if live is None and story_list else ('LIVE' if live else 'FALLBACK')
    fallback = not eligible
    priority = eligible[0] if eligible else None
    best_match = priority.bestAudienceMatch if priority else None
    advisory_board, advisory_consensus, minority_opinion, decision_readiness = build_advisory_board(priority, source if not fallback else 'FALLBACK')

    payload = {
        'fallback': fallback,
        'source': source,
        'sourceMode': 'FALLBACK' if fallback else 'LIVE',
        'metrics': {'storiesValidated': {'value': len(eligible) if eligible else len(story_list) or 4, 'trend': source}},
        'priorityDecision': {
            'title': priority.title if priority else 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation',
            'summary': priority.summary if priority else 'A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.',
            'audienceMatch': int(round(priority.audienceMatchScore or 82)) if priority else 82,
            'evidenceQuality': int(priority.evidenceQuality) if priority else 92,
            'strategicImpact': 'High' if priority and priority.relevanceScore >= 80 else 'Medium',
            'strategicImpactScore': int(priority.relevanceScore) if priority else 88,
            'readiness': int(priority.relevanceScore * 0.95) if priority else 96,
            'readinessState': priority.status if priority else 'READY',
            'approvedImpact': 'Potential reach and engagement require human validation before publication.',
            'delayImpact': 'Opportunity freshness declines as the news cycle advances.',
            'sourceUrl': priority.sourceUrl if priority else None,
            'connector': priority.connector if priority else None,
            'bestAudienceName': best_match.audienceName if best_match else 'Moderate Democrats',
            'audienceMatchScore': int(round(best_match.matchScore)) if best_match else 82,
            'audienceConfidence': int(round(best_match.confidence)) if best_match else 78,
            'audienceReasons': best_match.reasons if best_match else ['Fallback audience profile.'],
            'audienceDataMode': best_match.dataMode if best_match else 'RULE_BASED',
        },
        'advisoryBoard': [item.model_dump(mode='json') for item in advisory_board],
        'advisoryConsensus': advisory_consensus.model_dump(mode='json'),
        'minorityOpinion': minority_opinion,
        'decisionReadiness': decision_readiness,
    }
    return payload


def build_audience_intelligence_payload(stories: list[NormalizedStory] | None = None) -> dict:
    story_list = list(stories or [])
    audience_summaries: list[dict] = []
    story_rows: list[dict] = []

    for story in story_list:
        story_rows.append({
            'story': story.model_dump(mode='json'),
            'analysis': None,
            'matches': [match.model_dump(mode='json') for match in story.audienceMatches],
        })

    for audience in get_audience_profiles():
        ranked: list[dict] = []
        for story in story_list:
            match = next((item for item in story.audienceMatches if item.audienceId == audience['id']), None)
            if not match:
                continue
            opportunity = int(round(story.relevanceScore))
            risk = int(round(max(0, min(100, 100 - (story.authenticityScore * 0.35) - (story.evidenceQuality * 0.25)))))
            emotional_fit = int(round(max(0, min(100, (story.authenticityScore * 0.55) + (story.confidence * 45)))))
            credibility_fit = int(round(max(0, min(100, (story.evidenceQuality * 0.7) + (story.sourceReliability * 0.3)))))
            ranked.append({
                'storyId': story.id,
                'storyTitle': story.title,
                'audienceId': match.audienceId,
                'name': audience['name'],
                'description': audience.get('description', ''),
                'match': int(round(match.matchScore)),
                'opportunity': opportunity,
                'risk': risk,
                'thematicFit': int(round(match.narrativeRelevance)),
                'emotionalFit': emotional_fit,
                'credibilityFit': credibility_fit,
                'rationale': match.reasons[0] if match.reasons else 'Moderate fit; additional evidence and audience testing would improve confidence.',
                'reasons': match.reasons,
                'channels': audience.get('channels', []),
                'messengers': audience.get('messengers', []),
                'framing': audience.get('framing', 'Lead with concrete human impact and avoid political abstraction.'),
            })
        ranked.sort(key=lambda item: item['match'], reverse=True)
        average_match = int(round(sum(item['match'] for item in ranked) / len(ranked))) if ranked else 0
        audience_summaries.append({
            **audience,
            'topStories': ranked[:5],
            'averageMatch': average_match,
        })

    return {'audiences': audience_summaries, 'stories': story_rows}


def build_advisory_sessions(stories: list[NormalizedStory] | None = None) -> list[dict]:
    story_list = list(stories or [])
    sessions: list[dict] = []
    for index, story in enumerate(story_list[:5], start=1):
        advisors, consensus, minority_opinion, _decision_readiness = build_advisory_board(story, 'LIVE' if story else 'FALLBACK')
        agreement_label = 'STRONG CONSENSUS' if consensus.agreementCount >= 4 else 'QUALIFIED CONSENSUS' if consensus.agreementCount >= 3 else 'MIXED VIEW'
        recommendation = 'APPROVE WITH CONDITIONS' if consensus.consensusRecommendation in {'APPROVE', 'MODIFY'} else 'HOLD' if consensus.consensusRecommendation in {'DELAY', 'REJECT'} else 'RESEARCH MORE'
        sessions.append({
            'briefId': f'brief_{story.id or f"{index:03d}"}',
            'title': story.title,
            'audience': story.bestAudienceMatch.audienceName if story.bestAudienceMatch else 'Moderate Democrats',
            'advisors': [
                {
                    'name': item.advisorName,
                    'role': item.role,
                    'position': item.recommendation,
                    'assessment': item.reasoning,
                    'confidence': int(round(item.confidence)),
                }
                for item in advisors
            ],
            'consensus': agreement_label,
            'agreements': [
                consensus.majorityReason,
                'The board sees an evidence-backed narrative opportunity worth executive review.',
            ],
            'disagreements': [
                minority_opinion,
                'Advisors place different weight on evidence completeness, timing, and monitoring readiness.',
            ],
            'conditions': list(consensus.unresolvedQuestions[:3]),
            'recommendation': recommendation,
            'confidence': int(round(consensus.consensusConfidence)),
            'executiveQuestion': f'Should KNIP advance “{story.title}” for {story.bestAudienceMatch.audienceName if story.bestAudienceMatch else "Moderate Democrats"}?',
        })
    return sessions


def build_campaign_plans(stories: list[NormalizedStory] | None = None) -> list[dict]:
    story_list = list(stories or [])
    audiences = get_audience_profiles()
    plans: list[dict] = []
    for story in story_list[:5]:
        audience_name = story.bestAudienceMatch.audienceName if story.bestAudienceMatch else 'Moderate Democrats'
        audience = next((item for item in audiences if item['name'] == audience_name), None) or {}
        confidence = int(round((story.relevanceScore + story.evidenceQuality + (story.bestAudienceMatch.confidence if story.bestAudienceMatch else 78)) / 3))
        objective = 'Change perceptions' if confidence >= 88 else 'Build trust' if confidence >= 78 else 'Increase awareness'
        priority = 'IMMEDIATE' if confidence >= 90 else 'HIGH' if confidence >= 82 else 'NORMAL'
        recommendation = 'PROCEED' if confidence >= 88 else 'PROCEED_WITH_REVISIONS' if confidence >= 75 else 'HOLD'
        budget = 'MEDIUM' if confidence >= 90 else 'SMALL'
        channels = audience.get('channels', ['Instagram', 'Partner newsletters'])
        messengers = audience.get('messengers', ['Field practitioners'])
        complexity = 'COMPLEX' if len(channels) > 3 else 'MEDIUM'
        plans.append({
            'id': f'campaign_{story.id}',
            'briefId': f'brief_{story.id}',
            'storyId': story.id,
            'title': story.title,
            'audience': audience_name,
            'status': 'DRAFT',
            'durationWeeks': 4,
            'confidence': confidence,
            'objective': objective,
            'priority': priority,
            'budget': budget,
            'complexity': complexity,
            'framing': audience.get('framing', 'Lead with authentic human impact, shared values, and measurable outcomes.'),
            'channels': channels,
            'messengers': messengers,
            'coreMessages': ['Lead with the people affected', 'Show measurable outcomes', 'Mention Israel after the human benefit'],
            'assets': ['60-second video', 'Infographic', 'Human-interest article', 'Social media carousel'],
            'cta': 'Learn how practical Israeli innovation is improving lives.',
            'kpis': ['Reach', 'Engagement', 'Positive sentiment', 'Click-through rate'],
            'dependencies': ['Confirm one additional independent outcome source', 'Secure participant permissions', 'Prepare audience-specific creative assets'],
            'ruby': {
                'name': 'Ruby',
                'role': 'Chief Strategy Officer',
                'recommendation': recommendation,
                'confidence': confidence,
                'objective': objective,
                'priority': priority,
                'budget': budget,
                'complexity': complexity,
                'narrative': 'Human Story',
                'summary': f'Position this as a {objective.lower()} campaign. Lead with the beneficiaries, mention Israel second, avoid political framing, and emphasize verified human impact.',
                'strengths': ['Strong human-interest angle', 'Clear audience relevance', 'Practical and measurable benefit'],
                'risks': ['Avoid promotional tone', 'Verify all outcome claims'],
                'why': f'This recommendation reflects {confidence}% decision confidence, the selected audience profile, evidence quality, and execution feasibility.',
            },
        })
    return plans


def _priority_from_score(score: int) -> str:
    if score >= 88:
        return 'HIGH'
    if score >= 78:
        return 'MEDIUM'
    return 'NORMAL'


def _recommendation_from_score(score: int) -> str:
    if score >= 88:
        return 'APPROVE'
    if score >= 72:
        return 'RESEARCH'
    return 'HOLD'


def _build_explainability(story: NormalizedStory, confidence: int, audience_confidence: int) -> dict:
    evidence_strength = int(round(story.evidenceQuality))
    audience_alignment = int(round(story.audienceMatchScore or 78))
    strategic_value = int(round(story.relevanceScore))
    operational_readiness = int(round((confidence * 0.6) + (story.authenticityScore * 0.4)))
    return {
        'drivers': [
            {'label': 'Human impact', 'value': int(round(story.authenticityScore))},
            {'label': 'Audience alignment', 'value': audience_alignment},
            {'label': 'Strategic value', 'value': strategic_value},
            {'label': 'Evidence strength', 'value': evidence_strength},
            {'label': 'Operational readiness', 'value': operational_readiness},
        ],
        'why': 'The recommendation is driven by audience relevance, strategic impact, and evidence reliability with human oversight still required before publication.',
        'conditions': [
            'Verify at least one independent outcome source before public activation.',
            'Confirm beneficiary consent for any public-facing testimonials.',
            'Complete final framing review to keep the human beneficiary at the center.',
        ],
    }


def build_decision_briefs(stories: list[NormalizedStory] | None = None) -> list[dict]:
    story_list = list(stories or [])
    briefs: list[dict] = []
    now = datetime.now(timezone.utc)

    if not story_list:
        return [{
            'id': 'brief_001',
            'storyId': 'story_001',
            'priority': 'HIGH',
            'title': 'Israeli water technology helps drought-affected farmers',
            'audience': 'Sustainability Leaders',
            'recommendation': 'APPROVE',
            'confidence': 90,
            'status': 'AWAITING_DECISION',
            'owner': 'Ethan Kushner',
            'dueDate': (now + timedelta(days=3)).date().isoformat(),
            'executiveSummary': 'A credible human-impact story connects practical innovation with climate resilience and beneficiary outcomes.',
            'strategicAssessment': 'The story is operationally feasible and aligns with sustainability audiences when framed around measurable human impact.',
            'opportunities': [
                'Strong alignment with climate resilience audiences.',
                'Clear beneficiary-centered narrative for executive use.',
                'Campaign-ready across digital and partner channels.',
            ],
            'risks': [
                'Quantitative outcomes require independent verification.',
                'Framing should avoid promotional tone.',
                'Permissions must be reconfirmed before publication.',
            ],
            'evidence': [
                {
                    'title': 'Representative field testimony',
                    'claim': 'Beneficiaries reported improved resilience and practical agricultural outcomes.',
                    'reliability': 82,
                }
            ],
            'advisors': [
                {
                    'name': 'Shani',
                    'role': 'Chief Knowledge Officer',
                    'position': 'ADVANCE',
                    'confidence': 88,
                    'assessment': 'Evidence is decision-grade with one additional source recommended before broad amplification.',
                },
                {
                    'name': 'Ruby',
                    'role': 'Chief Strategy Officer',
                    'position': 'APPROVE',
                    'confidence': 92,
                    'assessment': 'Audience relevance and strategic timing support advancement with safeguards.',
                },
                {
                    'name': 'Amit',
                    'role': 'Chief Operations Officer',
                    'position': 'READY_WITH_CONDITIONS',
                    'confidence': 85,
                    'assessment': 'Execution is feasible as a pilot once consent and measurement checks are complete.',
                },
                {
                    'name': 'CTA',
                    'role': 'Technology & Explainability',
                    'position': 'RELIABLE',
                    'confidence': 86,
                    'assessment': 'Recommendation confidence is supported by explainable audience and evidence signals.',
                },
            ],
            'explainability': {
                'drivers': [
                    {'label': 'Human impact', 'value': 92},
                    {'label': 'Audience alignment', 'value': 90},
                    {'label': 'Strategic value', 'value': 88},
                    {'label': 'Evidence strength', 'value': 82},
                    {'label': 'Operational readiness', 'value': 84},
                ],
                'why': 'The recommendation is driven by high audience fit, measurable human impact, and decision-grade evidence quality.',
                'conditions': [
                    'Verify one independent quantitative outcome source.',
                    'Confirm informed consent for public-facing testimony.',
                    'Finalize beneficiary-first framing before publication.',
                ],
            },
            'history': [
                {
                    'at': now.isoformat(),
                    'actor': 'System',
                    'action': 'Brief moved to Awaiting Decision',
                }
            ],
        }]

    for index, story in enumerate(story_list[:5], start=1):
        advisors, _consensus, _minority_opinion, _decision_readiness = build_advisory_board(story, 'LIVE' if story else 'FALLBACK')
        confidence = int(round((story.relevanceScore + story.evidenceQuality + (story.bestAudienceMatch.confidence if story.bestAudienceMatch else 78)) / 3))
        recommendation = _recommendation_from_score(confidence)
        priority = _priority_from_score(confidence)
        due_date = (now + timedelta(days=index + 2)).date().isoformat()
        audience_name = story.bestAudienceMatch.audienceName if story.bestAudienceMatch else 'Moderate Democrats'
        audience_confidence = int(round(story.bestAudienceMatch.confidence)) if story.bestAudienceMatch else 78

        brief = {
            'id': f'brief_{story.id}',
            'storyId': story.id,
            'priority': priority,
            'title': story.title,
            'audience': audience_name,
            'recommendation': recommendation,
            'confidence': confidence,
            'status': 'AWAITING_DECISION',
            'owner': 'Ethan Kushner',
            'dueDate': due_date,
            'executiveSummary': story.summary,
            'strategicAssessment': f'This story carries {story.strategicRelevanceLabel} relevance with a measurable audience-fit signal and explainable evidence quality.',
            'opportunities': [
                f'Best-fit audience: {audience_name}.',
                'Human-centered framing enables nonpartisan engagement.',
                'The narrative can be activated through a phased campaign pilot.',
            ],
            'risks': [
                'Outcome claims require one additional independent source.',
                'Framing must avoid promotional tone and preserve beneficiary agency.',
                'Execution should include explicit monitoring during first release window.',
            ],
            'evidence': [
                {
                    'title': story.sourceName or 'Supporting evidence',
                    'claim': story.summary,
                    'reliability': int(round(story.evidenceQuality)),
                }
            ],
            'advisors': [
                {
                    'name': item.advisorName,
                    'role': item.role,
                    'position': item.recommendation,
                    'confidence': int(round(item.confidence)),
                    'assessment': item.reasoning,
                }
                for item in advisors
            ],
            'explainability': _build_explainability(story, confidence, audience_confidence),
            'history': [
                {
                    'at': now.isoformat(),
                    'actor': 'System',
                    'action': 'Brief moved to Awaiting Decision',
                }
            ],
        }
        briefs.append(brief)

    return briefs


def _status_for_action(action: str) -> str:
    if action == 'APPROVE':
        return 'APPROVED'
    if action == 'REJECT':
        return 'REJECTED'
    if action == 'RESEARCH':
        return 'RESEARCH_REQUESTED'
    if action == 'ESCALATE':
        return 'ESCALATED'
    return 'ARCHIVED'


def _default_learning_record(brief: dict) -> dict:
    advisor_recommendations = {
        item.get('name', 'Advisor'): item.get('position', 'RESEARCH')
        for item in brief.get('advisors', [])
    }
    return {
        'id': f"learning_{brief['id']}",
        'briefId': brief['id'],
        'storyId': brief['storyId'],
        'storyTitle': brief['title'],
        'decision': 'PENDING',
        'decisionMaker': 'Pending',
        'advisorRecommendations': advisor_recommendations,
        'outcome': 'PENDING',
        'lessonsLearned': '',
        'decisionDate': None,
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'patterns': [],
        'insights': [],
        'campaignMetrics': None,
    }


def _sync_decision_cache(briefs: list[dict]) -> list[dict]:
    synced: list[dict] = []
    for brief in briefs:
        cached = _DECISION_BRIEF_CACHE.get(brief['id'])
        synced.append(cached if cached else brief)
    _DECISION_BRIEF_CACHE.clear()
    _DECISION_BRIEF_CACHE.update({item['id']: item for item in synced})
    return synced


def _ensure_learning_records(briefs: list[dict]) -> None:
    for brief in briefs:
        if brief['id'] not in _LEARNING_RECORD_CACHE:
            _LEARNING_RECORD_CACHE[brief['id']] = _default_learning_record(brief)


def _find_learning_record(learning_id: str) -> dict | None:
    if learning_id in _LEARNING_RECORD_CACHE:
        return _LEARNING_RECORD_CACHE[learning_id]
    return next((item for item in _LEARNING_RECORD_CACHE.values() if item.get('id') == learning_id), None)


def build_learning_intelligence(records: list[dict]) -> dict:
    completed = [item for item in records if item.get('outcome') and item.get('outcome') != 'PENDING']
    successful = [item for item in completed if item.get('outcome') == 'SUCCESS']
    partial = [item for item in completed if item.get('outcome') == 'PARTIAL']
    success_rate = 0
    if completed:
        success_rate = int(round(((len(successful) + (len(partial) * 0.5)) / len(completed)) * 100))

    pattern_counts: dict[str, int] = {}
    for item in records:
        patterns = item.get('patterns') if isinstance(item.get('patterns'), list) else []
        for pattern in patterns:
            label = sanitize_text(pattern)
            if label:
                pattern_counts[label] = pattern_counts.get(label, 0) + 1

    reusable_patterns = [
        {'label': label, 'count': count}
        for label, count in sorted(pattern_counts.items(), key=lambda pair: pair[1], reverse=True)
    ]

    insights: list[dict] = []
    for item in records:
        for insight in item.get('insights', []) if isinstance(item.get('insights'), list) else []:
            cleaned = sanitize_text(insight)
            if cleaned:
                insights.append({'id': f"insight_{len(insights)}", 'text': cleaned})

    return {
        'metrics': {
            'totalDecisions': len(records),
            'completedCampaigns': len(completed),
            'successRate': success_rate,
            'lessonsCaptured': len([item for item in records if sanitize_text(item.get('lessonsLearned', ''))]),
            'reusablePatterns': len(reusable_patterns),
        },
        'reusablePatterns': reusable_patterns,
        'insights': insights[:8],
        'records': records,
    }


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.2.0-rc2", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/dashboard")
async def dashboard() -> dict:
    return await dashboard_service.get_dashboard()


@app.get("/api/connectors")
async def connectors() -> dict:
    statuses = await asyncio.gather(gdelt.health(), census.health(), rss.health())
    return {"connectors": [item.model_dump(mode="json") for item in statuses]}


@app.get("/api/stories")
async def stories(q: str = Query(default='Israel innovation OR "Israeli technology"'), limit: int = Query(default=20, ge=1, le=100)) -> dict:
    normalized = await aggregate_story_intelligence(limit=limit)
    return {"count": len(normalized), "items": [item.model_dump(mode="json") for item in normalized]}


@app.get("/api/audiences")
async def audiences() -> dict:
    return {"audiences": get_audience_profiles()}


@app.get("/api/audiences/{audience_id}")
async def audience_detail(audience_id: str) -> dict:
    audience = next((item for item in get_audience_profiles() if item['id'] == audience_id), None)
    if not audience:
        raise HTTPException(status_code=404, detail="Audience not found")
    return {"audience": audience}


@app.get("/api/audience-intelligence")
async def audience_intelligence() -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    return build_audience_intelligence_payload(stories)


@app.get("/api/stories/{story_id}/audiences")
async def story_audiences(story_id: str) -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    story = next((item for item in stories if item.id == story_id), None)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return {"storyId": story_id, "audienceMatches": [match.model_dump(mode="json") for match in story.audienceMatches], "bestAudienceMatch": story.bestAudienceMatch.model_dump(mode="json") if story.bestAudienceMatch else None, "audienceDataMode": story.audienceDataMode}


@app.get("/api/advisory-board")
async def advisory_board() -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    priority = stories[0] if stories else None
    board, consensus, minority_opinion, decision_readiness = build_advisory_board(priority, 'LIVE' if priority else 'FALLBACK')
    sessions = build_advisory_sessions(stories)
    _ADVISORY_SESSION_CACHE.clear()
    _ADVISORY_SESSION_CACHE.update(
        {session["briefId"]: session for session in sessions}
    )
    return {
        "advisoryBoard": [item.model_dump(mode='json') for item in board],
        "advisoryConsensus": consensus.model_dump(mode='json'),
        "minorityOpinion": minority_opinion,
        "decisionReadiness": decision_readiness,
        "sourceMode": consensus.sourceMode,
        "sessions": sessions,
    }


@app.get("/api/advisory-board/consensus")
async def advisory_board_consensus() -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    priority = stories[0] if stories else None
    _, consensus, minority_opinion, decision_readiness = build_advisory_board(priority, 'LIVE' if priority else 'FALLBACK')
    return {
        "consensus": consensus.model_dump(mode='json'),
        "minorityOpinion": minority_opinion,
        "decisionReadiness": decision_readiness,
    }


@app.post("/api/advisory-board/challenge")
async def advisory_board_challenge(payload: dict) -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    priority = stories[0] if stories else None
    challenge = payload.get('challenge', '') if isinstance(payload, dict) else ''
    return challenge_advisory_board(challenge, priority, 'LIVE' if priority else 'FALLBACK')


@app.get("/api/advisory-board/{brief_id}")
async def advisory_board_detail(brief_id: str) -> dict:
    session = _ADVISORY_SESSION_CACHE.get(brief_id)
    if not session:
        stories = await aggregate_story_intelligence(limit=20)
        sessions = build_advisory_sessions(stories)
        session = next((item for item in sessions if item['briefId'] == brief_id), None)
    if not session:
        raise HTTPException(status_code=404, detail="Advisory session not found")
    return {"session": session}


@app.get("/api/campaign-plans")
async def campaign_plans() -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    plans = build_campaign_plans(stories)
    _CAMPAIGN_PLAN_CACHE.clear()
    _CAMPAIGN_PLAN_CACHE.update({plan["id"]: plan for plan in plans})
    return {"campaignPlans": plans}


@app.get("/api/campaign-plans/{plan_id}")
async def campaign_plan_detail(plan_id: str) -> dict:
    campaign_plan = _CAMPAIGN_PLAN_CACHE.get(plan_id)
    if not campaign_plan:
        stories = await aggregate_story_intelligence(limit=20)
        campaign_plans = build_campaign_plans(stories)
        campaign_plan = next((item for item in campaign_plans if item["id"] == plan_id), None)
    if not campaign_plan:
        raise HTTPException(status_code=404, detail="Campaign plan not found")
    return {"campaignPlan": campaign_plan}


@app.get('/api/decisions')
async def decisions() -> dict:
    stories = await aggregate_story_intelligence(limit=20)
    decision_briefs = _sync_decision_cache(build_decision_briefs(stories))
    _ensure_learning_records(decision_briefs)
    return {'decisionBriefs': decision_briefs, 'executiveDecisions': _EXECUTIVE_DECISIONS}


@app.get('/api/decisions/{decision_id}')
async def decision_detail(decision_id: str) -> dict:
    brief = _DECISION_BRIEF_CACHE.get(decision_id)
    if not brief:
        stories = await aggregate_story_intelligence(limit=20)
        refreshed = _sync_decision_cache(build_decision_briefs(stories))
        _ensure_learning_records(refreshed)
        brief = _DECISION_BRIEF_CACHE.get(decision_id)
    if not brief:
        raise HTTPException(status_code=404, detail='Decision brief not found')
    decisions = [item for item in _EXECUTIVE_DECISIONS if item.get('briefId') == decision_id]
    return {'brief': brief, 'decisions': decisions}


@app.post('/api/decisions/{decision_id}/actions')
async def decision_action(decision_id: str, payload: dict) -> dict:
    brief = _DECISION_BRIEF_CACHE.get(decision_id)
    if not brief:
        stories = await aggregate_story_intelligence(limit=20)
        refreshed = _sync_decision_cache(build_decision_briefs(stories))
        _ensure_learning_records(refreshed)
        brief = _DECISION_BRIEF_CACHE.get(decision_id)
    if not brief:
        raise HTTPException(status_code=404, detail='Decision brief not found')

    action = sanitize_text(payload.get('action') if isinstance(payload, dict) else '').upper()
    if action not in {'APPROVE', 'REJECT', 'RESEARCH', 'ESCALATE', 'ARCHIVE'}:
        raise HTTPException(status_code=400, detail='A valid decision action is required')

    note = sanitize_text(payload.get('note') if isinstance(payload, dict) else '')
    now = datetime.now(timezone.utc).isoformat()
    decision = {
        'id': f"decision_{sha256(f'{decision_id}:{now}:{action}'.encode()).hexdigest()[:12]}",
        'briefId': brief['id'],
        'storyId': brief.get('storyId'),
        'action': action,
        'note': note,
        'actorId': 'usr_admin',
        'createdAt': now,
    }
    _EXECUTIVE_DECISIONS.insert(0, decision)

    admin_profile_id = get_admin_profile_id()
    supabase = get_supabase_admin_client()
    normalized_priority = {
        "CRITICAL": "high",
        "HIGH": "high",
        "NORMAL": "medium",
        "MEDIUM": "medium",
        "LOW": "low",
    }.get(sanitize_text(brief.get("priority")).upper(), "medium")
    normalized_status = {
        "AWAITING_DECISION": "draft",
        "APPROVED": "approved",
        "REJECTED": "rejected",
        "RESEARCH": "research",
        "ESCALATED": "escalated",
        "ARCHIVED": "archived",
    }.get(sanitize_text(brief.get("status")).upper(), "draft")

    persisted = (
        supabase.table("decisions")
        .insert({
            "title": brief.get("title") or f"Decision for {brief['id']}",
            "summary": brief.get("summary"),
            "status": normalized_status,
            "priority": normalized_priority,
            "audience_id": brief.get("audienceId"),
            "audience_name": brief.get("audienceName"),
            "story_id": brief.get("storyId"),
            "recommendation": action,
            "rationale": note or None,
            "expected_impact": brief.get("expectedImpact"),
            "confidence_score": brief.get("confidence"),
            "decision_data": decision,
            "created_by": admin_profile_id,
            "updated_by": admin_profile_id,
            "decided_by": admin_profile_id,
            "decided_at": now,
        })
        .execute()
    )

    rows = persisted.data or []
    decision_database_id = None
    if rows:
        decision_database_id = str(rows[0]["id"])
        decision["databaseId"] = decision_database_id
    brief['status'] = _status_for_action(action)
    brief.setdefault('history', [])
    brief['history'].insert(0, {
        'at': now,
        'actor': 'Ethan Kushner',
        'action': f"Executive decision: {action}{f' - {note}' if note else ''}",
    })

    learning_record = _LEARNING_RECORD_CACHE.get(brief['id'])
    if not learning_record:
        learning_record = _default_learning_record(brief)
        _LEARNING_RECORD_CACHE[brief['id']] = learning_record

    advisor_recommendations = {
        item.get('name', 'Advisor'): item.get('position', 'RESEARCH')
        for item in brief.get('advisors', [])
    }
    learning_record['decision'] = action
    learning_record['decisionMaker'] = 'Ethan Kushner'
    learning_record['advisorRecommendations'] = advisor_recommendations
    learning_record['decisionDate'] = now
    learning_record['updatedAt'] = now

    if decision_database_id:
        learning_payload = {
            "decision_id": decision_database_id,
            "title": brief.get("title") or "Learning record",
            "outcome": action,
            "lessons_learned": learning_record.get("lessonsLearned") or "",
            "what_worked": learning_record.get("whatWorked") or "",
            "what_did_not_work": learning_record.get("whatDidNotWork") or "",
            "evidence": learning_record.get("evidence") or [],
            "metrics": learning_record.get("metrics") or {},
            "learning_data": learning_record,
            "created_by": admin_profile_id,
            "updated_by": admin_profile_id,
        }
        existing_learning = (
            supabase.table("learning_records")
            .select("id")
            .eq("decision_id", decision_database_id)
            .limit(1)
            .execute()
        )
        existing_learning_rows = existing_learning.data or []
        if existing_learning_rows:
            learning_persisted = (
                supabase.table("learning_records")
                .update(learning_payload)
                .eq("id", existing_learning_rows[0]["id"])
                .execute()
            )
        else:
            learning_persisted = (
                supabase.table("learning_records")
                .insert(learning_payload)
                .execute()
            )
        learning_rows = learning_persisted.data or []
        if learning_rows:
            learning_record["databaseId"] = str(learning_rows[0]["id"])
        elif existing_learning_rows:
            learning_record["databaseId"] = str(existing_learning_rows[0]["id"])

    return {'decision': decision, 'brief': brief, 'learningRecord': learning_record}


@app.get('/api/learning/{learning_id}')
async def learning_detail(learning_id: str) -> dict:
    if not _DECISION_BRIEF_CACHE:
        stories = await aggregate_story_intelligence(limit=20)
        decision_briefs = _sync_decision_cache(build_decision_briefs(stories))
        _ensure_learning_records(decision_briefs)

    learning_record = _find_learning_record(learning_id)
    if not learning_record:
        raise HTTPException(status_code=404, detail='Learning record not found')
    return {'learningRecord': learning_record}


@app.put('/api/learning/{learning_id}')
async def learning_update(learning_id: str, payload: dict) -> dict:
    if not _DECISION_BRIEF_CACHE:
        stories = await aggregate_story_intelligence(limit=20)
        decision_briefs = _sync_decision_cache(build_decision_briefs(stories))
        _ensure_learning_records(decision_briefs)

    learning_record = _find_learning_record(learning_id)
    if not learning_record:
        brief = _DECISION_BRIEF_CACHE.get(learning_id)
        if not brief:
            raise HTTPException(status_code=404, detail='Learning record not found')
        learning_record = _default_learning_record(brief)
        _LEARNING_RECORD_CACHE[brief['id']] = learning_record

    if isinstance(payload, dict) and 'outcome' in payload:
        outcome = sanitize_text(payload.get('outcome', '')).upper() or 'PENDING'
        learning_record['outcome'] = outcome
    if isinstance(payload, dict) and 'lessonsLearned' in payload:
        learning_record['lessonsLearned'] = sanitize_text(payload.get('lessonsLearned', ''))
    learning_record['updatedAt'] = datetime.now(timezone.utc).isoformat()

    return {'learningRecord': learning_record}


@app.get('/api/learning-intelligence')
async def learning_intelligence() -> dict:
    if not _DECISION_BRIEF_CACHE:
        stories = await aggregate_story_intelligence(limit=20)
        decision_briefs = _sync_decision_cache(build_decision_briefs(stories))
        _ensure_learning_records(decision_briefs)
    records = list(_LEARNING_RECORD_CACHE.values())
    return {'intelligence': build_learning_intelligence(records)}


@app.get("/api/demographics/states")
async def state_demographics(year: int = 2024) -> dict:
    items = await census.fetch(year=year, geography="state:*", limit=60)
    return {"count": len(items), "items": [item.model_dump(mode="json") for item in items]}


@app.get("/api/rss")
async def rss_items(feed_url: str, limit: int = Query(default=10, ge=1, le=50)) -> dict:
    items = await rss.fetch(feed_url=feed_url, limit=limit)
    return {"count": len(items), "items": [item.model_dump(mode="json") for item in items]}


@app.get("/api/research-agents")
async def list_research_agents() -> dict:
    definitions = research_agents.definitions()
    return {"count": len(definitions), "items": [item.model_dump(mode="json") for item in definitions]}


@app.post("/api/research-agents/{agent_id}/run")
async def run_research_agent(agent_id: str, limit: int = Query(default=20, ge=1, le=100)) -> dict:
    try:
        definition = research_agents.definition(agent_id)
        items = await research_agents.run(agent_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Research agent not found") from exc
    return {
        "agent": definition.model_dump(mode="json"),
        "count": len(items),
        "items": [item.model_dump(mode="json") for item in items],
    }
@app.get("/api/supabase-health")
async def supabase_health() -> dict:
    from app.supabase_client import get_supabase_admin_client

    try:
        client = get_supabase_admin_client()
        response = client.table("profiles").select("id").limit(1).execute()

        return {
            "status": "ok",
            "supabase": "connected",
            "profiles_checked": len(response.data or []),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Supabase connection failed: {exc}",
        ) from exc


# Hosted-beta static frontend
from pathlib import Path
from fastapi.staticfiles import StaticFiles

_STATIC_DIR = Path("/app/static")
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="frontend")

