---
paths:
  - "app/campaigns_stats.py"
  - "app/command_normalize.py"
  - "app/fingerprint_stats.py"
  - "app/session_files.py"
  - "app/zipcrypto.py"
  - "app/routers/campaigns*.py"
  - "app/routers/files*.py"
  - "frontend/src/pages/CampaignsPage/**"
  - "frontend/src/pages/FilesPage/**"
---
# Campagnes et fichiers capturés

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
