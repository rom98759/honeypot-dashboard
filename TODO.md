# TODO

## Frontend / refonte visuelle

- [ ] Panneau détail session : afficher les métadonnées de connexion (IP, port
      source, protocole, login/password tentés, succès ou non, connect/close
      time, durée) même quand il n'y a ni commande ni replay disponible.
      Les données existent déjà via `/api/sessions/{id}` (champ `session`),
      seul l'affichage manque (`static/js/pages/sessions.js` → `openSessionPanel`).
- [ ] Vérifier le libellé "Tentatives port 50022" (page Corrélation) — c'est un
      texte en dur qui suppose que le port réel du sshd est 50022
      (`static/app.js` → `renderCorrelation`). À rendre dynamique ou au moins
      vérifier qu'il correspond toujours à la conf actuelle du VPS.

## Backend / perf

- [ ] Ajouter des index sur `commands(session_id)` et `ttylogs(session_id)`
      (`app/db.py`). Les deux sont interrogées par `session_id` à chaque
      ouverture du détail d'une session (`app/routers/sessions.py`) mais ne
      sont pas indexées — même pattern que l'indexation manquante déjà
      corrigée pour `currently_banned` (commit 6b31f43).
- [ ] Replay session : `openSessionPanel` fait un `fetch` juste pour tester
      `response.ok`, puis `AsciinemaPlayer.create()` refait une requête
      identique — double lecture/parsing des ttylogs côté serveur à chaque
      ouverture de session (`static/js/pages/sessions.js`).

## Sécurité / ops

- [ ] Confirmer que le dashboard (données IP/commandes/replays des
      attaquants) est bien derrière une authentification (Cloudflare Access,
      basic auth via NPM...) et pas exposé publiquement en clair.
