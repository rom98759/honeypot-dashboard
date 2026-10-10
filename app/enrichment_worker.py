import asyncio
import datetime

from app.ip_enrichment import EnrichmentResult, IpEnrichment


class EnrichmentWorker:
    """Drains ip_enrichment rows with status='pending', one at a time,
    oldest first (rowid order = insertion order)."""

    def __init__(self, db, ip_enrichment: IpEnrichment, item_delay: float = 1, idle_delay: float = 5):
        self.db = db
        self.ip_enrichment = ip_enrichment
        self.item_delay = item_delay
        self.idle_delay = idle_delay

    async def drain_once(self) -> bool:
        row = self.db.execute(
            "SELECT ip FROM ip_enrichment WHERE status = 'pending' ORDER BY rowid LIMIT 1"
        ).fetchone()
        if row is None:
            return False
        ip = row["ip"]
        try:
            result = await asyncio.to_thread(self.ip_enrichment.resolve, ip)
        except Exception:
            result = EnrichmentResult(None, None, None, None, None, None)
        self.db.execute(
            "UPDATE ip_enrichment SET asn = ?, asn_org = ?, reverse_dns = ?, "
            "abuseipdb_score = ?, abuseipdb_total_reports = ?, abuseipdb_last_reported_at = ?, "
            "status = 'done', looked_up_at = ? WHERE ip = ?",
            (
                result.asn, result.asn_org, result.reverse_dns,
                result.abuseipdb_score, result.abuseipdb_total_reports, result.abuseipdb_last_reported_at,
                datetime.datetime.now(datetime.timezone.utc).isoformat(), ip,
            ),
        )
        self.db.commit()
        return True

    async def run_forever(self) -> None:
        while True:
            processed = await self.drain_once()
            await asyncio.sleep(self.item_delay if processed else self.idle_delay)
