"""
Session search language shared by the overview, map, sessions and commands pages:

    ip:45.* country:CN,RU -user:root cmd:"wget http" dur>60 login:ok file:upload

- `field:value`, several values separated by commas = OR; several terms = AND.
- `-` in front negates a term; `*` is a wildcard; quotes keep spaces and commas.
- `dur` compares with > < >= <= (seconds, or 5m / 1h).
- A bare word is an IP when it looks like one, otherwise a command fragment.

The frontend tokenizes the same grammar (frontend/src/utils/searchFilter.ts) to draw the
chips; this module is the authority and turns terms into SQL on the `sessions` alias `s`.
Error messages are shown as is in the UI, hence in French.
"""

import ipaddress
import re
from dataclasses import dataclass

MAX_TERMS = 20
MAX_VALUE_LENGTH = 200

FIELDS = ("ip", "country", "asn", "proto", "user", "pass", "cmd", "dur", "login", "file")
ALIASES = {
    "protocol": "proto",
    "username": "user",
    "password": "pass",
    "command": "cmd",
    "duration": "dur",
    "pays": "country",
}
COMPARISONS = (">=", "<=", ">", "<")
LOGIN_VALUES = ("ok", "failed", "none")
FILE_KINDS = ("download", "upload", "redirect", "failed")

_TERM_RE = re.compile(r"(-?)([a-zA-Z]+)(>=|<=|>|<|:)(.*)", re.S)
_IP_LIKE_RE = re.compile(r"^[0-9a-fA-F:.*]+(/\d{1,3})?$")
_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)(s|m|h)?$")
_HEX_RE = re.compile(r"^[0-9a-fA-F]{6,64}$")


class FilterError(ValueError):
    pass


@dataclass(frozen=True)
class Term:
    field: str
    op: str  # ":" or a comparison
    values: tuple[str, ...]
    negate: bool = False


def _split_tokens(text: str) -> list[str]:
    """Whitespace-separated tokens; double quotes (with \\" and \\\\ escapes) keep spaces."""
    tokens, current, in_quotes, i = [], [], False, 0
    pending = False
    while i < len(text):
        ch = text[i]
        if in_quotes:
            if ch == "\\" and i + 1 < len(text):
                current.append(text[i : i + 2])
                i += 2
                continue
            if ch == '"':
                in_quotes = False
            current.append(ch)
        elif ch == '"':
            in_quotes = True
            current.append(ch)
            pending = True
        elif ch.isspace():
            if current:
                tokens.append("".join(current))
                current = []
        else:
            current.append(ch)
        i += 1
    if in_quotes:
        raise FilterError("guillemet non fermé")
    if current or pending:
        tokens.append("".join(current))
    return tokens


def _split_values(raw: str) -> list[str]:
    """Comma-separated values; a quoted value may contain commas."""
    values, current, in_quotes, i = [], [], False, 0
    while i < len(raw):
        ch = raw[i]
        if in_quotes:
            if ch == "\\" and i + 1 < len(raw):
                current.append(raw[i + 1])
                i += 2
                continue
            if ch == '"':
                in_quotes = False
            else:
                current.append(ch)
        elif ch == '"':
            in_quotes = True
        elif ch == ",":
            values.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    values.append("".join(current))
    if any(v == "" for v in values):
        raise FilterError("valeur vide")
    return values


def _check_value(field: str, op: str, value: str) -> None:
    if len(value) > MAX_VALUE_LENGTH:
        raise FilterError(f"{field} : valeur trop longue")
    if field == "dur":
        if not _DURATION_RE.match(value):
            raise FilterError("dur : nombre de secondes attendu (ex. dur>60, dur<5m)")
        return
    if op != ":":
        raise FilterError(f"{field} : seul dur accepte > et <")
    if field == "ip":
        if not _IP_LIKE_RE.match(value):
            raise FilterError(f"ip : « {value} » n'est pas une IP, un préfixe 45.* ou une plage CIDR")
        if "/" in value:
            try:
                ipaddress.ip_network(value, strict=False)
            except ValueError:
                raise FilterError(f"ip : plage « {value} » invalide") from None
    elif field == "proto" and value.lower() not in ("ssh", "telnet"):
        raise FilterError("proto : ssh ou telnet")
    elif field == "login" and value.lower() not in LOGIN_VALUES:
        raise FilterError("login : ok, failed ou none")
    elif field == "file" and value.lower() not in ("any", *FILE_KINDS) and not _HEX_RE.match(value):
        raise FilterError("file : any, download, upload, redirect, failed ou un début de SHA-256")


def _looks_like_ip(word: str) -> bool:
    if not _IP_LIKE_RE.match(word) or not any(c in word for c in ".:"):
        return False
    try:
        ipaddress.ip_network(word.replace("*", "0"), strict=False)
        return True
    except ValueError:
        return "*" in word and bool(re.match(r"^\d{1,3}(\.(\d{1,3}|\*))*\.?\*?$", word))


