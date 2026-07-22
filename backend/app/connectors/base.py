from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any
import httpx

from app.config import get_settings
from app.models import ConnectorStatus, IntelligenceItem


class BaseConnector(ABC):
    connector_id: str
    name: str
    category: str
    cost: str = "Free"

    def __init__(self) -> None:
        self.settings = get_settings()

    @abstractmethod
    async def fetch(self, **kwargs: Any) -> list[IntelligenceItem]:
        raise NotImplementedError

    async def health(self) -> ConnectorStatus:
        try:
            await self.fetch(limit=1)
            status, detail = "healthy", "Live request completed successfully."
        except Exception as exc:  # connector failures must not break the platform
            status, detail = "degraded", str(exc)[:240]
        return ConnectorStatus(
            id=self.connector_id,
            name=self.name,
            category=self.category,
            enabled=True,
            status=status,
            last_checked=datetime.now(timezone.utc),
            detail=detail,
            cost=self.cost,
        )

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.settings.http_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": "KNIP/0.2 (+https://keremalliance.org)"},
        )
