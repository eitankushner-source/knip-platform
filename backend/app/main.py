from datetime import datetime, timezone
import asyncio
import re
from hashlib import sha256

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

    title = item.title if isinstance(item, IntelligenceItem) else item.get("title", "Untitled story")
    summary = item.summary if isinstance(item, IntelligenceItem) else item.get("summary", "")
    published_at = item.published_at if isinstance(item, IntelligenceItem) else coerce_datetime(item.get("published_at"))
    url = item.url if isinstance(item, IntelligenceItem) else item.get("url")
    geography = list(item.geography if isinstance(item, IntelligenceItem) else item.get("geography", []))
    audiences = list(item.audiences if isinstance(item, IntelligenceItem) else item.get("audiences", []))
    narratives = list(item.narratives if isinstance(item, IntelligenceItem) else item.get("narratives", []))
    confidence = float(item.confidence if isinstance(item, IntelligenceItem) else item.get("confidence", 0.7))

    evidence_quality = min(100, max(0, round((source_record.reliability * 100) * 0.7 + confidence * 100 * 0.3)))
    freshness_score = 90 if source_record.freshness == "live" else 72
    authenticity_score = min(100, max(0, round((0.55 * confidence * 100) + (0.45 * evidence_quality))))
    audience_relevance = min(100, max(0, round(0.6 * (len(audiences) * 20) + 0.4 * (evidence_quality))))
    strategic_relevance = min(100, max(0, round(0.55 * (len(narratives) * 18) + 0.45 * (evidence_quality + 10))))
    relevance_score = round((evidence_quality * 0.3) + (audience_relevance * 0.25) + (freshness_score * 0.2) + (authenticity_score * 0.15) + (strategic_relevance * 0.1))

    return NormalizedStory(
        id=item.id if isinstance(item, IntelligenceItem) else item.get("id") or sha256(f"{connector_name}:{title}:{url or ''}".encode()).hexdigest()[:24],
        title=title,
        summary=summary[:900],
        sourceName=source_record.source_name or connector_label,
        sourceUrl=source_record.source_url or url,
        publishedAt=published_at,
        collectedAt=source_record.collected_at or datetime.now(timezone.utc),
        connector=connector_label,
        geography=geography,
        audienceTags=audiences,
        narrativeTags=narratives,
        reliability=source_record.reliability,
        confidence=confidence,
        freshness=freshness_score,
        relevanceScore=relevance_score,
        authenticityScore=authenticity_score,
        evidenceQuality=evidence_quality,
        status='VALIDATED' if relevance_score >= 78 else 'REVIEW',
    )


def deduplicate_stories(stories: list[NormalizedStory]) -> list[NormalizedStory]:
    if not stories:
        return []
    deduped: list[NormalizedStory] = []
    seen: set[str] = set()
    for story in sorted(stories, key=lambda item: (-item.relevanceScore, item.title)):
        signature = []
        if story.sourceUrl:
            signature.append(('url', story.sourceUrl))
        title_key = re.sub(r'[^a-z0-9]+', ' ', story.title.lower()).strip()
        if title_key:
            signature.append(('title', title_key))
        if story.publishedAt:
            signature.append(('date', story.publishedAt.date().isoformat()))
        if story.sourceName:
            signature.append(('source', story.sourceName.lower()))
        key = '|'.join(f'{k}:{v}' for k, v in signature)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(story)
    return deduped


def score_story(story: NormalizedStory) -> NormalizedStory:
    updated = story.model_copy()
    updated.relevanceScore = round((updated.evidenceQuality * 0.3) + (min(100, max(0, round(0.5 * len(updated.audienceTags) * 20 + 0.5 * updated.evidenceQuality))) * 0.25) + (updated.freshness * 0.2) + (updated.authenticityScore * 0.15) + (min(100, max(0, round(0.5 * len(updated.narrativeTags) * 18 + 0.5 * updated.evidenceQuality + 10))) * 0.1))
    updated.status = 'VALIDATED' if updated.relevanceScore >= 78 else 'REVIEW'
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
    deduped.sort(key=lambda item: (-item.relevanceScore, item.title))
    return deduped[:limit]


def build_dashboard_payload(stories: list[NormalizedStory] | None = None, live: bool | None = None) -> dict:
    story_list = list(stories or [])
    source = 'LIVE' if live is None and story_list else ('LIVE' if live else 'FALLBACK')
    if not story_list:
        return {
            'fallback': True,
            'source': source,
            'metrics': {'storiesValidated': {'value': 4, 'trend': 'FALLBACK'}},
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

    priority = story_list[0]
    return {
        'fallback': False,
        'source': source,
        'metrics': {'storiesValidated': {'value': len(story_list), 'trend': source}},
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