def parse(text: str) -> list[Term]:
    terms = []
    for token in _split_tokens(text or ""):
        m = _TERM_RE.fullmatch(token)
        if m and (m[2].lower() in FIELDS or m[2].lower() in ALIASES):
            negate, name, op, raw = m[1] == "-", m[2].lower(), m[3], m[4]
            field = ALIASES.get(name, name)
        elif m and not token.startswith('"') and not m[4].startswith("//"):  # a URL stays a word
            raise FilterError(f"champ inconnu « {m[2]} » (champs : {', '.join(FIELDS)})")
        else:
            negate = token.startswith("-") and len(token) > 1
            raw = token[1:] if negate else token
            plain = _split_values(raw)
            field = "ip" if len(plain) == 1 and _looks_like_ip(plain[0]) else "cmd"
            op = ":"
        values = _split_values(raw)
        if field == "dur" and (len(values) > 1 or op == ":"):
            raise FilterError("dur : une seule comparaison, ex. dur>60")
        for value in values:
            _check_value(field, op, value)
        terms.append(Term(field, op, tuple(values), negate))
        if len(terms) > MAX_TERMS:
            raise FilterError(f"{MAX_TERMS} conditions au maximum")
    return terms


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped.replace("*", "%")


def _text_match(column: str, value: str, contains: bool = False) -> tuple[str, list]:
    if contains or "*" in value:
        pattern = _like(value)
        if contains:
            pattern = f"%{pattern}%"
        return f"{column} LIKE ? ESCAPE '\\'", [pattern]
    return f"{column} = ?", [value]


def _ip_condition(value: str) -> tuple[str, list]:
    if "/" in value:
        network = ipaddress.ip_network(value, strict=False)
        if network.version == 4 and network.prefixlen in (8, 16, 24, 32):
            # Octet-aligned ranges stay plain LIKE prefixes, far cheaper than a Python call per row.
            octets = str(network.network_address).split(".")[: network.prefixlen // 8]
            if network.prefixlen == 32:
                return "s.src_ip = ?", [str(network.network_address)]
            return "s.src_ip LIKE ?", [".".join(octets) + ".%"]
        return "ip_in_network(s.src_ip, ?)", [str(network)]
    return _text_match("s.src_ip", value)


def _duration_ms(value: str) -> int:
    m = _DURATION_RE.match(value)
    factor = {"s": 1, "m": 60, "h": 3600}[m[2] or "s"]
    return round(float(m[1]) * factor * 1000)


def _value_condition(field: str, op: str, value: str) -> tuple[str, list]:
    if field == "ip":
        return _ip_condition(value)
    if field == "country":
        if len(value) == 2 and value.isalpha():
            return "s.src_ip IN (SELECT ip FROM geo_cache WHERE country_code = ?)", [value.upper()]
        sql, params = _text_match("country", value)
        return f"s.src_ip IN (SELECT ip FROM geo_cache WHERE {sql.replace(' = ?', ' = ? COLLATE NOCASE')})", params
    if field == "asn":
        digits = value[2:] if value.lower().startswith("as") else value
        if digits.isdigit():
            return "s.src_ip IN (SELECT ip FROM ip_enrichment WHERE asn = ?)", [int(digits)]
        sql, params = _text_match("asn_org", value, contains=True)
        return f"s.src_ip IN (SELECT ip FROM ip_enrichment WHERE {sql})", params
    if field == "proto":
        return "COALESCE(s.protocol, 'ssh') = ?", [value.lower()]
    if field == "user":
        return _text_match("s.login_username", value)
    if field == "pass":
        return _text_match("s.login_password", value)
    if field == "cmd":
        sql, params = _text_match("input_text", value, contains=True)
        return f"s.session_id IN (SELECT session_id FROM commands WHERE {sql})", params
    if field == "dur":
        return f"s.duration_ms {'=' if op == ':' else op} ?", [_duration_ms(value)]
    if field == "login":
        return {
            "ok": ("s.login_success = 1", []),
            "failed": ("s.login_username IS NOT NULL AND COALESCE(s.login_success, 0) = 0", []),
            "none": ("s.login_username IS NULL", []),
        }[value.lower()]
    if field == "file":
        lowered = value.lower()
        if lowered == "any":
            return "s.session_id IN (SELECT session_id FROM session_files)", []
        if lowered in FILE_KINDS:
            return "s.session_id IN (SELECT session_id FROM session_files WHERE kind = ?)", [lowered]
        return "s.session_id IN (SELECT session_id FROM session_files WHERE shasum LIKE ?)", [lowered + "%"]
    raise FilterError(f"champ inconnu « {field} »")


def to_sql(terms: list[Term]) -> tuple[str, list]:
    """`" AND …"` clauses for a query whose sessions table is aliased `s`."""
    clauses, params = [], []
    for term in terms:
        parts = []
        for value in term.values:
            sql, p = _value_condition(term.field, term.op, value)
            parts.append(f"({sql})")
            params.extend(p)
        combined = " OR ".join(parts)
        # NULL columns (no login, no duration) must count as "not matching", so a negated
        # term keeps them: NOT NULL would drop them.
        clauses.append(f"NOT COALESCE(({combined}), 0)" if term.negate else f"({combined})")
    return "".join(f" AND {c}" for c in clauses), params


def quote(value: str) -> str:
    if value and not re.search(r'[\s,"\\]', value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def legacy_terms(country=None, protocol=None, ip=None, username=None, command=None) -> str:
    """Older links (?ip=, ?country=, ?command= …) expressed in the search language."""
    parts = []
    for field, value in (("country", country), ("proto", protocol), ("ip", ip), ("user", username), ("cmd", command)):
        if value:
            parts.append(f"{field}:{quote(value)}")
    return " ".join(parts)


def compile_filter(text: str | None, **legacy) -> tuple[str, list, str]:
    """Parse the `filter` parameter plus legacy parameters. Returns (sql, params, canonical
    text) — the canonical text is a stable cache key."""
    combined = " ".join(p for p in (text or "", legacy_terms(**legacy)) if p.strip())
    terms = parse(combined)
    sql, params = to_sql(terms)
    return sql, params, combined.strip()
