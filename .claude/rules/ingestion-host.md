---
paths:
  - "app/tailer.py"
  - "app/ingester.py"
  - "app/fban_control.py"
  - "app/correlation.py"
  - "app/admin_ips.py"
  - "app/routers/health*.py"
  - "scripts/**"
  - "docker-compose*.yml"
  - "Dockerfile"
---
# Ingestion des logs, ban et partie hôte

- Flux : `_poll_loop` appelle `.tick()` des 3 ingesters toutes les 5 s ; chaque `LogTailer` garde offset+inode
  dans `ingest_offsets` (reprise après restart, détection de rotation ; copytruncate non géré). Offset et
  lignes insérées sont commités dans la même transaction.
- fail2ban et sshd : l'hôte exporte vers `/var/log/honeypot-export/` (`scripts/fail2ban-export.sh` +
  `sshd-auth-export.sh`, timers systemd), et le conteneur monte ce *répertoire*. Ne jamais remonter un log
  comme fichier : le bind-mount fige l'inode et l'ingestion s'arrête en silence à la rotation suivante.
  `/api/health` expose par source `lag_bytes`, le dernier événement et `stalled` (> 60 s ou fichier absent) ;
  `HealthBanner` l'affiche sur toutes les pages.
- Ban/unban : `fban_control.py` parle à un worker systemd hôte (`scripts/fban-queue-worker.sh`) via un
  répertoire de queue bind-mounté (`FBAN_QUEUE_PATH`) ; repli sur l'heuristique logs après
  `FBAN_TIMEOUT_SECONDS` (2.0). `/ban` et `/unban` rejettent les requêtes cross-origin (Origin/Referer).
  `/ban` refuse les IP protégées (403, `admin_ips.py` = `ADMIN_IPS` du `.env` + table `admin_networks`
  éditée depuis `/settings`, plages pas plus larges que /16 ou /48) ; le worker hôte refuse aussi celles de
  `/etc/honeypot/never-ban` ; le bouton demande une confirmation. Toutes les réponses portent
  `X-Frame-Options: DENY` + `frame-ancestors 'none'` (middleware dans `create_app`).
- Choix du propriétaire (2026-11-01) : les IP protégées ne sont PAS exclues des statistiques (Overview,
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
- Un seul projet compose : Cowrie (port 22, réseau `honeypot-net` au sous-réseau figé `HONEYPOT_SUBNET`) +
  dashboard durci (`read_only`, `cap_drop: ALL`, `no-new-privileges`) sur le réseau externe `PROXY_NETWORK`.
  Réglages compose dans `.env` (`.env.example`) ; noms de volumes surchargeables pour reprendre une install.
- Partie hôte : `scripts/install-host.sh` (idempotent, `--dry-run`, `--uninstall`, `--root` pour les tests)
  installe scripts + unités depuis `scripts/`, config dans `/etc/honeypot-dashboard/host.env`
  (`scripts/host.env.example`). Préflight : refuse (exit 2) si sshd écoute sur 22 ou si ufw actif sans règle
  pour `SSHD_PORT`. Ne touche jamais sshd, ufw ni `INPUT` ; pare-feu uniquement dans `DOCKER-USER`.
