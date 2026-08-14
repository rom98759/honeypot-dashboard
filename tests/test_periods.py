from datetime import datetime, timedelta, timezone

from app.periods import VALID_PERIODS, bucket_expr, period_cutoff


def test_valid_periods_contains_all_four():
    assert VALID_PERIODS == {"24h", "7d", "30d", "all"}


def test_period_cutoff_returns_none_for_all():
    assert period_cutoff("all") is None


def test_period_cutoff_24h_is_about_24_hours_ago():
    cutoff = period_cutoff("24h")
    parsed = datetime.strptime(cutoff, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    expected = datetime.now(timezone.utc) - timedelta(hours=24)
    assert abs((parsed - expected).total_seconds()) < 5


def test_period_cutoff_7d_is_about_7_days_ago():
    cutoff = period_cutoff("7d")
    parsed = datetime.strptime(cutoff, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    expected = datetime.now(timezone.utc) - timedelta(days=7)
    assert abs((parsed - expected).total_seconds()) < 5


def test_bucket_expr_hourly_for_short_periods():
    assert bucket_expr("24h", "connect_time") == "substr(connect_time, 1, 13)"
    assert bucket_expr("7d", "connect_time") == "substr(connect_time, 1, 13)"


def test_bucket_expr_daily_for_long_periods():
    assert bucket_expr("30d", "connect_time") == "substr(connect_time, 1, 10)"
    assert bucket_expr("all", "connect_time") == "substr(connect_time, 1, 10)"
