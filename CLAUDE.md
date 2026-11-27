# CLAUDE.md — honeypot-dashboard

## But
Dashboard self-hosted pour un honeypot Cowrie (SSH/Telnet) sur le VPS OVH. Ingère le JSON Cowrie, le log
fail2ban et un log d'auth sshd dans SQLite ; sert vue d'ensemble, sessions (replay terminal), carte,
corrélation honeypot / sshd réel / bans, page IP (enrichissement, ban/unban). Statut : actif, perso, déployé.
Doc publique bilingue : `README.md`/`README.fr.md`, `docs/install.md`/`docs/install.fr.md`
(à garder synchronisées : `tests/test_docs.py` vérifie que chaque clé de config y figure).

## Architecture (carte)
- Backend FastAPI + SQLite brut (pas d'ORM) : `app/` (`main.py` create_app, ingesters, `routers/`). Tests : `tests/`.
- Frontend React + TS + Vite : `frontend/`.
- Hôte : `scripts/` (export des logs, worker de ban, pare-feu DOCKER-USER, `install-host.sh`).
- Le détail est dans `.claude/rules/`, chargé seulement quand on touche les fichiers concernés :
  `backend.md` (app/, tests/), `ingestion-host.md` (ingestion, ban, scripts hôte, compose),
  `campaigns-files.md` (campagnes, fichiers capturés), `frontend.md` (front, langage de recherche).

## Commandes
```bash
.venv/bin/uvicorn app.main:app --reload        # backend dev (:8000)
cd frontend && npm run dev                      # frontend dev, proxy /api -> localhost:8000
.venv/bin/pytest                                # tests backend (deps : pip install -r requirements-dev.txt)
cd frontend && npm test                         # tests frontend (vitest, Node 24 comme la CI)
cd frontend && npm run build                    # tsc -b && vite build (aussi fait par le Dockerfile)
docker compose up -d --build                    # build/run local ou VPS
# Déploiement (après merge sur origin/main) :
ssh vps 'cd honeypot-dashboard && git pull && docker compose up -d --build'
```
Lint Python : `.venv/bin/ruff check .` (config dans `pyproject.toml`, aussi en CI) ; pas de formateur
imposé, imiter le style existant. Pas de lint front (typescript-eslint ne supporte pas encore TS 7).
Après déploiement : `docker compose ps` et
`docker compose logs --tail=20 dashboard`.

## Conventions du projet
- Un bug = un commit = un cycle de déploiement.
- Dépôt public, `main` protégé (ruleset) : TOUT passe par une PR squash, typos comprises (pas de push direct,
  ce projet déroge à la règle globale) ; merge seulement quand la CI GitHub Actions est verte (Backend tests,
  Frontend tests and build, ShellCheck, Docker image builds). Backlog = issues GitHub, pas TODO.md.
- Jamais de vraie IP, de domaine, de port SSH réel, de nom d'hôte ni de chemin `/home/...` dans un fichier
  suivi : le test anti-fuite (`tests/test_docs.py::test_no_owner_specific_values_tracked`) et le hook git
  global lisent `.owner-patterns` (non suivi) ; le copier depuis `~/backups/honeypot-publish/owner-patterns.txt`
  dans chaque worktree.
- Déboguer avec des données réelles du VPS (sqlite du conteneur, vrais ttylogs) plutôt que des fixtures seules.
- Sur le VPS, `~/honeypot-dashboard/` cohabite avec `~/budget/` (autre app) : vérifier le dossier avant `git pull`.
- `docs/superpowers/` est dans `.gitignore` (specs/plans locaux, jamais commités).
