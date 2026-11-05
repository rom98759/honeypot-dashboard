# CLAUDE.md — honeypot-dashboard

## But
Dashboard self-hosted pour un honeypot Cowrie (SSH/Telnet) sur le VPS OVH. Ingère le JSON Cowrie, le log
fail2ban et un log d'auth sshd dans SQLite ; sert vue d'ensemble, sessions (replay terminal), carte,
corrélation honeypot / sshd réel / bans, page IP (enrichissement, ban/unban). Statut : actif, perso, déployé.
Backlog : `TODO.md`. Doc publique bilingue : `README.md`/`README.fr.md`, `docs/install.md`/`docs/install.fr.md`
(à garder synchronisées : `tests/test_docs.py` vérifie que chaque clé de config y figure).

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
- Fichiers (`session_files.py`, `/api/files`, page `FilesPage/`, onglet Fichiers de la fiche session) : table
  `session_files` remplie par `cowrie.session.file_download(.failed)` / `file_upload` (kind `download` = URL,
  `redirect` = `echo > fichier`, `upload` = SFTP/scp, `failed`) ; rattrapage unique au démarrage de tous les
  `cowrie.json*` (table `backfills`). Contenu lu dans `<COWRIE_VAR_PATH>/lib/cowrie/downloads/<sha256>`
  (O_NOFOLLOW) ; zip « infected » en ZipCrypto pur Python (`zipcrypto.py`, ~4 Mo/s, hors boucle, 1 à la fois,
  max 64 Mo). Cowrie écrit ces fichiers en 600 : l'unité hôte `cowrie-downloads-perms.path` ajoute o+r.
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
  asciinema v2 ; le routeur retire le préfixe `var/` des chemins Cowrie. `?download=1` le sert en `.cast`.
- Fiche session (`SessionDetailPanel`, mise en page validée dans `DESIGN.md`) : `/api/sessions/{id}` renvoie
  aussi `ttylogs`, `ip` (pays, ASN, nb de sessions, banni d'après les logs, protégée) et `campaign` (via
  l'agrégat campagnes en cache) ; `/api/sessions/{id}/export` = la même chose en pièce jointe JSON.
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
  `/ban` refuse les IP protégées (403, `admin_ips.py` = `ADMIN_IPS` du `.env` + table `admin_networks`
  éditée depuis la page Réglages `/settings`, plages pas plus larges que /16 ou /48) ; le worker hôte refuse aussi celles de
  `/etc/honeypot/never-ban` ; le bouton demande une confirmation. Toutes les réponses portent
  `X-Frame-Options: DENY` + `frame-ancestors 'none'` (middleware dans `create_app`).
  Choix du propriétaire (2026-11-01) : les IP protégées ne sont PAS exclues des statistiques (Overview,
  campagnes, sessions uniques, Corrélation) ; elles servent seulement à interdire le ban. Ne pas le reproposer.
- Logique de ban (validée 2026-11-04) : « le honeypot observe, les vrais services sont protégés ». Jails
  dans `scripts/fail2ban/honeypot.local.tmpl` (posé par `install-host.sh`) : `cowrie` (toute connexion
  Cowrie, 1 j), `sshd` (vrai port, 2 échecs, 7 j ; Debian 12 = `journalmatch` sur `ssh.service`),
  `recidive` (30 j), `npm-badbots` (action seulement), `manual` / `manual-all` (bouton du dashboard, 7 j).
  Action `honeypot-block` → `scripts/honeypot-ban.sh` : une chaîne `hp-<jail>` appelée depuis INPUT et
  DOCKER-USER ; portée `services` = tout sauf Cowrie (RETURN tcp/`COWRIE_PORT`, DOCKER-USER `! -d
  HONEYPOT_SUBNET`), `all` = tout. `docker-user-firewall.sh` réinjecte les sauts (il vide DOCKER-USER).
  Le worker n'accepte que `ban manual|manual-all`, `unban all`, `status all`. IP protégées : le dashboard
  écrit `ADMIN_IPS` + table `admin_networks` dans `<queue>/admin-networks` (démarrage et chaque modif) ;
  `scripts/honeypot-never-ban.sh` (ignorecommand fail2ban + worker) lit ce fichier et `/etc/honeypot/never-ban`,
  et ignore dans le premier les plages > /16 ou /48 (le conteneur peut l'écrire). Les bantimes du template
  et `DEFAULT_BANTIMES` / `JAIL_SCOPES` (`app/correlation.py`) doivent rester alignés.
- Enrichissement IP (ASN, rDNS, AbuseIPDB) : table `ip_enrichment` = file d'attente + résultats, drainée par
  `EnrichmentWorker`. Sans config, tout dégrade en no-op.
- Un seul projet compose : Cowrie (port 22, réseau `honeypot-net` au sous-réseau figé `HONEYPOT_SUBNET`) +
  dashboard durci (`read_only`, `cap_drop: ALL`, `no-new-privileges`) sur le réseau externe `PROXY_NETWORK`.
  Réglages compose dans `.env` (`.env.example`) ; noms de volumes surchargeables pour reprendre une install.
- Partie hôte : `scripts/install-host.sh` (idempotent, `--dry-run`, `--uninstall`, `--root` pour les tests)
  installe scripts + unités depuis `scripts/`, config dans `/etc/honeypot-dashboard/host.env`
  (`scripts/host.env.example`). Préflight : refuse (exit 2) si sshd écoute sur 22 ou si ufw actif sans règle
  pour `SSHD_PORT`. Ne touche jamais sshd, ufw ni `INPUT` ; pare-feu uniquement dans `DOCKER-USER`.

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
  `FBAN_QUEUE_PATH`, `FBAN_TIMEOUT_SECONDS`, `FBAN_ENABLED` (défaut 0 : ban masqué, worker hôte jamais
  interrogé), `SSHD_PORT` (libellé Corrélation, via `/api/config`), `ADMIN_IPS` (IP/CIDR séparés par des virgules, dans `.env`),
  `FAIL2BAN_BANTIMES` (`jail=secondes,…`, défauts = `honeypot.local.tmpl` : un ban sans `Unban` expire après ce délai).
- Les défauts de chemins sont ceux du conteneur (`/data/...`) ; importer `app.main` crée l'app au niveau module.
- `docs/superpowers/` est dans `.gitignore` (specs/plans locaux, jamais commités).
- Dépôt destiné à être public : aucune IP, domaine, port SSH réel ni chemin `/home/...` dans un fichier suivi
  (`tests/test_docs.py::test_no_owner_specific_values_tracked`).
