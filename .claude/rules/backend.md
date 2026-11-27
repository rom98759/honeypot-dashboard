---
paths:
  - "app/**"
  - "tests/**"
---
# Backend (FastAPI + SQLite)

- `create_app(db=..., start_background_tasks=...)` injectable pour `TestClient` sans I/O ; `tests/conftest.py`
  redirige les chemins vers `data/` avant tout import de `app.main`. Importer `app.main` crée l'app au niveau
  module ; les défauts de chemins sont ceux du conteneur (`/data/...`).
- Routers fins, SQL inline sur `request.app.state.db`. Handlers `async` mais sqlite synchrone sur une seule
  connexion partagée (WAL) : volontaire (commit `d1b5a29`), ne pas "corriger" avec `to_thread`. Jamais
  de handler `def` qui touche la base (threadpool → accès concurrent → 500) ; seul un appel bloquant sans
  base (ex. `fban_control`) passe par `asyncio.to_thread`.
- Cowrie : `parse_event` (dataclasses typées) puis `apply_cowrie_record` (tables `sessions`, `commands`,
  `ttylogs`). Un nouveau type d'événement = étendre les deux.
- Replay : `/api/sessions/{id}/replay` lit les ttylogs Cowrie (mount RO), `ttyplayer.py` les convertit en
  asciinema v2 ; le routeur retire le préfixe `var/` des chemins Cowrie. `?download=1` le sert en `.cast`.
- `/api/sessions/{id}` renvoie aussi `ttylogs`, `ip` (pays, ASN, nb de sessions, banni d'après les logs,
  protégée) et `campaign` (via l'agrégat campagnes en cache) ; `/api/sessions/{id}/export` = la même chose en
  pièce jointe JSON.
- `/api/overview` et la heatmap passent par `app.state.stats_cache` (`ttl_cache.py`, TTL par période dans
  `routers/overview.py`, 10 s pour 24h à 60 s pour all) ; le front poll au même rythme. Un test qui insère
  puis relit l'overview doit vider ce cache. `previous` = mêmes totaux sur la période précédente (null pour `all`).
- Clients IPv6 : docker-proxy les relaie depuis la passerelle du réseau honeypot (`app/proxied_ip.py`, 1re IP de
  `HONEYPOT_SUBNET`, passé au conteneur) ; sessions gardées, exclues des tops IP / Corrélation.
- Enrichissement IP (ASN, rDNS, AbuseIPDB) : table `ip_enrichment` = file d'attente + résultats, drainée par
  `EnrichmentWorker`. Sans config, tout dégrade en no-op.
- Réimport ponctuel des logs sshd avec le parseur courant : `python -m app.reimport_sshd_auth [--dry-run] FICHIERS`
  (remplace les lignes de la plage couverte par les fichiers).
- Env vars : `COWRIE_JSON_PATH`, `COWRIE_VAR_PATH`, `DASHBOARD_DB_PATH`, `FAIL2BAN_LOG_PATH`,
  `SSHD_AUTH_LOG_PATH`, `GEOIP_DB_PATH`, `GEOIP_ASN_DB_PATH`, `ABUSEIPDB_API_KEY` (vide = désactivé),
  `FBAN_QUEUE_PATH`, `FBAN_TIMEOUT_SECONDS`, `FBAN_ENABLED` (défaut 0 : ban masqué, worker hôte jamais
  interrogé), `SSHD_PORT` (libellé Corrélation, via `/api/config`), `ADMIN_IPS` (IP/CIDR séparés par des virgules,
  dans `.env`), `FAIL2BAN_BANTIMES` (`jail=secondes,…`, défauts = `honeypot.local.tmpl` : un ban sans `Unban`
  expire après ce délai). Toute nouvelle clé doit apparaître dans les 4 docs (`tests/test_docs.py`).
