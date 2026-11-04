# Installation guide

[Français](install.fr.md) · [README](../README.md)

This guide installs Cowrie + the dashboard on a server exposed to the Internet. Read it once
fully before typing anything. Commands are run **as root** unless stated otherwise.

> [!CAUTION]
> **Cowrie listens on port 22, the standard SSH port.** If your real SSH server is still on 22 when
> the stack starts, either Cowrie fails to start or, after a reboot, Cowrie wins the port and **you
> can no longer log in**. Step 0 moves your real SSH to another port (`SSHD_PORT`). The installer
> checks it and refuses to run otherwise, but it never changes SSH for you: that part is yours.

## Contents

0. [Move your real SSH server off port 22](#step-0--move-your-real-ssh-server-off-port-22)
1. [Requirements](#step-1--requirements)
2. [Get the code and a GeoIP key](#step-2--get-the-code-and-a-geoip-key)
3. [Configure](#step-3--configure)
4. [Install the host side](#step-4--install-the-host-side)
5. [Start the containers](#step-5--start-the-containers)
6. [Put the dashboard behind a reverse proxy](#step-6--put-the-dashboard-behind-a-reverse-proxy)
7. [Check that everything works](#step-7--check-that-everything-works)
8. [Optional: ban from the dashboard, AbuseIPDB](#step-8--optional-features)

[Upgrade](#upgrade) · [Uninstall](#uninstall) · [Troubleshooting](#troubleshooting)

---

## Step 0 — Move your real SSH server off port 22

Pick a free port, written `SSHD_PORT` below (this guide uses **50022**). Avoid 2222: it is
Cowrie's internal port and a common scanner target.

**Rules that keep you safe:**

- Keep your current SSH session **open** until the new port is proven to work from a second terminal.
- Open the new port in **every** firewall first: ufw on the server **and** your hosting provider's
  firewall / security group, if there is one.
- Know how to reach your provider's **web console or rescue mode** before you start. That is the
  only way back if you get locked out.

```bash
# 1. Allow the new port (ufw "limit" also works and rate-limits brute force)
ufw allow 50022/tcp
#    + allow 50022/tcp in your provider's firewall if it has one

# 2. Set the port in a drop-in file and validate the configuration
echo "Port 50022" > /etc/ssh/sshd_config.d/10-port.conf
grep -rn '^Port' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/   # only "Port 50022" must remain
sshd -t                                                           # no output = OK

# 3. Apply it
systemctl restart ssh
#    Ubuntu 22.10+ uses socket activation: if `systemctl is-active ssh.socket` says active,
#    run instead: systemctl daemon-reload && systemctl restart ssh.socket

# 4. Check that sshd now listens only on the new port
ss -ltnp | grep sshd        # expect :50022, and NO :22
```

**From a new terminal on your own machine** (keep the old one open):

```bash
ssh -p 50022 <user>@<server>
```

Only when this works, make it permanent on your machine (`~/.ssh/config`):

```
Host myserver
    HostName <server>
    Port 50022
    User <user>
```

You may now close the old session. Strongly recommended while you are here: key-only login
(`PasswordAuthentication no` in another `sshd_config.d` file, `sshd -t`, restart).

> [!NOTE]
> Leave ufw's rule for port 22 as it is or remove it, it does not matter for Cowrie: Docker-published
> ports bypass ufw entirely. What protects the rest of the host is the `DOCKER-USER` chain managed
> by this project and your own ufw rules for host services.

## Step 1 — Requirements

- Debian 12 (Ubuntu 22.04+ works the same), systemd, root access, ~1 GB RAM, ~2 GB disk.
- Docker Engine with the Compose plugin ([official install](https://docs.docker.com/engine/install/debian/)).
- fail2ban, git, python3 (used by the ban worker), curl:

```bash
apt update && apt install -y fail2ban python3-systemd git python3 curl
```

On Debian 12, `systemctl status fail2ban` may now show **failed** ("Have not found any log file for
sshd jail"): Debian's default jail looks for `/var/log/auth.log`, which no longer exists (logs are in
the systemd journal). That is expected: step 4 installs an sshd jail with `backend = systemd` and
restarts fail2ban.

- A reverse proxy running in Docker (for example Nginx Proxy Manager, Traefik or Caddy) and its
  Docker network name. Without one, see [Step 6](#step-6--put-the-dashboard-behind-a-reverse-proxy).

## Step 2 — Get the code and a GeoIP key

```bash
git clone https://github.com/rom98759/honeypot-dashboard.git /opt/honeypot-dashboard
cd /opt/honeypot-dashboard
```

The map and countries need the free MaxMind GeoLite2 databases: create an account at
<https://www.maxmind.com/en/geolite2/signup>, then *Manage license keys → Generate new license key*.
Note the account ID and the key. Without them everything works except geolocation.

## Step 3 — Configure

Two files, both `chmod 600`, never committed.

```bash
install -D -m 600 scripts/host.env.example /etc/honeypot-dashboard/host.env
install -m 600 .env.example .env
```

### `/etc/honeypot-dashboard/host.env` (host side, read by the installer and the scripts it installs)

| Key | Required | Default | Meaning |
|---|---|---|---|
| `SSHD_PORT` | yes | — | Port of your real sshd (step 0). Never 22. |
| `REPO_DIR` | no | the clone the installer runs from | Where you cloned the repo. GeoIP files go to `$REPO_DIR/geoip`. The installer adds it to host.env if missing. |
| `HONEYPOT_SUBNET` | no | `172.21.0.0/16` | Cowrie's network. Must equal `HONEYPOT_SUBNET` in `.env`. Change it only if it collides with an existing Docker network (`docker network inspect` to check). |
| `COWRIE_PORT` | no | `22` | Host port Cowrie is published on. Bans with the "services" scope leave it open. |
| `COWRIE_JSON` | no | derived | Cowrie's JSON log seen from the host, read by the `cowrie` jail. Empty = `/var/lib/docker/volumes/<COWRIE_VAR_VOLUME>/_data/log/cowrie/cowrie.json`. |
| `WAN_IFACE` | no | default route interface | Internet-facing interface, used by the optional WAN filters. |
| `CLOUDFLARE_ONLY` | no | `0` | `1` = published ports 80/443 accept only Cloudflare IP ranges. Only if your DNS is proxied by Cloudflare. |
| `BLOCK_PORTS` | no | empty | Space-separated published container ports to drop from the Internet, e.g. `81` for a proxy admin UI you reach through an SSH tunnel. |
| `FBAN_ENABLED` | no | `0` | `1` = install the worker that lets the dashboard ban/unban (see step 8). |
| `MAXMIND_ACCOUNT_ID` | no | empty | MaxMind account ID (step 2). |
| `MAXMIND_LICENSE_KEY` | no | empty | MaxMind license key (step 2). |

### `.env` (containers, read by `docker compose`)

| Key | Required | Default | Meaning |
|---|---|---|---|
| `SSHD_PORT` | recommended | empty | Same value as in host.env; shown on the Correlation page. |
| `COWRIE_PORT` | no | `22` | Host port published for Cowrie. |
| `COWRIE_IMAGE` | no | `cowrie/cowrie:latest` | Cowrie image; pin a tag for fully repeatable installs. |
| `HONEYPOT_SUBNET` | no | `172.21.0.0/16` | Must equal the host.env value: the egress block matches this subnet. |
| `PROXY_NETWORK` | yes | `nginx-proxy-network` | Docker network of your reverse proxy. It must already exist. |
| `COWRIE_ETC_VOLUME` | no | `honeypot-cowrie-etc` | Volume names. Change only to reuse volumes from an older install. |
| `COWRIE_VAR_VOLUME` | no | `honeypot-cowrie-var` | Cowrie logs and recorded sessions. |
| `DASHBOARD_DATA_VOLUME` | no | `honeypot-dashboard-data` | The dashboard's SQLite database. |
| `GEOIP_DIR` | no | `./geoip` | Where the GeoLite2 `.mmdb` files are. |
| `ADM_GID` | no | `4` | GID of the `adm` group, which can read `/var/log/honeypot-export` (`getent group adm`). |
| `FBAN_ENABLED` | no | `0` | `1` = show Ban/Unban buttons. Needs `FBAN_ENABLED=1` in host.env too. |
| `ADMIN_IPS` | no | empty | Your own IPs/CIDRs, comma-separated: never bannable from the dashboard. More can be added on the Settings page. |
| `ABUSEIPDB_API_KEY` | no | empty | Free [AbuseIPDB](https://www.abuseipdb.com/) key for IP reputation. Empty = disabled. |

## Step 4 — Install the host side

```bash
scripts/install-host.sh --dry-run    # checks + list of every action, changes nothing
scripts/install-host.sh
```

What the preflight checks, and what to do if it stops (exit code 2, nothing changed):

| Message | Cause | Fix |
|---|---|---|
| `SSH LOCKOUT RISK` + `sshd still listens on port 22` | step 0 not done or not applied | finish step 0 (restart ssh) |
| `sshd listens on X but SSHD_PORT is Y` | host.env and sshd disagree | fix one of them |
| `ufw is active but has no rule for port …` | the new port is not allowed | `ufw allow <SSHD_PORT>/tcp` |
| `WARNING: ufw is not active` | not blocking | make sure your provider firewall allows `SSHD_PORT` and 22 |
| `REPO_DIR=… does not contain docker-compose.yml` | wrong `REPO_DIR` | point it at your clone, or remove the line |
| `host.env must be owned by root and not group/world-writable` | loose permissions (it is run as root) | `chown root: /etc/honeypot-dashboard/host.env && chmod 600 …` |

What it installs (all idempotent, re-run it any time):

- `/usr/local/sbin/`: `fail2ban-export.sh`, `sshd-auth-export.sh`, `docker-user-firewall.sh`,
  `geoip-update.sh` (+ `fban-queue-worker.sh` if `FBAN_ENABLED=1`).
- systemd units, enabled: `fail2ban-export.timer` (every minute), `sshd-auth-export.timer`
  (every 5 min), `docker-user-firewall.service` + `.timer` (at boot, at every Docker restart, every
  10 min), `geoip-update.timer` (monthly; first download right away if the key is set),
  `fban-queue-worker.path` (if enabled).
- `/etc/logrotate.d/honeypot-export`, `/var/log/honeypot-export/` (root:adm 750),
  `/etc/honeypot/never-ban` (created empty, never overwritten).
- `/etc/fail2ban/jail.d/honeypot.local` (+ `action.d/honeypot-block.conf`, `filter.d/honeypot-*.conf`,
  `/usr/local/sbin/honeypot-ban.sh`): the jails described in [How bans work](#how-bans-work). It is
  regenerated on every run (edit `host.env` / `never-ban`, not the file) and, being a `jail.d/*.local`,
  wins over your own `jail.local`. The installer checks it with `fail2ban-client -t` before reloading
  and puts the previous file back if fail2ban rejects it.

The installer itself **never** touches sshd or ufw. Ban rules live in one `hp-<jail>` chain per jail,
reached from `INPUT` and `DOCKER-USER`; the other firewall rules only go to `DOCKER-USER`.

### How bans work

The honeypot observes, the real services are protected:

| Jail | Triggered by | Bans for | Blocks |
|---|---|---|---|
| `cowrie` | any connection or login on Cowrie | 1 day | real services (sshd, sites, other ports), **not** Cowrie |
| `sshd` | 2 failures on the real sshd (`mode = aggressive`) | 7 days | real services |
| `recidive` | 3 bans in a week, any jail | 30 days | real services |
| `npm-badbots` | your own jail, if you defined it | its bantime | real services |
| `manual` | dashboard Ban, "Vrais services" | 7 days | real services |
| `manual-all` | dashboard Ban, "Tout bloquer" | 7 days | everything, Cowrie included |

"Real services" = everything on the host except tcp/`COWRIE_PORT`, and every container except the
honeypot network: a banned bot keeps talking to Cowrie, so you keep recording it, but cannot reach
your sshd or your sites. Never banned: `127.0.0.1`, `::1`, `HONEYPOT_SUBNET` (Cowrie sees IPv6
clients as its Docker gateway), every entry of `/etc/honeypot/never-ban`, and the dashboard's protected
IPs (`ADMIN_IPS` + Settings page). The dashboard writes the latter to `/opt/honeypot/fban-queue/admin-networks`;
fail2ban asks `/usr/local/sbin/honeypot-never-ban.sh` before every ban (`ignorecommand`), so an
address added in Settings is protected at once, without a reload. Entries of that file wider than /16
(IPv4) or /48 (IPv6) are ignored, since the container can write it.

Debian 12 logs sshd as `ssh.service`; the stock jail matches `sshd.service` and therefore never sees a
failure. `honeypot.local` sets the right `journalmatch`. The `sshd` jail bans after 2 failures for 7
days: **put your own addresses in `never-ban` before installing**, or a typo locks you out for a week
(recovery: your provider's console, `fail2ban-client unban <ip>`).

The dashboard counts a ban as running until its `Unban` line or its jail's bantime; if you change a
bantime, set `FAIL2BAN_BANTIMES` (`jail=seconds,…`) in `.env` to match.

## Step 5 — Start the containers

```bash
docker network ls | grep "$(grep ^PROXY_NETWORK= .env | cut -d= -f2)"   # must exist
docker compose up -d --build
docker compose ps                                                        # both "Up"
docker compose logs --tail=20 dashboard
```

The first build takes a few minutes (frontend + Python image).

## Step 6 — Put the dashboard behind a reverse proxy

The dashboard has **no authentication**. Never publish it directly.

In your reverse proxy, create a site for a (sub)domain of yours that forwards to
`http://honeypot-dashboard:8000` over the `PROXY_NETWORK` network, with TLS, and **add an
authentication layer** (basic auth, SSO, IP allow-list...). For Nginx Proxy Manager: *Proxy Host*
(forward hostname `honeypot-dashboard`, port `8000`), *SSL* tab, and an *Access List* with a user.

Without a reverse proxy, reach it through an SSH tunnel: temporarily add
`ports: ["127.0.0.1:8000:8000"]` to the `dashboard` service, then
`ssh -p 50022 -L 8000:127.0.0.1:8000 <user>@<server>` and open <http://localhost:8000>.

## Step 7 — Check that everything works

```bash
# Real SSH still works (from your machine, NEW terminal)
ssh -p 50022 <user>@<server>

# Port 22 is answered by Cowrie
ssh -o StrictHostKeyChecking=no root@<server>       # any password except "root": you land in the fake shell; type `exit`

# Ingestion: each source reports a lag of 0 bytes
docker compose exec -T dashboard python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"

# Firewall: the honeypot egress block is in place
iptables -S DOCKER-USER | grep "honeypot: no egress"

# Timers are scheduled
systemctl list-timers | grep -E 'fail2ban-export|sshd-auth-export|docker-user-firewall|geoip-update'
```

Your test session should appear on the Sessions page within a few seconds. The fail2ban source
can stay empty until fail2ban bans someone: that is normal.

## Step 8 — Optional features

**Ban/unban from the IP page.** Set `FBAN_ENABLED=1` in both `host.env` and `.env`, put your own
IPs in `ADMIN_IPS` and in `/etc/honeypot/never-ban` (one per line), then:

```bash
scripts/install-host.sh && docker compose up -d
```

The dashboard writes requests into `/opt/honeypot/fban-queue/`; a systemd path unit runs the worker,
which accepts only `ban manual|manual-all <ip>`, `unban all <ip>` and `status all <ip>`, refuses
`never-ban` addresses, and calls `fail2ban-client`. The Ban button asks for a scope: "Vrais services"
(jail `manual`, Cowrie keeps observing the IP) or "Tout bloquer" (jail `manual-all`), 7 days each;
Unban lifts the IP from every jail. The IP page lists the running bans, with what they block and until
when. Banning your own IP locks you out, hence the two allow-lists and the confirmation step.

**AbuseIPDB.** Put your key in `ABUSEIPDB_API_KEY` and `docker compose up -d`.

## Upgrade

```bash
cd /opt/honeypot-dashboard
git pull
scripts/install-host.sh            # updates the installed scripts/units if they changed
docker compose up -d --build
docker compose pull cowrie && docker compose up -d cowrie   # newer Cowrie image
```

## Uninstall

```bash
docker compose down                     # add -v to also delete the volumes (all data!)
scripts/install-host.sh --uninstall     # removes scripts, units, jail files; keeps logs, never-ban, host.env
systemctl restart docker                # clears the DOCKER-USER rules
```

Then move your real SSH back to 22 if you want, with the same care as step 0.

## Troubleshooting

- **Health banner "stalled" on a source**: `systemctl status fail2ban-export.timer sshd-auth-export.timer`,
  `ls -l /var/log/honeypot-export/`. The container mounts the *directory*: never bind-mount a single
  log file (the inode is pinned and ingestion stops at the next rotation).
- **`docker compose up` fails with "port is already allocated" on 22**: sshd still listens on 22.
  Back to step 0.
- **"network … declared as external, but could not be found"**: wrong `PROXY_NETWORK`, check `docker network ls`.
- **Empty map**: no GeoLite2 files in `geoip/`. `systemctl start geoip-update.service` then
  `journalctl -u geoip-update.service`.
- **Firewall rules**: `docker-user-firewall.sh --print-rules` shows what the config produces,
  `--dry-run` validates it against the live tables.
- **Logs of Cowrie itself**: `scripts/cowrie-logs.sh text 100`, `follow`, `downloads`.
