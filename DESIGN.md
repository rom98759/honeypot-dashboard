# DESIGN.md — honeypot-dashboard

## Retained direction: faithful Umami (v3)

Reproduce Umami's analytics UI as closely as possible (reference: Umami 3.4 source, MIT, and the public
demo `cloud.umami.is/share/...`). Validated on 2026-10-31.

- **Tokens**: neutral greys (react-zen palette, zero chroma), surface `#fff` on page `#f9f9f9`-ish,
  border `palette-300`, radius 6px, primary `#2680eb`. Dark mode mirrors with `palette-900` surfaces.
- **Type**: Inter everywhere; metric values 36px bold; panel headings 24px bold; tables 14px.
  Monospace only for IPs, credentials and commands.
- **Layout**: left sidebar grouped by sections (bold section label, icon + label items, settings at the
  bottom); page header = title + "● N live" on the right; controls row = "Filter" button left,
  `‹ › period ▾` right; active filters as chips under it.
- **Metrics**: bordered cards in an auto-fit grid, bold label, big value, change chip
  (green/red tinted, arrow) vs previous period.
- **Chart**: Chart.js bar chart, two overlapping datasets (x stacked, y not stacked), primary at
  0.4 / 0.6 alpha with 0.7 / 0.9 borders, no x grid, centered dot legend under the chart.
- **Tables**: "label | value bold | divider | % muted" rows, 30px high, hover tint, tabs on top of
  each panel, clicking a row adds a filter.
- **Map**: choropleth on `datamaps.world.json`, Mercator, fill `#f9f9f9`, stroke and max fill
  primary, lightness interpolated by share (`lighten(0.4 * (1 - pct))`), hover tooltip.
- **Weekly traffic**: day x hour dot grid, dot size and opacity by volume.

## Campaigns page (validated 2026-11-01): direction A "Panneau Umami"

Same grammar as the rest of the app: four metric cards (campaigns, concentration of the top campaign,
new in 7 days, login-only sessions), one panel with sort tabs (by sessions / by IPs / recent) and a
"typical command | IPs | 30-day sparkline | sessions | %" table where a pale primary bar behind the
command shows its share; "Login seul" is a muted last row. A row opens a side panel (same pattern as
the session detail): sessions, IPs, dominant ASN and /24 with their share, first/last seen, sample
session replay, its commands, top IPs linking to the IP page.

## Rejected
- Direction "Umami pur" loose interpretation (top navbar, generic metric strip): not close enough.
- "Rapport de garde" (editorial bulletin, sentence filters, huge printed numbers).
- "Radar nuit" (full-screen dark map with animated arcs, glass HUD).
- Heatmap/point overlays on the map (previous simpleheat map): replaced by the choropleth.
- Campaigns "Chronologie" (shared timeline axis with lifespan bars, Pareto concentration strip, ochre /
  burgundy palette, Plex Condensed): kept in reserve for the future "families" layer, not chosen.
- Campaigns "Mur de terminaux" (dark phosphor treemap of terminal tiles sized by log(sessions), no
  table): too far from the rest of the app.
