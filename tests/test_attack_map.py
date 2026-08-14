from datetime import datetime, timedelta, timezone

from app.attack_map import get_map_points
from app.db import connect


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_aggregates_sessions_by_coordinate(tmp_path):
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

    points = get_map_points(db, "all")

    assert len(points) == 1
    assert points[0]["city"] == "Paris"
    assert points[0]["session_count"] == 2
    assert sorted(points[0]["ips"]) == ["1.2.3.4", "5.6.7.8"]


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

    assert get_map_points(db, "all") == []


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

    assert get_map_points(db, "24h") == []
    assert len(get_map_points(db, "30d")) == 1


def test_orders_by_session_count_descending(tmp_path):
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
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s2', '9.9.9.9', ?)",
        (_iso(now),),
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s3', '9.9.9.9', ?)",
        (_iso(now),),
    )
    db.commit()

    points = get_map_points(db, "all")
    assert points[0]["city"] == "Berlin"
    assert points[0]["session_count"] == 2
    assert points[1]["city"] == "Paris"
