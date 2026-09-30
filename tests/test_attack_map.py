from datetime import datetime, timedelta, timezone

from app.attack_map import get_map_events
from app.db import connect


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_returns_one_row_per_session_not_aggregated(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('5.6.7.8', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '5.6.7.8', ?)",
        (_iso(now),),
    )
    db.commit()

    events = get_map_events(db, "all")

    # Same coordinate, two sessions -> two separate rows, not one aggregated point.
    assert len(events) == 2
    assert {e["ip"] for e in events} == {"1.2.3.4", "5.6.7.8"}
    assert all(e["city"] == "Paris" for e in events)
    assert all(e["latitude"] == 48.85 and e["longitude"] == 2.35 for e in events)


def test_excludes_sessions_without_coordinates(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('9.9.9.9', NULL, NULL, NULL, NULL, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', ?)",
        (_iso(datetime.now(timezone.utc)),),
    )
    db.commit()

    assert get_map_events(db, "all") == []


def test_period_filters_out_older_sessions(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(now - timedelta(days=10)),),
    )
    db.commit()

    assert get_map_events(db, "24h") == []
    assert len(get_map_events(db, "30d")) == 1


def test_orders_by_connect_time_ascending(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('9.9.9.9', 'Germany', 'Berlin', 52.52, 13.40, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '9.9.9.9', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '1.2.3.4', ?)",
        (_iso(now - timedelta(hours=1)),),
    )
    db.commit()

    events = get_map_events(db, "all")
    # s2 (Paris, 1 hour earlier) must come first when ordered by connect_time ascending.
    assert events[0]["city"] == "Paris"
    assert events[1]["city"] == "Berlin"
