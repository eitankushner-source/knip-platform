from datetime import datetime, timezone
import asyncio

from app.connectors.gdelt import GdeltConnector
from app.connectors.research_agents import ResearchAgentConnector


class DashboardService:
    def __init__(self) -> None:
        self.gdelt = GdeltConnector()
        self.research_agents = ResearchAgentConnector()

    async def get_dashboard(self) -> dict:
        source = "live connector layer"
        stories = []
        try:
            stories = await self.gdelt.fetch(
                query='(Israel OR Israeli) (innovation OR coexistence OR humanitarian OR technology)',
                limit=25,
            )
        except Exception:
            source = "RC2 resilient fallback — live connector unavailable"

        story_count = len(stories) if stories else 4
        priority = stories[0] if stories else None
        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "lastLogin": "Previous session",
            "metrics": {
                "storiesValidated": {"value": story_count, "trend": "LIVE" if stories else "FALLBACK"},
                "campaignsCompleted": {"value": 2, "trend": "MVP"},
                "narrativesEmerging": {"value": min(7, max(1, story_count // 4)), "trend": "LIVE" if stories else "DEMO"},
                "audienceSentiment": {"value": "+4%", "trend": "BASELINE"},
            },
            "priorityDecision": {
                "title": priority.title if priority else "Amplify Story: Kenyan Farmers Using Israeli Water Innovation",
                "summary": priority.summary if priority else "A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.",
                "audienceMatch": 94,
                "evidenceQuality": round((priority.confidence if priority else 0.92) * 100),
                "strategicImpact": "High",
                "strategicImpactScore": 88,
                "readiness": 82 if priority else 96,
                "readinessState": "REVIEW" if priority else "READY",
                "approvedImpact": "Potential reach and engagement require human validation before publication.",
                "delayImpact": "Opportunity freshness declines as the news cycle advances.",
                "sourceUrl": priority.url if priority else None,
            },
            "researchAgents": {
                "configured": len(self.research_agents.definitions()),
                "enabled": len([a for a in self.research_agents.definitions() if a.enabled]),
            },
            "source": source,
        }
