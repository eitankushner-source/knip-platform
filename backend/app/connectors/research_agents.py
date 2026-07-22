import json
from pathlib import Path
from typing import Any

from app.connectors.gdelt import GdeltConnector
from app.models import IntelligenceItem, ResearchAgentDefinition


class ResearchAgentConnector:
    connector_id = "research-agents"
    name = "KNIP Research Agents"
    category = "agentic-research"

    def __init__(self) -> None:
        path = Path(__file__).resolve().parents[2] / "data" / "research_agents.json"
        self._definitions = [ResearchAgentDefinition.model_validate(row) for row in json.loads(path.read_text(encoding="utf-8"))]
        self._search = GdeltConnector()

    def definitions(self) -> list[ResearchAgentDefinition]:
        return self._definitions

    def definition(self, agent_id: str) -> ResearchAgentDefinition:
        for item in self._definitions:
            if item.id == agent_id:
                return item
        raise KeyError(agent_id)

    async def run(self, agent_id: str, limit: int = 20) -> list[IntelligenceItem]:
        definition = self.definition(agent_id)
        items = await self._search.fetch(query=definition.query, limit=limit)
        for item in items:
            item.audiences = definition.audiences
            item.narratives = [definition.name, "research-agent discovery"]
            item.raw["research_agent_id"] = definition.id
            item.raw["research_mission"] = definition.mission
        return items
