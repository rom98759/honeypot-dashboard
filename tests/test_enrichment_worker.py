import asyncio

from app.db import connect
from app.enrichment_worker import EnrichmentWorker
from app.ip_enrichment import EnrichmentResult


class _StubIpEnrichment:
    def __init__(self, result):
        self._result = result
        self.calls = []

    def resolve(self, ip):
        self.calls.append(ip)
        return self._result


class _ExplodingIpEnrichment:
    def resolve(self, ip):
        raise ConnectionError("network unreachable")


def test_drain_once_returns_false_when_queue_empty(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    worker = EnrichmentWorker(db, _StubIpEnrichment(EnrichmentResult(None, None, None, None, None, None)))

    assert asyncio.run(worker.drain_once()) is False


def test_drain_once_resolves_and_marks_done(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO ip_enrichment (ip) VALUES ('1.2.3.4')")
    db.commit()
    ip_enrichment = _StubIpEnrichment(
        EnrichmentResult(asn=15169, asn_org="GOOGLE", reverse_dns="dns.google",
                          abuseipdb_score=10, abuseipdb_total_reports=1, abuseipdb_last_reported_at="t")
    )
    worker = EnrichmentWorker(db, ip_enrichment)

    processed = asyncio.run(worker.drain_once())
    assert processed is True
    assert ip_enrichment.calls == ["1.2.3.4"]

    row = db.execute("SELECT * FROM ip_enrichment WHERE ip = '1.2.3.4'").fetchone()
    assert row["status"] == "done"
    assert row["asn"] == 15169
    assert row["asn_org"] == "GOOGLE"


def test_drain_once_never_reprocesses_a_done_row(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO ip_enrichment (ip, status) VALUES ('1.2.3.4', 'done')")
    db.commit()

    class _ExplodingOnCall:
        def resolve(self, ip):
            raise AssertionError("must not re-resolve a done row")

    worker = EnrichmentWorker(db, _ExplodingOnCall())
    assert asyncio.run(worker.drain_once()) is False


def test_drain_once_handles_resolver_exception_without_leaving_row_pending(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO ip_enrichment (ip) VALUES ('1.2.3.4')")
    db.commit()
    worker = EnrichmentWorker(db, _ExplodingIpEnrichment())

    processed = asyncio.run(worker.drain_once())  # must not raise
    assert processed is True

    row = db.execute("SELECT * FROM ip_enrichment WHERE ip = '1.2.3.4'").fetchone()
    assert row["status"] == "done"
    assert row["asn"] is None


def test_drain_once_processes_oldest_pending_row_first(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute("INSERT INTO ip_enrichment (ip) VALUES ('1.1.1.1')")
    db.execute("INSERT INTO ip_enrichment (ip) VALUES ('2.2.2.2')")
    db.commit()
    ip_enrichment = _StubIpEnrichment(EnrichmentResult(None, None, None, None, None, None))
    worker = EnrichmentWorker(db, ip_enrichment)

    asyncio.run(worker.drain_once())
    assert ip_enrichment.calls == ["1.1.1.1"]
