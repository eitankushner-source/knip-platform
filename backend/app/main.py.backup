from datetime import datetime, timezone
import asyncio

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.connectors.census import CensusConnector
from app.connectors.gdelt import GdeltConnector
from app.connectors.research_agents import ResearchAgentConnector
from app.connectors.rss import RssConnector
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
    items = await gdelt.fetch(query=q, limit=limit)
    return {"count": len(items), "items": [item.model_dump(mode="json") for item in items]}


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
