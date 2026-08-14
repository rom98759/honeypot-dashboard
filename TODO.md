# TODO

## Bugs

- [ ] Timestamps affichés bruts en UTC (ex : `2026-08-14T10:18:44.673383Z`
      au lieu de 12h18 heure locale) — `{c.timestamp}` /
      `{e.timestamp}` non formatés dans `SessionDetailPanel.tsx:87` et
      `IpDetailPage.tsx:178/222`. Formater partout avec `toLocaleString`
      (fuseau navigateur ou forcé `Europe/Paris`).
- [ ] Replay session : le texte du terminal s'affiche mais décalé dans le
      temps par rapport à la vidéo/frappe réelle. À investiguer côté
      `app/ttyplayer.py` (`_select_events`, concaténation des ttylogs
      multi-fichiers sur la timeline globale) plutôt que côté player JS —
      suivre systematic-debugging.

## Frontend / refonte visuelle

- [ ] Vérifier le libellé "Tentatives port 50022" (page Corrélation) — c'est un
      texte en dur qui suppose que le port réel du sshd est 50022
      (`frontend/src/pages/CorrelationPage.tsx`). À rendre dynamique
      ou au moins vérifier qu'il correspond toujours à la conf actuelle du VPS.

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

- [ ] Confirmer que le dashboard (données IP/commandes/replays des
      attaquants) est bien derrière une authentification (Cloudflare Access,
      basic auth via NPM...) et pas exposé publiquement en clair.
- [ ] Fail2Ban peut deban des ip donc affiche toujours ban mais peut etre pas. Afficher reelement les informations en cours et historique des ip ban/unban
- [ ] Ajouter un mecanisme de ban en cliqaint sur un bouton dans le dashboard pour bannir une ip directement depuis l'interface.