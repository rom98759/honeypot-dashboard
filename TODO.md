# TODO

## Bugs

- [x] Parseur sshd usurpable : il prenait la 1re IPv4 de la ligne, donc un
      username « 1.2.3.4 » attribuait la tentative à cette IP. Corrigé : IP de
      la dernière paire `<ip> port <n>` (suffixe local VERBOSE retiré, IPv6
      acceptée). Les lignes déjà en base ne sont pas reparsées.
- [x] « Banni » contradictoire : Corrélation = banni au moins une fois, page
      IP = banni actuellement. Une seule requête (`currently_banned_query`,
      `app/correlation.py`) pour Corrélation, KPI Overview et page IP.
- [x] Ingestion fail2ban/sshd figée en silence (fail2ban bloqué au 2026-09-14) :
      les logs étaient bind-mountés comme fichiers, Docker fige l'inode, donc
      après chaque logrotate le conteneur relisait l'ancien fichier jusqu'au
      redémarrage suivant, et les fichiers tournés entre deux redémarrages
      n'étaient jamais lus. Corrigé : export hôte vers
      `/var/log/honeypot-export/` monté comme répertoire, `/api/health`.
      Trou 14/09 → ~26/09 perdu (déjà effacé par logrotate).
- [x] Timestamps affichés bruts en UTC — corrigé via `frontend/src/utils/formatDate.ts`
      (`formatTimestamp`), appliqué dans `SessionDetailPanel.tsx`, `SessionsPage.tsx`
      et `IpDetailPage.tsx`.
- [x] Replay session : décalage temporel constaté quand une commande envoie un
      gros pavé de texte en un seul coup (ex : payload exec de bot en une
      requête, > 10 Ko sur une poignée de lignes). Cause racine confirmée
      sur une vraie session VPS (`00c6de75932e`) : les timestamps calculés
      par `ttyplayer.py` étaient corrects, mais un seul évènement asciinema
      géant forçait le player JS à peindre tout le texte en un bloc
      synchrone, grignotant le délai avant l'évènement suivant. Corrigé en
      découpant les évènements > `CHUNK_SIZE` en plusieurs évènements
      espacés de `CHUNK_STEP_SECONDS` (`app/ttyplayer.py`).
- [x] KPI « IP bannies » gonflé : 17 IP comptées bannies alors que leur ban date de juin–août
      (bantime sshd 1 j, recidive 1 sem.). Leur `Unban` manque dans les logs (trou de septembre,
      redémarrages de fail2ban). Corrigé : un ban expire aussi passé le bantime de sa jail
      (`currently_banned_query`, défauts du VPS, `FAIL2BAN_BANTIMES` pour les changer). Prod : 17 → 0.

## Feuille de route (validée 2026-11-01)

