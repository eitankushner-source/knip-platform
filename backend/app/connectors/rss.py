from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
import feedparser

from app.models import IntelligenceItem, SourceRecord
from app.connectors.base import BaseConnector


class RssConnector(BaseConnector):
    connector_id = "rss"
    name = "Curated RSS"
    category = "curated-news"

    async def fetch(self, **kwargs: Any) -> list[IntelligenceItem]:
        feed_url = str(kwargs.get("feed_url") or "https://www.timesofisrael.com/feed/")
        limit = max(1, min(int(kwargs.get("limit", 10)), 50))
        async with self.client() as client:
            response = await client.get(feed_url)
            response.raise_for_status()
        parsed = feedparser.parse(response.content)
        collected_at = datetime.now(timezone.utc)
        items: list[IntelligenceItem] = []
        for entry in parsed.entries[:limit]:
            title = entry.get("title", "Untitled RSS item")
            url = entry.get("link")
            item_id = sha256(f"rss:{feed_url}:{url}:{title}".encode()).hexdigest()[:24]
            items.append(IntelligenceItem(
                id=item_id,
                title=title,
                summary=(entry.get("summary") or "RSS intelligence item")[:700],
                url=url,
                confidence=0.68,
                source=SourceRecord(
                    connector=self.connector_id,
                    source_name=parsed.feed.get("title", "RSS feed"),
                    source_url=url,
                    collected_at=collected_at,
                    reliability=0.70,
                    freshness="live",
                    license_note="Headline and metadata only; publisher terms apply.",
                ),
                raw={"feed_url": feed_url},
            ))
        return items
