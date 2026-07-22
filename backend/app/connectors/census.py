from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from app.models import IntelligenceItem, SourceRecord
from app.connectors.base import BaseConnector


class CensusConnector(BaseConnector):
    connector_id = "census-acs"
    name = "U.S. Census ACS"
    category = "demographics"

    async def fetch(self, **kwargs: Any) -> list[IntelligenceItem]:
        year = int(kwargs.get("year", 2024))
        geography = str(kwargs.get("geography", "state:*"))
        variables = "NAME,B01003_001E,B03003_003E,B19013_001E"
        endpoint = f"https://api.census.gov/data/{year}/acs/acs1"
        params = {"get": variables, "for": geography}
        if self.settings.census_api_key:
            params["key"] = self.settings.census_api_key
        async with self.client() as client:
            response = await client.get(endpoint, params=params)
            response.raise_for_status()
            rows = response.json()
        if not rows:
            return []
        header, *data_rows = rows
        collected_at = datetime.now(timezone.utc)
        items: list[IntelligenceItem] = []
        for row in data_rows[: int(kwargs.get("limit", 60))]:
            record = dict(zip(header, row))
            population = self._integer(record.get("B01003_001E"))
            hispanic = self._integer(record.get("B03003_003E"))
            income = self._integer(record.get("B19013_001E"))
            name = record.get("NAME", "Unknown geography")
            share = round(hispanic / population * 100, 1) if population else None
            summary = f"Population {population:,}; median household income ${income:,}." if population and income else "ACS demographic profile."
            if share is not None:
                summary += f" Hispanic or Latino population: {share}%."
            item_id = sha256(f"census:{year}:{name}".encode()).hexdigest()[:24]
            items.append(IntelligenceItem(
                id=item_id,
                title=f"{name} demographic profile",
                summary=summary,
                geography=[name],
                audiences=["U.S. demographic intelligence"],
                narratives=["audience opportunity"],
                confidence=0.95,
                source=SourceRecord(
                    connector=self.connector_id,
                    source_name=f"U.S. Census Bureau ACS {year}",
                    source_url=str(response.url),
                    collected_at=collected_at,
                    reliability=0.98,
                    freshness=f"{year} vintage",
                    license_note="Public U.S. government statistical data.",
                ),
                raw=record,
            ))
        return items

    @staticmethod
    def _integer(value: str | None) -> int | None:
        try:
            number = int(value) if value is not None else None
            return number if number is not None and number >= 0 else None
        except (TypeError, ValueError):
            return None
