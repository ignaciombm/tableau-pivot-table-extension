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

/** Buckets a value into one of the 4 configured colors (quartiles of [min, max]), rather than a smooth gradient. */
export function bucketHeatmapColor(value: number, min: number, max: number, colors: readonly [string, string, string, string]): string {
  if (max === min) return colors[1];
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const bucketIndex = Math.min(3, Math.floor(t * 4));
  return colors[bucketIndex];
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

export function cellKey(row: AxisLeaf, column: AxisLeaf): string {
  return `${row.kind}:${pathKeyFor(row.path)}||${column.kind}:${pathKeyFor(column.path)}`;
}

/**
 * Computes heatmap colors for one measure. Scope 'rows'/'columns' compares,
 * within each row (or column), only the cells that are representatives of
 * `compareField` on the other axis — e.g. each month's total for a given
 * client, never a "committed" breakdown row nor the row's own grand-total
 * column — leaving every other cell uncolored.
 */
export function computeHeatmapColors(ctx: HeatmapContext, config: HeatmapConfig): Map<string, string> {
  const colorByCellKey = new Map<string, string>();
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
      for (const { column, value } of values) colorByCellKey.set(cellKey(row, column), bucketHeatmapColor(value, min, max, config.bucketColors));
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
    for (const { row, value } of values) colorByCellKey.set(cellKey(row, column), bucketHeatmapColor(value, min, max, config.bucketColors));
  }
  return colorByCellKey;
}
