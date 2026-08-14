from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app


def test_map_returns_points_and_null_destination_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("VPS_LATITUDE", raising=False)
    monkeypatch.delenv("VPS_LONGITUDE", raising=False)
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2026-08-14T10:00:00Z')"
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/map?period=all")
    assert response.status_code == 200
    body = response.json()
    assert body["points"][0]["city"] == "Paris"
    assert body["destination"] is None


def test_map_returns_destination_when_vps_coordinates_set(tmp_path, monkeypatch):
    monkeypatch.setenv("VPS_LATITUDE", "51.0162051")
    monkeypatch.setenv("VPS_LONGITUDE", "2.1556627")
    db = connect(tmp_path / "db.sqlite3")

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/map")
    body = response.json()
    assert body["destination"] == {"latitude": 51.0162051, "longitude": 2.1556627}


def test_map_rejects_invalid_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/map?period=bogus")
    assert response.status_code == 400


def test_map_defaults_to_24h_period(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, looked_up_at) "
        "VALUES ('1.2.3.4', 'France', 'Paris', 48.85, 2.35, 't')"
    )
    db.execute(
        "INSERT INTO sessions (session_id, src_ip, connect_time) VALUES ('s1', '1.2.3.4', '2020-01-01T00:00:00Z')"
    )
    db.commit()

    app = create_app(db=db, start_background_tasks=False)
    client = TestClient(app)

    response = client.get("/api/map")  # no period param -> defaults to 24h; session is from 2020
    assert response.json()["points"] == []
