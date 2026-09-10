# Pivot Table — Tableau Dashboard Extension

A configurable, dynamic pivot table for Tableau dashboards. Dashboard creators
govern which fields, layouts and formatting defaults are available; end users
explore within those limits.

## Requirements

- Node.js 18+
- Tableau Desktop or Tableau Server/Cloud with Dashboard Extensions enabled

## Local development

```bash
npm install
npm run dev
```

This starts an HTTPS dev server at `https://localhost:8765` (self-signed
certificate, via `@vitejs/plugin-basic-ssl`).

The first time, open `https://localhost:8765` directly in a browser and accept
the certificate warning — otherwise Tableau will silently fail to load the
extension.

## Loading the extension into a dashboard

1. In Tableau, open a dashboard and go to **Objects → Extension**, then choose
   **My Extensions**.
2. Browse to [`public/pivot-table.trex`](public/pivot-table.trex) in this
   project. While `npm run dev` is running, this points at
   `https://localhost:8765/index.html`.
3. As the dashboard creator, right-click the extension and choose
   **Configure…** to pick a worksheet, whitelist fields, lock axes, and set
   formatting defaults.
4. End users interact with the extension directly on the published dashboard,
   within whatever limits the creator configured.

## Publishing (GitHub Pages)

This repo auto-deploys to GitHub Pages on every push to `main` via
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
(`npm ci && npm run build`, then `actions/deploy-pages`).

Live URL: **https://ignaciombm.github.io/tableau-pivot-table-extension/**

[`public/pivot-table.trex`](public/pivot-table.trex) already points its
`<source-location><url>` at that URL. If you ever fork/rename the repo or
move it to a different account, update that URL to match, since Tableau
resolves the extension from exactly that address.

Replace the placeholder `<icon>` in the manifest with a real base64-encoded
PNG whenever you get a real one.

## Project structure

- `src/lib/tableauClient.ts` — thin wrapper around the Tableau Extensions API
- `src/lib/pivotEngine.ts` — grouping, subtotal/grand-total, and merged-header
  logic (framework-agnostic, unit-testable in isolation)
- `src/lib/colorEngine.ts` — period-over-period and heatmap conditional
  formatting
- `src/lib/parsing.ts` — locale-independent number/date parsing & formatting
  (always uses a fixed locale, never the browser's)
- `src/lib/csvExport.ts` — flattens the current pivot view (including
  subtotals/grand totals) into a CSV and triggers a browser download
- `src/admin/` — Configure dialog (creator governance panel)
- `src/dashboard/` — end-user pivot table UI

## Governance model

- The creator whitelists which dimensions/measures end users may use, locks
  either the row or column axis (or leaves both free), and sets default
  fields, default totals behavior, and default conditional formatting.
- End users can only build with whitelisted fields, and can only override
  conditional formatting if the creator has allowed it
  (`allowUserFormattingOverrides`).
- Settings are persisted via `tableau.extensions.settings` and shared by all
  viewers of the published dashboard; the end user's own field selections are
  session-only and reset to the creator's defaults on reload.
