---
paths:
  - "frontend/**"
  - "app/search_filter.py"
---
# Frontend (React + TS + Vite) et langage de recherche

- HashRouter, TanStack Query, un seul `src/style.css`, Chart.js npm, `public/vendor/` = asciinema-player vendoré.
- Design : clone fidèle d'Umami v3 (voir `DESIGN.md`) ; tokens dans `style.css`, couleurs Chart.js/carte dans
  `theme/chartTheme.ts`. La carte est une choroplèthe (`public/world.json` + `utils/isoCountries.ts`, repris
  d'Umami, MIT) alimentée par `countries` de `/api/overview` ; elle a besoin de `geo_cache.country_code`
  (rempli au lookup et par le backfill de démarrage).
- Fiche session (`SessionDetailPanel`) : mise en page validée dans `DESIGN.md`.
- IP relayées en IPv6 affichées « IPv6 (IP inconnue) » via `components/IpAddress.tsx` (`proxied_source_ip`
  de `/api/config`).
- Recherche : langage `ip:45.* country:CN,RU -user:root cmd:wget dur>60 login:ok file:upload asn:…` dans
  `?filter=` (`theme/useSearchFilter.ts`, barre `components/QueryBar.tsx`). `app/search_filter.py` fait autorité
  (parse + SQL sur l'alias `s` de `sessions`, messages d'erreur en français affichés tels quels, 400) ;
  `utils/searchFilter.ts` reprend la même grammaire pour les chips et la validation avant envoi : les garder
  alignés (tests miroirs). Accepté par `/api/overview`, `/api/sessions`, `/api/commands` ; les anciens
  `?ip=&country=&protocol=&username=` restent lus. `?command=` (Sessions) reste un filtre exact à part.
  `ip_in_network()` est une fonction SQLite enregistrée dans `db.connect` (CIDR non alignés sur l'octet).
