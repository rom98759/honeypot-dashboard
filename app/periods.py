from datetime import datetime, timedelta, timezone

VALID_PERIODS = {"24h", "7d", "30d", "all"}

_PERIOD_DELTAS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def period_delta(period: str) -> timedelta:
    return _PERIOD_DELTAS[period]


def period_cutoff(period: str) -> str | None:
    if period == "all":
        return None
    return (datetime.now(timezone.utc) - _PERIOD_DELTAS[period]).strftime("%Y-%m-%dT%H:%M:%SZ")


def bucket_expr(period: str, column: str) -> str:
    length = 13 if period in ("24h", "7d") else 10
    return f"substr({column}, 1, {length})"
