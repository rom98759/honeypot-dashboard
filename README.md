# honeypot-dashboard

[Français](README.fr.md)

Self-hosted dashboard for a [Cowrie](https://github.com/cowrie/cowrie) SSH/Telnet honeypot.
It ingests Cowrie's JSON log, fail2ban's log and the real sshd's auth log into SQLite, and shows
who attacks your server, what they type, and how the honeypot, the real sshd and fail2ban relate.

> [!WARNING]
> **Cowrie takes port 22.** Your real SSH server must be moved to another port
> (`SSHD_PORT`, e.g. 50022) **before** you start the stack, or you lock yourself out.
> The installer refuses to run while sshd still listens on 22. Follow
> [step 0 of the install guide](docs/install.md#step-0--move-your-real-ssh-server-off-port-22) carefully.

## Features

- **Overview**: attempts, sessions, top credentials/countries/commands, period comparison, heatmap.
- **Sessions**: every Cowrie session with a terminal **replay** (asciinema player).
- **Search**: one query bar on the overview, map, sessions and commands pages, e.g.
  `ip:45.* country:CN,RU -user:root cmd:wget dur>60 login:ok file:upload asn:ovh` (comma = OR,
  `-` excludes, `*` wildcard, CIDR ranges); each term shows as a removable chip, and the URL can be shared.
- **Campaigns**: sessions grouped by the script they ran, normalised so random tokens, IPs and
  passwords do not split a bot family.
- **Files**: what attackers fetched (wget/curl), wrote (`echo … > file`) or uploaded (SFTP/scp), per
  session and per SHA-256: sources, sessions, IPs, VirusTotal link, download as a zip encrypted
  with the password `infected`.
- **Map**: attacks per country (GeoLite2).
- **Correlation**: the same IP seen on the honeypot, on the real sshd, and banned by fail2ban.
- **IP page**: history, ASN, reverse DNS, AbuseIPDB score, optional **ban/unban** through fail2ban.
- **Health banner**: warns when a log source stops being ingested.

## How it works

```
                 Internet
   ┌────────────────┼──────────────────────┐
   │ :22            │ :SSHD_PORT           │ :443
   ▼                ▼                      ▼
 Cowrie          real sshd           reverse proxy (TLS + auth)
 (container,     (host, fail2ban          │
  no egress)      sshd jail)               ▼
   │                │                 dashboard (container, read-only)
   │ cowrie.json    │ journal               ▲
   │ (volume)       ▼                       │ SQLite
   │         host exporters ──► /var/log/honeypot-export/
   └───────────────────────────────────────┘
```

- `docker-compose.yml` runs Cowrie and the dashboard (FastAPI + React, hardened: read-only,
  no capabilities, non-root).
- `scripts/install-host.sh` installs the host side: systemd timers exporting the fail2ban log and
  the sshd journal, a `DOCKER-USER` firewall rule that blocks any outbound connection from
  Cowrie, monthly GeoIP refresh, logrotate, the fail2ban jails, read access to Cowrie's captured
  files, and the optional ban worker.
- The dashboard has **no login**: it must sit behind a reverse proxy that adds authentication.

## Quick start

On a fresh Debian 12 server, as root, **after** moving SSH (step 0):

```bash
git clone https://github.com/rom98759/honeypot-dashboard.git /opt/honeypot-dashboard
cd /opt/honeypot-dashboard
install -D -m 600 scripts/host.env.example /etc/honeypot-dashboard/host.env  # then edit it
install -m 600 .env.example .env                                            # then edit it
scripts/install-host.sh --dry-run && scripts/install-host.sh
docker compose up -d --build
```

The full walkthrough (requirements, every setting, reverse proxy, checks, upgrade, uninstall,
troubleshooting) is in **[docs/install.md](docs/install.md)**.

## Security model

- Cowrie runs in a container with no capabilities, a read-only filesystem, resource limits and
  **no outbound network** (`DOCKER-USER` rule on its fixed subnet).
- Docker-published ports bypass ufw: the firewall rules live in `DOCKER-USER`, never in ufw.
- fail2ban: the honeypot observes, the real services are protected. Anyone who touches Cowrie is
  banned from the real sshd and the sites for a day while Cowrie keeps recording it; failures on the
  real sshd ban for 7 days, repeat offenders for 30 (see `docs/install.md`, "How bans work").
- Ban/unban from the dashboard is off by default (`FBAN_ENABLED=0`). When on, requests go through a
  queue directory to a host worker that only accepts `ban manual|manual-all <ip>`, `unban all <ip>`
  and `status all <ip>`, and refuses the addresses in `/etc/honeypot/never-ban` and `ADMIN_IPS`.

## Development

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest httpx
.venv/bin/uvicorn app.main:app --reload     # backend on :8000
cd frontend && npm ci && npm run dev        # frontend, proxies /api to :8000
.venv/bin/pytest                            # backend + script tests
cd frontend && npm test                     # frontend tests
```

## License

[MIT](LICENSE). The world map (`frontend/public/world.json`, `isoCountries.ts`) comes from
[Umami](https://github.com/umami-software/umami) (MIT). GeoLite2 data by MaxMind.
