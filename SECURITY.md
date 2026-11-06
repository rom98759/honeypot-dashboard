# Security policy

This project runs next to an exposed honeypot, so security reports are welcome.

## Reporting a vulnerability

Use GitHub's private form: **Security → Report a vulnerability**
(<https://github.com/rom98759/honeypot-dashboard/security/advisories/new>).
Please do not open a public issue. Expect a first answer within a week.

In scope: the dashboard (API, ingestion, replay), the host scripts and installer
(`scripts/`), the compose file and the documented setup.

Out of scope: Cowrie itself (report to [cowrie/cowrie](https://github.com/cowrie/cowrie)),
and deployments that skip the documented reverse-proxy authentication: the dashboard has no
login of its own and must never be exposed directly.

## Supported versions

Only the latest commit on `main` is supported.
