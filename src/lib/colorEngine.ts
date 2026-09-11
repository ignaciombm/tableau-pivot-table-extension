// Conditional formatting: period-over-period comparison coloring and
// relative heatmap/gradient coloring, driven by the toolbar's PivotDisplayState.
// The two are mutually exclusive (FormattingConfig.colorMode).
//
// Both features are built on the same "representative cell" concept: when a
// field's groups sometimes show a subtotal and sometimes don't (because
// hideSingleItemGroups suppressed it for a single-item group), the
// "representative" of a group is its subtotal if shown, otherwise its sole
// child. Only representative cells participate — comparing/coloring a
// group's individual breakdown rows would mix unrelated granularities (e.g.
// comparing "this month's generated revenue" against "last month's total").

import { pathKeyFor, type AxisLeaf } from './pivotEngine';
import type { HeatmapConfig, PeriodComparisonConfig } from '../types';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lerpColor(fromHex: string, toHex: string, t: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const mixed: [number, number, number] = [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
  return rgbToHex(mixed);
}

export function interpolateHeatmapColor(value: number, min: number, max: number, config: HeatmapConfig): string {
  if (max === min) return config.midColor;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t <= 0.5 ? lerpColor(config.minColor, config.midColor, t / 0.5) : lerpColor(config.midColor, config.maxColor, (t - 0.5) / 0.5);
}

/**
 * For every entry in `axis`, determines whether it is the "representative"
 * cell of its group at `field`'s level: that group's subtotal if one is
 * shown, or its sole child if the subtotal was hidden as a single-item
 * group. Entries in a multi-item group that already has a visible subtotal
 * are never representatives (only the subtotal is) — and the grand total
 * never is.
 */
export function computeRepresentativeMap(axis: AxisLeaf[], fields: string[], field: string): Map<AxisLeaf, boolean> {
  const map = new Map<AxisLeaf, boolean>();
  const fieldDepth = fields.indexOf(field);
  if (fieldDepth < 0) return map;

  const groups = new Map<string, AxisLeaf[]>();
  for (const item of axis) {
    if (item.kind === 'grandtotal' || item.path.length <= fieldDepth) continue;
    const key = pathKeyFor(item.path.slice(0, fieldDepth + 1));
    let members = groups.get(key);
    if (!members) {
      members = [];
      groups.set(key, members);
    }
    members.push(item);
  }

  for (const members of groups.values()) {
    const subtotal = members.find((m) => m.kind === 'subtotal');
    const representative = subtotal ?? (members.length === 1 ? members[0] : null);
    for (const m of members) map.set(m, m === representative);
  }
  return map;
}

/**
 * Maps each representative cell (see computeRepresentativeMap) at `periodField`'s
 * level to the previous representative sharing the same values at every
 * shallower field level — the "previous period", holding other dimensions
 * constant. Non-representative cells have no entry (they never get a
 * period-comparison color). Precomputed once per render instead of scanned
 * per cell — see the perf note in pivotEngine.ts.
 */
export function buildPeriodComparisonPlan(axis: AxisLeaf[], fields: string[], periodField: string): Map<AxisLeaf, AxisLeaf | null> {
  const plan = new Map<AxisLeaf, AxisLeaf | null>();
  const fieldDepth = fields.indexOf(periodField);
  if (fieldDepth < 0) return plan;

  const representativeMap = computeRepresentativeMap(axis, fields, periodField);
  const lastRepresentativeByOuterKey = new Map<string, AxisLeaf>();

  for (const item of axis) {
    if (item.kind === 'grandtotal' || item.path.length <= fieldDepth || !representativeMap.get(item)) continue;
    const outerKey = pathKeyFor(item.path.slice(0, fieldDepth));
    plan.set(item, lastRepresentativeByOuterKey.get(outerKey) ?? null);
    lastRepresentativeByOuterKey.set(outerKey, item);
  }
  return plan;
}

export function getPeriodComparisonColor(
  current: number | null,
  previous: number | null,
  config: PeriodComparisonConfig,
): string | null {
  if (current === null || previous === null) return null;
  if (current === previous) return config.neutralColor;
  const improved = config.direction === 'higherIsBetter' ? current > previous : current < previous;
  return improved ? config.improvedColor : config.declinedColor;
}

export interface HeatmapContext {
  rowAxis: AxisLeaf[];
  columnAxis: AxisLeaf[];
  rowFields: string[];
  columnFields: string[];
  getValue: (rowLeaf: AxisLeaf, columnLeaf: AxisLeaf) => number | null;
}

function isBaseKind(leaf: AxisLeaf): boolean {
  return leaf.kind === 'leaf' || leaf.kind === 'collapsed';
}

export function cellKey(row: AxisLeaf, column: AxisLeaf): string {
  return `${row.kind}:${pathKeyFor(row.path)}||${column.kind}:${pathKeyFor(column.path)}`;
}

/**
 * Computes heatmap colors for one measure. Scope 'table' compares every leaf
 * cell together (totals stay uncolored, so a grand total can't flatten the
 * scale for everything else). Scope 'rows'/'columns' instead compares, within
 * each row (or column), only the cells that are representatives of
 * `compareField` on the other axis — e.g. each month's total for a given
 * client, never a "committed" breakdown row nor the row's own grand-total
 * column — leaving every other cell uncolored.
 */
export function computeHeatmapColors(ctx: HeatmapContext, config: HeatmapConfig): Map<string, string> {
  const colorByCellKey = new Map<string, string>();

  if (config.scope === 'table') {
    let min = Infinity;
    let max = -Infinity;
    const values: { row: AxisLeaf; column: AxisLeaf; value: number }[] = [];
    for (const row of ctx.rowAxis) {
      if (!isBaseKind(row)) continue;
      for (const column of ctx.columnAxis) {
        if (!isBaseKind(column)) continue;
        const value = ctx.getValue(row, column);
        if (value === null) continue;
        values.push({ row, column, value });
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    for (const { row, column, value } of values) colorByCellKey.set(cellKey(row, column), interpolateHeatmapColor(value, min, max, config));
    return colorByCellKey;
  }

  if (!config.compareField) return colorByCellKey;

  if (config.scope === 'rows') {
    const representativeMap = computeRepresentativeMap(ctx.columnAxis, ctx.columnFields, config.compareField);
    for (const row of ctx.rowAxis) {
      let min = Infinity;
      let max = -Infinity;
      const values: { column: AxisLeaf; value: number }[] = [];
      for (const column of ctx.columnAxis) {
        if (column.kind === 'grandtotal' || !representativeMap.get(column)) continue;
        const value = ctx.getValue(row, column);
        if (value === null) continue;
        values.push({ column, value });
        if (value < min) min = value;
        if (value > max) max = value;
      }
      for (const { column, value } of values) colorByCellKey.set(cellKey(row, column), interpolateHeatmapColor(value, min, max, config));
    }
    return colorByCellKey;
  }

  // scope === 'columns'
  const representativeMap = computeRepresentativeMap(ctx.rowAxis, ctx.rowFields, config.compareField);
  for (const column of ctx.columnAxis) {
    let min = Infinity;
    let max = -Infinity;
    const values: { row: AxisLeaf; value: number }[] = [];
    for (const row of ctx.rowAxis) {
      if (row.kind === 'grandtotal' || !representativeMap.get(row)) continue;
      const value = ctx.getValue(row, column);
      if (value === null) continue;
      values.push({ row, value });
      if (value < min) min = value;
      if (value > max) max = value;
    }
    for (const { row, value } of values) colorByCellKey.set(cellKey(row, column), interpolateHeatmapColor(value, min, max, config));
  }
  return colorByCellKey;
}
