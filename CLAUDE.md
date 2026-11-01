# CLAUDE.md — honeypot-dashboard

## But
Dashboard self-hosted pour un honeypot Cowrie (SSH/Telnet) sur le VPS OVH. Ingère le JSON Cowrie, le log
fail2ban et un log d'auth sshd dans SQLite ; sert vue d'ensemble, sessions (replay terminal), carte,
corrélation honeypot / sshd réel / bans, page IP (enrichissement, ban/unban). Statut : actif, perso, déployé.
Backlog : `TODO.md`. Décisions de design : `docs/superpowers/specs/`.

## Stack & architecture
- Backend FastAPI + SQLite brut (pas d'ORM) : `app/` (`main.py` create_app, `ingester.py`, `tailer.py`,
  `correlation.py`, `cowrie_parser.py`, `ttyplayer.py`, `geoip.py`, `ip_enrichment.py`,
  `enrichment_worker.py`, `fban_control.py`, `routers/`). Tests : `tests/` (pytest).
- Frontend React + TS + Vite : `frontend/` (HashRouter, TanStack Query, un seul `src/style.css`, Chart.js npm,
  `public/vendor/` = asciinema-player vendoré).
- Flux : `_poll_loop` appelle `.tick()` des 3 ingesters toutes les 5 s ; chaque `LogTailer` garde offset+inode
  dans `ingest_offsets` (reprise après restart, détection de rotation ; copytruncate non géré). Offset et
  lignes insérées sont commités dans la même transaction.
- fail2ban et sshd : l'hôte exporte vers `/var/log/honeypot-export/` (`scripts/fail2ban-export.sh` +
  `sshd-auth-export.sh`, timers systemd), et le conteneur monte ce *répertoire*. Ne jamais remonter un log
  comme fichier : le bind-mount fige l'inode et l'ingestion s'arrête en silence à la rotation suivante.
  `/api/health` expose par source le retard de lecture (`lag_bytes`), le dernier événement et `stalled`
  (données non lues depuis > 60 s ou fichier absent) ; `HealthBanner` (dans `App`) l'affiche sur toutes les pages.
- Campagnes (`campaigns_stats.py`, `/api/campaigns`, page `CampaignsPage/`) : empreintes ttylog (nom =
  SHA-256 du contenu Cowrie) fusionnées en familles par séquence de commandes normalisée
  (`command_normalize.py` : jetons hex, IP, /tmp, calculs `$((…))`, mot de passe rejoué dans
  `echo '…' | sudo -S`) ; une séquence d'au moins 3 commandes qui commence une séquence plus longue (run
  tronqué) rejoint cette famille. Campagne = famille de ≥ 2 sessions, les autres = « Sessions uniques ».
  Compteurs par empreinte tenus à l'ingestion (`fingerprint_stats.py` : tables `fingerprint_stats/_ips/_days`,
  rattrapage au démarrage si vides) ; les familles restent calculées à la lecture depuis ces compteurs.
  Agrégat, pages et fiches en cache 5 min (`stats_cache`), tri/pagination en Python.
- Réimport ponctuel des logs sshd avec le parseur courant : `python -m app.reimport_sshd_auth [--dry-run] FICHIERS`
  (remplace les lignes de la plage couverte par les fichiers).
- Cowrie : `parse_event` (dataclasses typées) puis `apply_cowrie_record` (tables `sessions`, `commands`,
  `ttylogs`). Un nouveau type d'événement = étendre les deux.
- `create_app(db=..., start_background_tasks=...)` injectable pour `TestClient` sans I/O ; `tests/conftest.py`
  redirige les chemins vers `data/` avant tout import de `app.main`.
- Routers fins, SQL inline sur `request.app.state.db`. Handlers `async` mais sqlite synchrone sur une seule
  connexion partagée (WAL) : volontaire (commit `d1b5a29`), ne pas "corriger" avec `to_thread`. Jamais
  de handler `def` qui touche la base (threadpool → accès concurrent → 500) ; seul un appel bloquant sans
  base (ex. `fban_control`) passe par `asyncio.to_thread`.
- Replay : `/api/sessions/{id}/replay` lit les ttylogs Cowrie (mount RO), `ttyplayer.py` les convertit en
  asciinema v2 ; le routeur retire le préfixe `var/` des chemins Cowrie.