- [x] A. Corrections rapides (#18–#22).
- [x] B1. Panneau session réorganisé + export JSON / .cast (#25) ; fiche campagne alignée, Campagnes mobile (#26).
- [ ] B2. Fichiers : ingérer `cowrie.session.file_upload` / `file_download` (scp compris), onglet
      « Fichiers » du panneau session (SHA-256, taille, source, lien VirusTotal), zip chiffré « infected ».
- [ ] C. Recherche avancée : chips multi-valeurs ET barre de requête texte
      (`ip:45.* country:CN cmd:wget -asn:… dur>60`) pilotant les mêmes filtres, sur toutes les pages.
- [ ] D. Annotations : notes + tags sur IP, session, campagne, en base, filtrables.
- [ ] Alertes Dependabot (le propriétaire gère les mises à jour).

## Frontend / refonte visuelle

- [x] Libellé « Tentatives sshd » de la page Corrélation : port lu depuis `SSHD_PORT`
      (`/api/config`) au lieu d'un texte en dur.

## Backend / perf

- [ ] Ajouter des index sur `commands(session_id)` et `ttylogs(session_id)`
      (`app/db.py`). Les deux sont interrogées par `session_id` à chaque
      ouverture du détail d'une session (`app/routers/sessions.py`) mais ne
      sont pas indexées — même pattern que l'indexation manquante déjà
      corrigée pour `currently_banned` (commit 6b31f43).
- [ ] Replay session : `ReplayPlayer` fait un `fetch` juste pour tester
      `response.ok`, puis `AsciinemaPlayer.create()` refait une requête
      identique — double lecture/parsing des ttylogs côté serveur à chaque
      ouverture de session (`frontend/src/components/ReplayPlayer.tsx`).

## Frontend / idées UI-UX (Phase 2 suite, à trier/prioriser)

- [ ] Dark mode (thème sombre par défaut ou togglable — tokens CSS déjà
      centralisés dans `:root` de `frontend/src/style.css`, il suffit de les
      redéfinir).
- [ ] Polish visuel général : hiérarchie typographique, transitions plus
      douces sur les changements de période, cohérence des couleurs de
      sévérité (les badges ne couvrent qu'une partie des états actuellement).
- [ ] Page "Commandes" — classement des commandes les plus tapées par les
      attaquants (table `commands`, actuellement visible uniquement en
      scrollant une session à la fois dans le panneau détail), avec lien vers
      les sessions concernées.
- [ ] Heatmap horaire/jour de la semaine des attaques (données déjà en base
      via `connect_time`).
- [ ] Distribution des durées de session ; répartition par jail fail2ban.
- [ ] Recherche globale (IP/session) accessible depuis n'importe quelle page.
- [ ] Graphiques cliquables / drill-down (ex : cliquer un pays dans le donut
      Overview filtre le Top IP, cliquer un protocole filtre Sessions).
- [ ] Sélecteur de période partagé entre toutes les pages au lieu d'un état
      indépendant par page (Overview, Carte ont chacun le leur aujourd'hui).
- [ ] Export CSV/JSON des sessions ou de l'historique d'une IP.
- [ ] Carte interactive : zoom/pan (`ZoomableGroup` de react-simple-maps,
      absent actuellement de `AttackMap.tsx` — scroll-zoom + drag-pan +
      double-clic), mini popup au clic sur un marker (IP/pays/nb sessions)
      avant d'ouvrir le détail, mode heatmap/densité en plus du mode
      points, scrubber temporel pour rejouer l'historique, choropleth par
      pays cliquable pour drill-down.
- [ ] Dashboard Overview plus riche : top identifiants/mots de passe
      testés, durée moyenne de session, IP uniques (jour/semaine),
      leaderboard "top offenders" (IP, pays, nb sessions, dernière vue)
      cliquable vers la page IP.
- [ ] Page IP détail : enrichir avec ASN/organisation, reverse DNS, lien
      vers AbuseIPDB.
- [ ] `TimelineChart` : brush/zoom sur une plage de dates (au lieu du
      sélecteur de période uniquement), clic sur un point → filtre la
      table sessions.
- [ ] Flux d'activité en direct — journal chronologique de tous les
      événements (sessions, bans, tentatives sshd) façon SIEM light.
- [ ] Page Alertes — seuils configurables (ex : notifier si >N attaques/heure).
- [ ] Responsive layout — en pause : le besoin n'est pas mobile/téléphone en
      priorité, à revoir après les autres idées UI ci-dessus.

## Sécurité / ops

- [x] Confirmer que le dashboard (données IP/commandes/replays des
      attaquants) est bien derrière une authentification — confirmé par le
      propriétaire : Nginx Proxy Manager impose un username/password (Access
      List / basic auth) avant tout accès au site. L'app elle-même n'a aucune
      auth : NPM est la seule barrière.
- [x] Verrou du bouton Ban : confirmation, `ADMIN_IPS` refusées par l'API et
      `/etc/honeypot/never-ban` par le worker hôte (pas d'auto-lockout SSH),
      `X-Frame-Options: DENY` + `frame-ancestors 'none'` (plus de clickjacking).
- [x] Exclure l'IP admin des statistiques : décidé de NE PAS le faire (2026-11-01).
      Les sessions de test du propriétaire restent visibles ; la liste des IP
      protégées (page Réglages) ne sert qu'à interdire le ban.
- [ ] Reste : `/ban` et `/unban` joignables sans auth depuis les autres
      conteneurs du réseau `nginx-proxy-network` (contourne NPM). Piste : réseau
      Docker dédié dashboard ↔ NPM, ou secret partagé sur les routes d'écriture.
- [x] Fail2Ban peut deban des ip donc affiche toujours ban mais peut etre pas : la page IP liste les bans
      en cours (jail, ce qu'ils bloquent, fin), expirés au bantime de leur jail.
- [x] Bouton de ban dans le dashboard (jails `manual` / `manual-all`, portée au choix).
- [x] Logique de ban revue (2026-11-04) : jail `sshd` aveugle sur Debian 12 (journal `ssh.service`, pas
      `sshd.service` : 0 ligne vs 70 938 en 7 j), bans sur INPUT seulement (ne couvraient ni Docker ni
      les sites), Cowrie déconnecté de fail2ban, jails avec tiret jamais lues (`npm-badbots`). Remplacé
      par `honeypot.local` : « le honeypot observe, les vrais services sont protégés ».
- [ ] Synchroniser la liste des IP protégées de la page Réglages avec `/etc/honeypot/never-ban` (et donc
      l'`ignoreip` de fail2ban) : aujourd'hui il faut l'ajouter aux deux endroits.
- [ ] Bans IPv6 sur Cowrie : docker-proxy présente les clients IPv6 comme la passerelle du réseau
      honeypot, donc la jail `cowrie` ne peut pas les voir (ni les bannir).