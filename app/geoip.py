import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class GeoResult:
    country: str | None
    city: str | None


class GeoLookup:
    """Wraps a MaxMind geoip2-style reader with a SQLite-backed cache."""

    def __init__(self, db: sqlite3.Connection, reader):
        self.db = db
        self.reader = reader

    def lookup(self, ip: str) -> GeoResult:
        row = self.db.execute(
            "SELECT country, city FROM geo_cache WHERE ip = ?", (ip,)
        ).fetchone()
        if row:
            return GeoResult(country=row["country"], city=row["city"])

        country = city = None
        if self.reader is not None:
            try:
                response = self.reader.city(ip)
                country = response.country.name
                city = response.city.name
            except Exception:
                pass  # private/reserved IP, not in the database, reader unavailable, etc.

        self.db.execute(
            "INSERT INTO geo_cache (ip, country, city, looked_up_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(ip) DO UPDATE SET country = excluded.country, city = excluded.city",
            (ip, country, city, datetime.now(timezone.utc).isoformat()),
        )
        self.db.commit()
        return GeoResult(country=country, city=city)
