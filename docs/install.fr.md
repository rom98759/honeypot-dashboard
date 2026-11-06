# Guide d'installation

[English](install.md) · [README](../README.fr.md)

Ce guide installe Cowrie + le dashboard sur un serveur exposé à Internet. Lis-le une fois en entier
avant de taper quoi que ce soit. Les commandes se lancent **en root** sauf mention contraire.

> [!CAUTION]
> **Cowrie écoute sur le port 22, le port SSH standard.** Si ton vrai serveur SSH est encore sur 22
> quand la stack démarre, soit Cowrie ne démarre pas, soit, après un redémarrage, Cowrie prend le port et
> **tu ne peux plus te connecter**. L'étape 0 déplace ton vrai SSH sur un autre port (`SSHD_PORT`).
> L'installeur le vérifie et refuse de tourner sinon, mais il ne modifie jamais SSH à ta place : cette
> partie, c'est toi qui la fais.

## Sommaire

0. [Déplacer le vrai SSH hors du port 22](#étape-0--déplacer-le-vrai-ssh-hors-du-port-22)
1. [Prérequis](#étape-1--prérequis)
2. [Récupérer le code et une clé GeoIP](#étape-2--récupérer-le-code-et-une-clé-geoip)
3. [Configurer](#étape-3--configurer)
4. [Installer la partie hôte](#étape-4--installer-la-partie-hôte)
5. [Démarrer les conteneurs](#étape-5--démarrer-les-conteneurs)
6. [Mettre le dashboard derrière un reverse proxy](#étape-6--mettre-le-dashboard-derrière-un-reverse-proxy)
7. [Vérifier que tout marche](#étape-7--vérifier-que-tout-marche)
8. [Options : ban depuis le dashboard, AbuseIPDB](#étape-8--options)

[Mise à jour](#mise-à-jour) · [Désinstallation](#désinstallation) · [Dépannage](#dépannage)

---

## Étape 0 — Déplacer le vrai SSH hors du port 22

Choisis un port libre, noté `SSHD_PORT` ci-dessous (ce guide utilise **50022**). Évite 2222 : c'est
le port interne de Cowrie et une cible courante des scanners.

**Les règles qui te protègent :**

- Garde ta session SSH actuelle **ouverte** tant que le nouveau port n'est pas validé depuis un second terminal.
- Ouvre le nouveau port dans **tous** les pare-feu d'abord : ufw sur le serveur **et** le pare-feu /
  groupe de sécurité de ton hébergeur, s'il y en a un.
- Sache comment accéder à la **console web ou au mode rescue** de ton hébergeur avant de commencer.
  C'est le seul retour possible si tu te bloques dehors.

```bash
# 1. Autoriser le nouveau port (ufw "limit" marche aussi et limite le brute force)
ufw allow 50022/tcp
#    + autoriser 50022/tcp dans le pare-feu de l'hébergeur s'il en a un

# 2. Régler le port dans un fichier dédié et valider la configuration
echo "Port 50022" > /etc/ssh/sshd_config.d/10-port.conf
grep -rn '^Port' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/   # seul "Port 50022" doit rester
sshd -t                                                           # aucune sortie = OK

# 3. Appliquer
systemctl restart ssh
#    Ubuntu 22.10+ utilise l'activation par socket : si `systemctl is-active ssh.socket` répond active,
#    lancer à la place : systemctl daemon-reload && systemctl restart ssh.socket

# 4. Vérifier que sshd n'écoute plus que sur le nouveau port
ss -ltnp | grep sshd        # attendu : :50022, et PAS :22
```

**Depuis un nouveau terminal sur ta machine** (garde l'ancien ouvert) :

```bash
ssh -p 50022 <utilisateur>@<serveur>
```

Seulement quand ça marche, rends-le permanent sur ta machine (`~/.ssh/config`) :

```
Host monserveur
    HostName <serveur>
    Port 50022
    User <utilisateur>
```

Tu peux alors fermer l'ancienne session. Vivement conseillé au passage : connexion par clé uniquement
(`PasswordAuthentication no` dans un autre fichier de `sshd_config.d`, `sshd -t`, redémarrage).

> [!NOTE]
> La règle ufw du port 22 peut rester ou partir, ça ne change rien pour Cowrie : les ports publiés par
> Docker contournent complètement ufw. Ce qui protège le reste de l'hôte, c'est la chaîne `DOCKER-USER`
> gérée par ce projet et tes propres règles ufw pour les services de l'hôte.

## Étape 1 — Prérequis

- Debian 12 (Ubuntu 22.04+ marche pareil), systemd, accès root, ~1 Go de RAM, ~2 Go de disque.
- Docker Engine avec le plugin Compose ([installation officielle](https://docs.docker.com/engine/install/debian/)).
- fail2ban, git, python3 (utilisé par le worker de ban), curl :

```bash
apt update && apt install -y fail2ban python3-systemd git python3 curl
```

Sur Debian 12, `systemctl status fail2ban` peut alors afficher **failed** (« Have not found any log file
for sshd jail ») : la jail par défaut de Debian cherche `/var/log/auth.log`, qui n'existe plus (les logs
sont dans le journal systemd). C'est attendu : l'étape 4 installe une jail sshd en `backend = systemd`
et redémarre fail2ban.

- Un reverse proxy qui tourne dans Docker (par ex. Nginx Proxy Manager, Traefik ou Caddy) et le nom de
  son réseau Docker. Sans reverse proxy, voir l'[étape 6](#étape-6--mettre-le-dashboard-derrière-un-reverse-proxy).

## Étape 2 — Récupérer le code et une clé GeoIP

```bash
git clone https://github.com/rom98759/honeypot-dashboard.git /opt/honeypot-dashboard
cd /opt/honeypot-dashboard
```

La carte et les pays ont besoin des bases gratuites MaxMind GeoLite2 : crée un compte sur
<https://www.maxmind.com/en/geolite2/signup>, puis *Manage license keys → Generate new license key*.
Note l'identifiant de compte et la clé. Sans eux, tout marche sauf la géolocalisation.

## Étape 3 — Configurer

Deux fichiers, tous deux en `chmod 600`, jamais commités.

```bash
install -D -m 600 scripts/host.env.example /etc/honeypot-dashboard/host.env
install -m 600 .env.example .env
```

### `/etc/honeypot-dashboard/host.env` (côté hôte, lu par l'installeur et les scripts qu'il installe)

| Clé | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `SSHD_PORT` | oui | — | Port de ton vrai sshd (étape 0). Jamais 22. |
| `REPO_DIR` | non | le clone d'où l'installeur est lancé | Où tu as cloné le dépôt. Les fichiers GeoIP vont dans `$REPO_DIR/geoip`. L'installeur l'ajoute à host.env s'il manque. |
| `HONEYPOT_SUBNET` | non | `172.21.0.0/16` | Réseau de Cowrie. Doit être identique à `HONEYPOT_SUBNET` dans `.env`. À changer seulement s'il entre en conflit avec un réseau Docker existant (`docker network inspect` pour vérifier). |
| `COWRIE_PORT` | non | `22` | Port de l'hôte où Cowrie est publié. Les bans de portée « services » le laissent ouvert. |
| `COWRIE_JSON` | non | déduit | Log JSON de Cowrie vu depuis l'hôte, lu par la jail `cowrie`. Vide = `/var/lib/docker/volumes/<COWRIE_VAR_VOLUME>/_data/log/cowrie/cowrie.json`. |
| `WAN_IFACE` | non | interface de la route par défaut | Interface côté Internet, utilisée par les filtres WAN optionnels. |
| `CLOUDFLARE_ONLY` | non | `0` | `1` = les ports publiés 80/443 n'acceptent que les plages IP Cloudflare. Seulement si ton DNS passe par le proxy Cloudflare. |
| `BLOCK_PORTS` | non | vide | Ports de conteneurs publiés à bloquer depuis Internet, séparés par des espaces, par ex. `81` pour une interface d'admin de proxy que tu joins par tunnel SSH. |
| `FBAN_ENABLED` | non | `0` | `1` = installe le worker qui permet au dashboard de bannir/débannir (voir étape 8). |
| `MAXMIND_ACCOUNT_ID` | non | vide | Identifiant de compte MaxMind (étape 2). |
| `MAXMIND_LICENSE_KEY` | non | vide | Clé de licence MaxMind (étape 2). |

### `.env` (conteneurs, lu par `docker compose`)

| Clé | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `SSHD_PORT` | conseillé | vide | Même valeur que dans host.env ; affiché sur la page Corrélation. |
| `COWRIE_PORT` | non | `22` | Port hôte publié pour Cowrie. |
| `COWRIE_IMAGE` | non | `cowrie/cowrie:latest` | Image Cowrie ; fige un tag pour une installation parfaitement reproductible. |
| `HONEYPOT_SUBNET` | non | `172.21.0.0/16` | Doit être identique à host.env : le blocage de sortie vise ce sous-réseau. |
| `PROXY_NETWORK` | oui | `nginx-proxy-network` | Réseau Docker de ton reverse proxy. Il doit déjà exister. |
| `COWRIE_ETC_VOLUME` | non | `honeypot-cowrie-etc` | Noms des volumes. À changer seulement pour réutiliser les volumes d'une ancienne installation. |
| `COWRIE_VAR_VOLUME` | non | `honeypot-cowrie-var` | Logs et sessions enregistrées de Cowrie. |
| `DASHBOARD_DATA_VOLUME` | non | `honeypot-dashboard-data` | Base SQLite du dashboard. |
| `GEOIP_DIR` | non | `./geoip` | Emplacement des fichiers GeoLite2 `.mmdb`. |
| `ADM_GID` | non | `4` | GID du groupe `adm`, qui peut lire `/var/log/honeypot-export` (`getent group adm`). |
| `FBAN_ENABLED` | non | `0` | `1` = affiche les boutons Bannir/Débannir. Nécessite aussi `FBAN_ENABLED=1` dans host.env. |
| `ADMIN_IPS` | non | vide | Tes propres IP/CIDR, séparées par des virgules : jamais bannissables depuis le dashboard. D'autres peuvent être ajoutées dans la page Réglages. |
| `ABUSEIPDB_API_KEY` | non | vide | Clé gratuite [AbuseIPDB](https://www.abuseipdb.com/) pour la réputation des IP. Vide = désactivé. |

## Étape 4 — Installer la partie hôte

```bash
scripts/install-host.sh --dry-run    # vérifications + liste de chaque action, ne change rien
scripts/install-host.sh
```

Ce que vérifie l'installeur, et quoi faire s'il s'arrête (code de sortie 2, rien n'a été modifié) :

| Message | Cause | Correction |
|---|---|---|
| `SSH LOCKOUT RISK` + `sshd still listens on port 22` | étape 0 pas faite ou pas appliquée | terminer l'étape 0 (redémarrer ssh) |
| `sshd listens on X but SSHD_PORT is Y` | host.env et sshd ne sont pas d'accord | corriger l'un des deux |
| `ufw is active but has no rule for port …` | le nouveau port n'est pas autorisé | `ufw allow <SSHD_PORT>/tcp` |
| `WARNING: ufw is not active` | non bloquant | vérifier que le pare-feu de l'hébergeur autorise `SSHD_PORT` et 22 |
| `REPO_DIR=… does not contain docker-compose.yml` | mauvais `REPO_DIR` | le pointer vers ton clone, ou supprimer la ligne |
| `host.env must be owned by root and not group/world-writable` | droits trop larges (il est exécuté en root) | `chown root: /etc/honeypot-dashboard/host.env && chmod 600 …` |

Ce qu'il installe (tout est idempotent, relançable à tout moment) :

- `/usr/local/sbin/` : `fail2ban-export.sh`, `sshd-auth-export.sh`, `docker-user-firewall.sh`,
  `geoip-update.sh`, `cowrie-downloads-perms.py` (+ `fban-queue-worker.sh` si `FBAN_ENABLED=1`).
- Unités systemd activées : `fail2ban-export.timer` (chaque minute), `sshd-auth-export.timer`
  (toutes les 5 min), `docker-user-firewall.service` + `.timer` (au boot, à chaque redémarrage de Docker,
  toutes les 10 min), `geoip-update.timer` (mensuel ; premier téléchargement immédiat si la clé est
  renseignée), `fban-queue-worker.path` (si activé), `cowrie-downloads-perms.path` (voir plus bas).
- `/etc/logrotate.d/honeypot-export`, `/var/log/honeypot-export/` (root:adm 750),
  `/etc/honeypot/never-ban` (créé vide, jamais écrasé).
- `/etc/fail2ban/jail.d/honeypot.local` (+ `action.d/honeypot-block.conf`, `filter.d/honeypot-*.conf`,
  `/usr/local/sbin/honeypot-ban.sh`) : les jails décrites dans [Fonctionnement des bans](#fonctionnement-des-bans).
  Il est régénéré à chaque passage (modifie `host.env` / `never-ban`, pas le fichier) et, en tant que
  `jail.d/*.local`, il l'emporte sur ton propre `jail.local`. L'installeur le vérifie avec
  `fail2ban-client -t` avant de recharger et remet l'ancien fichier si fail2ban le refuse.

Cowrie range les fichiers téléchargés ou déposés par les attaquants dans `lib/cowrie/downloads/<sha256>`
de son volume, en mode 600 : le dashboard (un autre utilisateur) peut les lister mais pas les zipper.
`cowrie-downloads-perms.path` surveille ce répertoire (déduit de `COWRIE_JSON`, ou de `COWRIE_VAR_VOLUME`
dans `.env`) et ajoute la lecture pour les autres à chaque nouvel échantillon. `/var/lib/docker` n'est
accessible qu'à root : aucun utilisateur de l'hôte n'y gagne d'accès. Le script ne suit jamais de lien et
ne touche que des fichiers réguliers nommés comme un SHA-256.

L'installeur lui-même ne touche **jamais** à sshd ni à ufw. Les règles de ban vivent dans une chaîne
`hp-<jail>` par jail, appelée depuis `INPUT` et `DOCKER-USER` ; les autres règles pare-feu vont uniquement
dans `DOCKER-USER`.

### Fonctionnement des bans

Le honeypot observe, les vrais services sont protégés :

| Jail | Déclenchée par | Durée | Bloque |
|---|---|---|---|
| `cowrie` | toute connexion ou tentative de login sur Cowrie | 1 jour | les vrais services (sshd, sites, autres ports), **pas** Cowrie |
| `sshd` | 2 échecs sur le vrai sshd (`mode = aggressive`) | 7 jours | les vrais services |
| `recidive` | 3 bans en une semaine, toutes jails | 30 jours | les vrais services |
| `npm-badbots` | ta propre jail, si tu l'as définie | son bantime | les vrais services |
| `manual` | bouton Bannir du dashboard, « Vrais services » | 7 jours | les vrais services |
| `manual-all` | bouton Bannir du dashboard, « Tout bloquer » | 7 jours | tout, Cowrie compris |

« Vrais services » = tout l'hôte sauf tcp/`COWRIE_PORT`, et tous les conteneurs sauf le réseau du
honeypot : un robot banni continue de parler à Cowrie, donc tu continues de l'enregistrer, mais ne peut
plus joindre ton sshd ni tes sites. Jamais bannis : `127.0.0.1`, `::1`, `HONEYPOT_SUBNET` (Cowrie voit
les clients IPv6 comme sa passerelle Docker), chaque entrée de `/etc/honeypot/never-ban`, et les IP
protégées du dashboard (`ADMIN_IPS` + page Réglages). Le dashboard écrit ces dernières dans
`/opt/honeypot/fban-queue/admin-networks` ; fail2ban interroge `/usr/local/sbin/honeypot-never-ban.sh`
avant chaque ban (`ignorecommand`), donc une adresse ajoutée dans Réglages est protégée tout de suite,
sans rechargement. Les entrées de ce fichier plus larges que /16 (IPv4) ou /48 (IPv6) sont ignorées,
puisque le conteneur peut l'écrire.

Debian 12 journalise sshd sous `ssh.service` ; la jail d'origine cherche `sshd.service` et ne voit donc
aucun échec. `honeypot.local` pose le bon `journalmatch`. La jail `sshd` bannit 7 jours après 2 échecs :
**mets tes propres adresses dans `never-ban` avant d'installer**, sinon une faute de frappe te bloque une
semaine (secours : la console de ton hébergeur, `fail2ban-client unban <ip>`).

Le dashboard compte un ban comme actif jusqu'à sa ligne `Unban` ou la fin du bantime de sa jail ; si tu
changes un bantime, mets `FAIL2BAN_BANTIMES` (`jail=secondes,…`) dans `.env` pour qu'il suive.

## Étape 5 — Démarrer les conteneurs

```bash
docker network ls | grep "$(grep ^PROXY_NETWORK= .env | cut -d= -f2)"   # doit exister
docker compose up -d --build
docker compose ps                                                        # les deux "Up"
docker compose logs --tail=20 dashboard
```

Le premier build prend quelques minutes (frontend + image Python).

## Étape 6 — Mettre le dashboard derrière un reverse proxy

Le dashboard n'a **pas d'authentification**. Ne le publie jamais directement.

Dans ton reverse proxy, crée un site pour un (sous-)domaine à toi qui renvoie vers
`http://honeypot-dashboard:8000` via le réseau `PROXY_NETWORK`, avec TLS, et **ajoute une couche
d'authentification** (basic auth, SSO, liste d'IP autorisées...). Pour Nginx Proxy Manager : *Proxy Host*
(forward hostname `honeypot-dashboard`, port `8000`), onglet *SSL*, et une *Access List* avec un utilisateur.

> **Limite connue :** cette authentification n'existe que dans le proxy. Tout autre conteneur du réseau
> `PROXY_NETWORK` peut joindre `honeypot-dashboard:8000` directement, tout lire et utiliser ban/unban
> (le contrôle d'Origin n'arrête que les navigateurs). Si tu ne fais pas confiance à tous les conteneurs
> de ce réseau, donne au dashboard un réseau à lui partagé uniquement avec le proxy, et mets-le dans `PROXY_NETWORK`.

Sans reverse proxy, passe par un tunnel SSH : ajoute temporairement
`ports: ["127.0.0.1:8000:8000"]` au service `dashboard`, puis
`ssh -p 50022 -L 8000:127.0.0.1:8000 <utilisateur>@<serveur>` et ouvre <http://localhost:8000>.

## Étape 7 — Vérifier que tout marche

```bash
# Le vrai SSH marche toujours (depuis ta machine, NOUVEAU terminal)
ssh -p 50022 <utilisateur>@<serveur>

# Le port 22 répond avec Cowrie
ssh -o StrictHostKeyChecking=no root@<serveur>      # n'importe quel mot de passe sauf "root" : faux shell ; taper `exit`

# Ingestion : chaque source annonce un retard de 0 octet
docker compose exec -T dashboard python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"

# Pare-feu : le blocage de sortie du honeypot est en place
iptables -S DOCKER-USER | grep "honeypot: no egress"

# Les timers sont planifiés
systemctl list-timers | grep -E 'fail2ban-export|sshd-auth-export|docker-user-firewall|geoip-update'
```

Ta session de test doit apparaître dans la page Sessions en quelques secondes. La source fail2ban peut
rester vide tant que fail2ban n'a banni personne : c'est normal.

## Étape 8 — Options

**Bannir/débannir depuis la page IP.** Mets `FBAN_ENABLED=1` dans `host.env` et dans `.env`, ajoute tes
propres IP dans `ADMIN_IPS` et dans `/etc/honeypot/never-ban` (une par ligne), puis :

```bash
scripts/install-host.sh && docker compose up -d
```

Le dashboard écrit les demandes dans `/opt/honeypot/fban-queue/` ; une unité systemd path lance le worker,
qui n'accepte que `ban manual|manual-all <ip>`, `unban all <ip>` et `status all <ip>`, refuse les adresses
de `never-ban` et appelle `fail2ban-client`. Le bouton Bannir demande une portée : « Vrais services »
(jail `manual`, Cowrie continue d'observer l'IP) ou « Tout bloquer » (jail `manual-all`), 7 jours chacune ;
Débannir retire l'IP de toutes les jails. La page IP liste les bans en cours, ce qu'ils bloquent et jusqu'à
quand. Bannir ta propre IP te bloque dehors, d'où les deux listes d'exclusion et la confirmation.

**AbuseIPDB.** Mets ta clé dans `ABUSEIPDB_API_KEY` puis `docker compose up -d`.

## Mise à jour

```bash
cd /opt/honeypot-dashboard
git pull
scripts/install-host.sh            # met à jour les scripts/unités installés s'ils ont changé
docker compose up -d --build
docker compose pull cowrie && docker compose up -d cowrie   # nouvelle image Cowrie
```

## Désinstallation

```bash
docker compose down                     # ajouter -v pour supprimer aussi les volumes (toutes les données !)
scripts/install-host.sh --uninstall     # retire scripts, unités, fichiers de jails ; garde logs, never-ban, host.env
systemctl restart docker                # vide les règles DOCKER-USER
```

Remets ensuite ton vrai SSH sur 22 si tu le souhaites, avec les mêmes précautions qu'à l'étape 0.

## Dépannage

- **Page Fichiers : le bouton Zip répond 503 « not readable yet »** : relancer l'installeur, puis
  `systemctl status cowrie-downloads-perms.path` et `systemctl start cowrie-downloads-perms.service`.
  Un fichier sans bouton Zip est un fichier dont Cowrie n'a pas gardé de copie (téléchargement raté…).
- **Bandeau santé « stalled » sur une source** : `systemctl status fail2ban-export.timer sshd-auth-export.timer`,
  `ls -l /var/log/honeypot-export/`. Le conteneur monte le *répertoire* : ne jamais bind-monter un fichier de
  log seul (l'inode est figé et l'ingestion s'arrête à la rotation suivante).
- **`docker compose up` échoue avec « port is already allocated » sur 22** : sshd écoute encore sur 22.
  Retour à l'étape 0.
- **« network … declared as external, but could not be found »** : mauvais `PROXY_NETWORK`, vérifier `docker network ls`.
- **Carte vide** : pas de fichiers GeoLite2 dans `geoip/`. `systemctl start geoip-update.service` puis
  `journalctl -u geoip-update.service`.
- **Règles pare-feu** : `docker-user-firewall.sh --print-rules` montre ce que produit la config,
  `--dry-run` la valide contre les tables actuelles.
- **Logs de Cowrie lui-même** : `scripts/cowrie-logs.sh text 100`, `follow`, `downloads`.
