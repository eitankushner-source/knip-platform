from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class SourceRecord(BaseModel):
    connector: str
    source_name: str
    source_url: str | None = None
    collected_at: datetime
    reliability: float = Field(ge=0, le=1)
    freshness: str
    license_note: str


class IntelligenceItem(BaseModel):
    id: str
    title: str
    summary: str
    published_at: datetime | None = None
    url: str | None = None
    geography: list[str] = []
    audiences: list[str] = []
    narratives: list[str] = []
    confidence: float = Field(ge=0, le=1)
    source: SourceRecord
    raw: dict[str, Any] = {}


class NormalizedStory(BaseModel):
    id: str
    title: str
    summary: str
    sourceName: str
    sourceUrl: str | None = None
    publishedAt: datetime | None = None
    collectedAt: datetime
    connector: str
    geography: list[str] = []
    audienceTags: list[str] = []
    narrativeTags: list[str] = []
    reliability: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    freshness: float = Field(ge=0, le=100)
    relevanceScore: float = Field(ge=0, le=100)
    authenticityScore: float = Field(ge=0, le=100)
    evidenceQuality: float = Field(ge=0, le=100)
    status: str = 'REVIEW'


class ConnectorStatus(BaseModel):
    id: str
    name: str
    category: str
    enabled: bool
    status: str
    last_checked: datetime
    detail: str
    cost: str = "Free"


class ResearchAgentDefinition(BaseModel):
    id: str
    name: str
    mission: str
    query: str
    audiences: list[str]
    cadence: str
    enabled: bool = True
