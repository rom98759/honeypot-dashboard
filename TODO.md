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
- [x] B2. Fichiers : événements `file_download` / `file_upload` ingérés (+ rattrapage des logs), onglet
      « Fichiers » du panneau session, page Fichiers par SHA-256, lien VirusTotal, zip chiffré « infected ».
- [x] C. Recherche avancée : barre de requête + chips (`?filter=`) sur Vue d'ensemble, Carte, Sessions,
      Commandes.
- [x] Dépendances : FastAPI 0.162 / Starlette 1.10 / urllib3 2.8 (Starlette 0.38, transitive, avait
      14 avis publiés que Dependabot ne signalait pas) ; `npm audit` à 0.
- [x] Déjà livré parmi les idées de départ : index `commands`/`ttylogs(session_id)`, replay en une seule
      requête, page Commandes, heatmap jour × heure, distribution des durées, top identifiants et mots de
      passe, graphiques cliquables qui filtrent, période partagée entre les pages, recherche globale (barre
      latérale), page IP enrichie (ASN, rDNS, AbuseIPDB), export JSON / .cast d'une session, mise en page mobile.

## Idées restantes : suivies en issues GitHub

- #3 Pages Campagnes et Fichiers filtrables par la barre de recherche
- #4 Premier affichage de la Vue d'ensemble sur « all » plus rapide
- #5 Thème sombre
- #6 Répartition des bans par jail fail2ban
- #7 Export CSV des sessions et de l'historique d'une IP
- #8 Sélection d'une plage de dates sur la timeline
- #9 Flux d'activité en direct
- #10 Alertes sur seuil
- #11 Vraies IP IPv6 dans Cowrie (et bans IPv6)

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
- [x] `/ban` et `/unban` joignables depuis les autres conteneurs du réseau proxy : limite
      documentée (install.md), à régler côté config VPS (réseau dédié dashboard ↔ NPM), hors projet.
- [x] Fail2Ban peut deban des ip donc affiche toujours ban mais peut etre pas : la page IP liste les bans
      en cours (jail, ce qu'ils bloquent, fin), expirés au bantime de leur jail.
- [x] Bouton de ban dans le dashboard (jails `manual` / `manual-all`, portée au choix).
- [x] Logique de ban revue (2026-11-04) : jail `sshd` aveugle sur Debian 12 (journal `ssh.service`, pas
      `sshd.service` : 0 ligne vs 70 938 en 7 j), bans sur INPUT seulement (ne couvraient ni Docker ni
      les sites), Cowrie déconnecté de fail2ban, jails avec tiret jamais lues (`npm-badbots`). Remplacé
      par `honeypot.local` : « le honeypot observe, les vrais services sont protégés ».
- [x] IP protégées de la page Réglages appliquées aussi aux bans automatiques : fichier `admin-networks`
      dans la queue, lu par `honeypot-never-ban.sh` (ignorecommand fail2ban + worker), sans rechargement.
- [x] Clients IPv6 vus comme la passerelle du réseau honeypot (docker-proxy) : affichés « IPv6 (IP inconnue) »,
      exclus des tops IP et de Corrélation (`app/proxied_ip.py`). ~1 session/jour en prod.
- [ ] Vraies IP IPv6 dans Cowrie (et bans IPv6) : voir #11.
