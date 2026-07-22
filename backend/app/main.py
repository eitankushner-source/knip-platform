from datetime import datetime, timezone
import asyncio
import re
from html import unescape
from hashlib import sha256
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.connectors.census import CensusConnector
from app.connectors.gdelt import GdeltConnector
from app.connectors.research_agents import ResearchAgentConnector
from app.connectors.rss import RssConnector
from app.models import IntelligenceItem, NormalizedStory, SourceRecord
from app.services.dashboard import DashboardService

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.2.0-rc2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

dashboard_service = DashboardService()
gdelt = GdeltConnector()
census = CensusConnector()
rss = RssConnector()
research_agents = ResearchAgentConnector()


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
    text = html.unescape(text)
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

    return NormalizedStory(
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
    if not eligible:
        return {
            'fallback': True,
            'source': source,
            'sourceMode': 'FALLBACK',
            'metrics': {'storiesValidated': {'value': len(story_list) or 4, 'trend': 'FALLBACK'}},
            'priorityDecision': {
                'title': 'Amplify Story: Kenyan Farmers Using Israeli Water Innovation',
                'summary': 'A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.',
                'audienceMatch': 82,
                'evidenceQuality': 92,
                'strategicImpact': 'High',
                'strategicImpactScore': 88,
                'readiness': 96,
                'readinessState': 'READY',
                'approvedImpact': 'Potential reach and engagement require human validation before publication.',
                'delayImpact': 'Opportunity freshness declines as the news cycle advances.',
                'sourceUrl': None,
                'connector': None,
            },
        }

    priority = eligible[0]
    return {
        'fallback': False,
        'source': source,
        'sourceMode': 'LIVE',
        'metrics': {'storiesValidated': {'value': len(eligible), 'trend': source}},
        'priorityDecision': {
            'title': priority.title,
            'summary': priority.summary,
            'audienceMatch': min(99, max(70, int(priority.relevanceScore * 0.9))),
            'evidenceQuality': int(priority.evidenceQuality),
            'strategicImpact': 'High' if priority.relevanceScore >= 80 else 'Medium',
            'strategicImpactScore': int(priority.relevanceScore),
            'readiness': int(priority.relevanceScore * 0.95),
            'readinessState': priority.status,
            'approvedImpact': 'Potential reach and engagement require human validation before publication.',
            'delayImpact': 'Opportunity freshness declines as the news cycle advances.',
            'sourceUrl': priority.sourceUrl,
            'connector': priority.connector,
        },
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
