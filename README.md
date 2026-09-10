# Pivot Table — Tableau Viz Extension

A pivot table rendered as a Tableau **Viz Extension**: it lives on a
worksheet's Marks card (not as a dashboard object), and the creator builds it
by dropping fields onto three custom encoding tiles — **Rows**, **Columns**,
and **Measures** — exactly like assigning shelves for any other mark type.

## Requirements

- Node.js 18+
- Tableau Desktop 2024.2+ or Tableau Server/Cloud 2024.2+ (Viz Extensions
  require API 1.12, which needs `worksheetContent`)

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

## Adding the extension to a worksheet

Viz Extensions are added from a **worksheet**, not a dashboard:

1. In Tableau Desktop, open a worksheet, expand the **Marks card** mark-type
   dropdown, and under **Viz Extensions** choose **Add Extension**.
2. Browse to [`pivot-table.trex`](pivot-table.trex) in this project (or the
   copy in [`public/pivot-table.trex`](public/pivot-table.trex) — same file).
   While `npm run dev` is running, this points at
   `https://localhost:8765/index.html`.
3. Three encoding tiles appear on the Marks card — **Rows**, **Columns**,
   **Measures**. Drag dimensions onto Rows/Columns (drop several for a
   multi-level hierarchy) and measures onto Measures.
4. A small toolbar inside the extension lets anyone viewing it adjust totals
   (None/Rows/Columns/Both), conditional total hiding, period-over-period
   comparison, heatmap shading, and download the current view as CSV. Changes
   made while authoring are saved as the default for everyone; changes made
   while just viewing only affect that person's current session (Tableau only
   allows persisting extension settings in authoring mode).
5. Place the worksheet on a dashboard as usual to publish/share it.

### Making it interactive for dashboard viewers

Viz Extensions don't let a dashboard **viewer** drag fields onto the Marks
card — that's an authoring-only action. To let viewers change what the pivot
table shows, use a native Tableau **Parameter** instead:

1. Create a parameter (e.g. `Row Dimension`) listing the field names you want
   to offer.
2. Create a calculated field that switches on it, e.g.:
   ```
   CASE [Row Dimension]
     WHEN "Region" THEN [Region]
     WHEN "City" THEN [City]
   END
   ```
3. Drop that calculated field onto the **Rows** (or **Columns**) encoding
   instead of a raw field.
4. Add the parameter as a control on the dashboard.

When a viewer changes the parameter, Tableau recomputes the calculated
field's output, the worksheet's summary data changes, and this extension
redraws automatically — no extra code needed on our side.

## Publishing (GitHub Pages)

This repo auto-deploys to GitHub Pages on every push to `main` via
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
(`npm ci && npm run build`, then `actions/deploy-pages`).

Live URL: **https://ignaciombm.github.io/tableau-pivot-table-extension/**

[`public/pivot-table.trex`](public/pivot-table.trex) already points its
`<source-location><url>` at that URL. If you ever fork/rename the repo or
move it to a different account, update that URL to match (and re-copy it to
the root [`pivot-table.trex`](pivot-table.trex)), since Tableau resolves the
extension from exactly that address.

Replace the placeholder `<icon>` in the manifest with a real base64-encoded
PNG whenever you get a real one.

## Project structure

- `src/lib/tableauClient.ts` — thin wrapper around the Tableau Extensions API:
  reading the Rows/Columns/Measures encoding map via
  `getVisualSpecificationAsync`, and worksheet data via
  `getSummaryDataReaderAsync`
- `src/lib/pivotEngine.ts` — grouping, subtotal/grand-total, and merged-header
  logic (framework-agnostic, unit-testable in isolation)
- `src/lib/colorEngine.ts` — period-over-period and heatmap conditional
  formatting
- `src/lib/parsing.ts` — locale-independent number/date parsing & formatting,
  built on `DataValue.nativeValue` (always a proper JS type, never a
  locale-formatted string)
- `src/lib/csvExport.ts` — flattens the current pivot view (including
  subtotals/grand totals) into a CSV and triggers a browser download
- `src/viz/` — the extension's UI: `VizApp.tsx` (data/encoding loading and the
  toolbar), `PivotTableView.tsx` (the grid), `TotalsControls.tsx` /
  `FormattingControls.tsx` (the toolbar controls)

## Notes on aggregation

There's no "sum vs count" choice in this extension — whatever aggregation the
creator picked when dropping a field onto the Measures encoding already
applies to the summary data we read back. Subtotals/grand totals are computed
by additively summing those already-aggregated values, which is exact for
Sum/Count-based measures and an approximation for Avg/Min/Max/CountD/Median.
