# Ledger

Danial's personal expense tracker — a static web app served by GitHub Pages.

- `index.html`, `app.js`, `styles.css` — the app (works offline-ish, installable to the iPhone home screen)
- `ledger-data.js` — the base data snapshot (all transactions, categories, funds, savings)
- `inbox/YYYY-MM.txt` — new transactions appended by Claude from the phone, merged on top at runtime (see `inbox/README.md`)
- `icons-b64/` — PNG icons as base64 text; the Pages workflow decodes them at deploy time
- `src-b64/` — `app.js`, `styles.css`, `ledger-data.js` gzipped + base64 (same reason); the deployed site gets the plain files. Sources of truth live in `Desktop/Financials/Legder` on Danial's Mac.

Deploys automatically on every push to `main`.
