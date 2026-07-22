from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
from urllib.parse import quote_plus

from app.models import IntelligenceItem, SourceRecord
from app.connectors.base import BaseConnector


class GdeltConnector(BaseConnector):
    connector_id = "gdelt-doc"
    name = "GDELT DOC 2.0"
    category = "news-and-events"
    endpoint = "https://api.gdeltproject.org/api/v2/doc/doc"

    async def fetch(self, **kwargs: Any) -> list[IntelligenceItem]:
        query = str(kwargs.get("query") or 'Israel innovation OR "Israeli technology"')
        limit = max(1, min(int(kwargs.get("limit", 10)), 250))
        params = {
            "query": query,
            "mode": "artlist",
            "maxrecords": limit,
            "format": "json",
            "sort": "hybridrel",
        }
        async with self.client() as client:
            response = await client.get(self.endpoint, params=params)
            response.raise_for_status()
            payload = response.json()

        items: list[IntelligenceItem] = []
        collected_at = datetime.now(timezone.utc)
        for article in payload.get("articles", []):
            url = article.get("url") or ""
            published = self._parse_date(article.get("seendate"))
            title = article.get("title") or "Untitled intelligence item"
            item_id = sha256(f"gdelt:{url}:{title}".encode()).hexdigest()[:24]
            items.append(IntelligenceItem(
                id=item_id,
                title=title,
                summary=f"News item surfaced by GDELT from {article.get('domain') or 'an indexed source'}.",
                published_at=published,
                url=url or None,
                geography=[value for value in [article.get("sourcecountry")] if value],
                confidence=0.72,
                source=SourceRecord(
                    connector=self.connector_id,
                    source_name=article.get("domain") or "GDELT indexed source",
                    source_url=url or None,
                    collected_at=collected_at,
                    reliability=0.70,
                    freshness="live",
                    license_note="Metadata supplied through GDELT; original publisher terms apply.",
                ),
                raw={"language": article.get("language"), "socialimage": article.get("socialimage")},
            ))
        return items

    @staticmethod
    def _parse_date(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
