from datetime import datetime, timezone

from app.connectors.gdelt import GdeltConnector
from app.connectors.research_agents import ResearchAgentConnector
from app.connectors.rss import RssConnector
from app.services.advisory_board import build_advisory_board


class DashboardService:
    def __init__(self) -> None:
        self.gdelt = GdeltConnector()
        self.rss = RssConnector()
        self.research_agents = ResearchAgentConnector()

    async def get_dashboard(self) -> dict:
        from app.main import aggregate_story_intelligence

        source = "LIVE"
        try:
            stories = await aggregate_story_intelligence(limit=20)
        except Exception:
            source = "FALLBACK"
            stories = []

        if stories:
            priority = stories[0]
            story_count = len(stories)
            source_label = source
        else:
            priority = None
            story_count = 4
            source_label = "FALLBACK"

        priority_payload = {
            "title": priority.title if priority else "Amplify Story: Kenyan Farmers Using Israeli Water Innovation",
            "summary": priority.summary if priority else "A verified human-impact story with strong relevance to climate resilience, food security, and moderate Democratic audiences.",
            "audienceMatch": int(round(priority.audienceMatchScore)) if priority else 82,
            "evidenceQuality": int(priority.evidenceQuality) if priority else 92,
            "strategicImpact": "High" if priority else "High",
            "strategicImpactScore": int(priority.relevanceScore) if priority else 88,
            "readiness": int(priority.relevanceScore * 0.9) if priority else 96,
            "readinessState": priority.status if priority else "READY",
            "approvedImpact": "Potential reach and engagement require human validation before publication.",
            "delayImpact": "Opportunity freshness declines as the news cycle advances.",
            "sourceUrl": priority.sourceUrl if priority else None,
            "connector": priority.connector if priority else None,
            "bestAudienceName": (priority.bestAudienceMatch.audienceName if priority and priority.bestAudienceMatch else "Moderate Democrats"),
            "audienceMatchScore": int(round(priority.bestAudienceMatch.matchScore)) if priority and priority.bestAudienceMatch else 82,
            "audienceConfidence": int(round(priority.bestAudienceMatch.confidence)) if priority and priority.bestAudienceMatch else 78,
            "audienceReasons": priority.bestAudienceMatch.reasons if priority and priority.bestAudienceMatch else ["Fallback audience profile."],
            "audienceDataMode": priority.bestAudienceMatch.dataMode if priority and priority.bestAudienceMatch else "RULE_BASED",
        }

        advisory_board, advisory_consensus, minority_opinion, decision_readiness = build_advisory_board(priority, source_label)

        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "lastLogin": "Previous session",
            "metrics": {
                "storiesValidated": {"value": story_count, "trend": source_label},
                "campaignsCompleted": {"value": 2, "trend": "MVP"},
                "narrativesEmerging": {"value": min(7, max(1, story_count // 4)), "trend": source_label},
                "audienceSentiment": {"value": "+4%", "trend": "BASELINE"},
            },
            "priorityDecision": priority_payload,
            "advisoryBoard": [item.model_dump(mode="json") for item in advisory_board],
            "advisoryConsensus": advisory_consensus.model_dump(mode="json"),
            "minorityOpinion": minority_opinion,
            "decisionReadiness": decision_readiness,
            "researchAgents": {
                "configured": len(self.research_agents.definitions()),
                "enabled": len([a for a in self.research_agents.definitions() if a.enabled]),
            },
            "source": source_label,
        }