- Design : clone fidèle d'Umami v3 (voir `DESIGN.md`) ; tokens dans `style.css`, couleurs Chart.js/carte dans
  `theme/chartTheme.ts`. La carte est une choroplèthe (`public/world.json` + `utils/isoCountries.ts`, repris
  d'Umami, MIT) alimentée par `countries` de `/api/overview` ; elle a besoin de `geo_cache.country_code`
  (rempli au lookup et par le backfill de démarrage).
- Filtres façon Umami : `country`/`protocol`/`ip`/`username` dans l'URL (`theme/useFilters.ts`), passés à
  `/api/overview` ; `previous` = mêmes totaux sur la période précédente (null pour `all`).
- `/api/overview` et la heatmap passent par `app.state.stats_cache` (`ttl_cache.py`, TTL par période dans
  `routers/overview.py`, 10 s pour 24h à 60 s pour all) ; le front poll au même rythme. Un test qui insère
  puis relit l'overview doit vider ce cache.
- Ban/unban : `fban_control.py` parle à un worker systemd hôte (`scripts/fban-queue-worker.sh`) via un
  répertoire de queue bind-mounté (`FBAN_QUEUE_PATH`) ; repli sur l'heuristique logs après
  `FBAN_TIMEOUT_SECONDS` (2.0). `/ban` et `/unban` rejettent les requêtes cross-origin (Origin/Referer).
  `/ban` refuse les IP de `ADMIN_IPS` (403, `admin_ips.py`) et le worker hôte refuse aussi celles de
  `/etc/honeypot/never-ban` ; le bouton demande une confirmation. Toutes les réponses portent
  `X-Frame-Options: DENY` + `frame-ancestors 'none'` (middleware dans `create_app`).
- Enrichissement IP (ASN, rDNS, AbuseIPDB) : table `ip_enrichment` = file d'attente + résultats, drainée par
  `EnrichmentWorker`. Sans config, tout dégrade en no-op.
- Le dashboard est déployé en conteneur durci (`read_only`, `cap_drop: ALL`, `no-new-privileges`) sur le
  réseau externe `nginx-proxy-network`, derrière Nginx Proxy Manager. `scripts/` = helpers côté VPS.

## Commandes
```bash
.venv/bin/uvicorn app.main:app --reload        # backend dev (:8000)
cd frontend && npm run dev                      # frontend dev, proxy /api -> localhost:8000
.venv/bin/pytest                                # tests backend (un test : tests/x.py::nom -v)
cd frontend && npm test                         # tests frontend (vitest)
cd frontend && npm run build                    # tsc -b && vite build (aussi fait par le Dockerfile)
docker compose up -d --build                    # build/run local ou VPS
# Déploiement (après push sur origin/main) :
ssh vps 'cd honeypot-dashboard && git pull && docker compose up -d --build'
```
Pas de lint/format configuré : imiter le style existant. Après déploiement : `docker compose ps` et
`docker compose logs --tail=20 dashboard`.

## Conventions du projet
- Un bug = un commit = un cycle de déploiement ; cocher la ligne dans `TODO.md`.
- Déboguer avec des données réelles du VPS (sqlite du conteneur, vrais ttylogs) plutôt que des fixtures seules.
- Sur le VPS, `~/honeypot-dashboard/` cohabite avec `~/budget/` (autre app) : vérifier le dossier avant `git pull`.

## Pièges connus
- Env vars : `COWRIE_JSON_PATH`, `COWRIE_VAR_PATH`, `DASHBOARD_DB_PATH`, `FAIL2BAN_LOG_PATH`,
  `SSHD_AUTH_LOG_PATH`, `GEOIP_DB_PATH`, `GEOIP_ASN_DB_PATH`, `ABUSEIPDB_API_KEY` (vide = désactivé),
  `FBAN_QUEUE_PATH`, `FBAN_TIMEOUT_SECONDS`, `ADMIN_IPS` (IP/CIDR séparés par des virgules, dans `.env`).
- Les défauts de chemins sont ceux du conteneur (`/data/...`) ; importer `app.main` crée l'app au niveau module.
- Le libellé « port 50022 » de la page Corrélation est codé en dur (voir `TODO.md`).
- `docs/superpowers/` est dans `.gitignore` mais 26 fichiers déjà suivis restent versionnés.
