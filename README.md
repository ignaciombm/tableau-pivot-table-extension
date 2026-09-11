# Pivot Table — Tableau Viz Extension

A pivot table rendered as a Tableau **Viz Extension**: it lives on a
worksheet's Marks card (not as a dashboard object), and the creator builds it
by dropping fields onto three custom encoding tiles — **Rows**, **Columns**,
and **Measures** — exactly like assigning shelves for any other mark type.

## Requirements

- Node.js 18+
- Tableau Desktop 2024.2+ or Tableau Server/Cloud 2024.2+ (Viz Extensions
  require API 1.12, which needs `worksheetContent`)

## The vendored Tableau Extensions API library

[`public/tableau.extensions.1.latest.js`](public/tableau.extensions.1.latest.js)
is a copy of Tableau's own library (from
[tableau/extensions-api](https://github.com/tableau/extensions-api)), served
from our own origin instead of `https://extensions.tableau.com`. That CDN
script has been unreliable in some Tableau environments (corporate proxies
blocking the external domain, load-order races), which surfaces as
`Error: tableau is not defined`. Serving it ourselves removes that
cross-origin dependency entirely. Re-sync it occasionally from the official
repo's `lib/tableau.extensions.1.latest.js` to pick up API updates.

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
4. An inline toolbar is all whoever's using the worksheet gets: collapse/expand
   all rows at once, download the current view as CSV, and pick the color
   mode — none, period comparison, or heatmap (mutually exclusive). For
   heatmap they also pick "Compare: Rows/Columns" and which field. Nothing
   else is user-facing.
5. Everything else is creator-only, reached by right-clicking the extension's
   mark type and choosing **Format Extension** (a native Tableau button for
   Viz Extensions — not something we render ourselves): totals position
   (top/bottom, left/right), the conditional-totals threshold,
   period-comparison's field/direction/colors, the heatmap's 4 bucket colors,
   and per-measure formatting (decimals, prefix/suffix, a custom label —
   optionally driven live by a Tableau parameter). Changes made while
   authoring are saved as the default for everyone; changes made while just
   viewing only affect that person's current session (Tableau only persists
   extension settings while authoring).
6. Click any row or column group header to collapse it to its total line;
   click again to expand. Collapse state is saved the same way as the rest
   of the settings.
7. Place the worksheet on a dashboard as usual to publish/share it.

Totals are always shown for both rows and columns, with a single-item
group's total always hidden — neither is configurable.

A field whose value is null for *every* row (typically a parameter-driven
calculated field currently set to "None") is dropped from the grouping
entirely, rather than rendering as a single meaningless "(No value)" row or
column.

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
  `getVisualSpecificationAsync`, worksheet data via
  `getSummaryDataReaderAsync`, and workbook parameters (for parameter-driven
  measure labels) via `getParametersAsync`
- `src/lib/pivotEngine.ts` — grouping, subtotal/grand-total, and merged-header
  logic (framework-agnostic, unit-testable in isolation)
- `src/lib/colorEngine.ts` — period-over-period and heatmap conditional
  formatting
- `src/lib/parsing.ts` — locale-independent number/date parsing & formatting,
  built on `DataValue.nativeValue` (always a proper JS type, never a
  locale-formatted string)
- `src/lib/csvExport.ts` — flattens the current pivot view (including
  subtotals/grand totals) into a CSV and triggers a browser download
- `src/lib/version.ts` — the version shown in the Settings dialog; keep it in
  sync with `extension-version` in the `.trex` and `package.json`
- `src/viz/` — the main UI: `VizApp.tsx` (data/encoding loading, the toolbar,
  registering the `configure` callback), `PivotTableView.tsx` (the grid,
  including collapsible group headers), `ColorControls.tsx` (the only
  user-facing color controls: mode, and for heatmap, compare axis/field)
- `src/configure/` — the creator-only Settings dialog (`ConfigureApp.tsx`).
  Reached exclusively via the native **Format Extension** button on the Marks
  card: the manifest declares `<context-menu><configure-context-menu-item />`,
  and `initializeVizExtension` registers a `configure` callback
  (`tableau.extensions.initializeAsync({ configure })`) that opens this
  dialog via `displayDialogAsync` — built as a second entry point
  (`configure.html`). We don't render our own button for this.

## Collapsible groups

Row and column group headers (anything above the deepest field level) show a
▾ toggle to collapse them to a single summary line, or ▸ to expand a
collapsed group back out. A collapsed group's value is the additive sum of
whatever's hidden underneath it, same caveat as subtotals below. "Collapse
rows" / "Expand rows" in the toolbar do this for every row group at once.

## Coloring: representative cells only

Period comparison and heatmap share one idea: when a group's total is
sometimes shown and sometimes hidden (via "hide totals for single-item
groups"), only that group's *representative* cell — its subtotal if shown,
otherwise its sole child — participates. This matters once a column field
has a variable number of items per period (e.g. a "revenue type" breakdown
that only has one item in past months but several in the current and future
ones): comparing every breakdown row individually would compare unlike
things, so only the period's actual total (or its stand-in) is compared or
colored — never a breakdown row, and never the grand total.

- **Period comparison** always compares along a creator-chosen column field,
  period-over-period, holding every other field constant. The end user can
  only turn it on/off from the toolbar — the field, direction, and colors are
  all set by the creator in Format Extension.
- **Heatmap** scope 'rows'/'columns' (end-user choice) compares within each
  row or column using a field on the *other* axis (also end-user choice) —
  e.g. compare months within each client row, or compare clients within each
  month column. Picking the wrong field here is what mixes a market's total
  in with its individual clients, making everything look artificially even.
  Colors are 4 discrete buckets (quartiles), not a smooth gradient, set by
  the creator.

## Performance

Cell values are computed from a single pass over the raw data into a "base
grid" (one sum per finest-grain row group × column group × measure); a
subtotal or grand total's value is then just the sum of the base cells under
it. This keeps cost proportional to the pivot table's own size (how many
distinct groups exist), not the underlying row count — the previous approach
re-intersected each cell's full row-index arrays on every lookup, which made
grand-total/subtotal cells cost O(row count) *each*, repeated for every
row/column pairing.

## Notes on aggregation

There's no "sum vs count" choice in this extension — whatever aggregation the
creator picked when dropping a field onto the Measures encoding already
applies to the summary data we read back. Subtotals/grand totals are computed
by additively summing those already-aggregated values, which is exact for
Sum/Count-based measures and an approximation for Avg/Min/Max/CountD/Median.
