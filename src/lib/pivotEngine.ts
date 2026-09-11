// Core pivot aggregation engine: groups flat worksheet rows into a row axis and
// a column axis (each a flat, ordered list of leaves/subtotals/grand-total/
// collapsed-groups), and exposes cell lookups.
//
// Each row's measure values are already aggregated by Tableau (per whatever
// aggregation the creator chose when dropping the field onto the Measures
// encoding). This engine only re-aggregates by additive sum across the rows a
// pivot cell/subtotal/grand-total groups together — exact for Sum/Count-based
// measures, an approximation for Avg/Min/Max/CountD/Median.
//
// Performance note: cell values are computed from a "base grid" — the sum per
// (finest-grain row group x finest-grain column group x measure) — built in a
// single O(rows x measures) pass. A subtotal/grand-total's value is then just
// the sum of the base cells under it, so cost scales with pivot table size
// (how many distinct groups exist), never with the underlying row count. The
// earlier approach re-intersected each cell's full row-index arrays on every
// lookup, which made grand-total/subtotal cells cost O(row count) *each*,
// repeated for every row/column pairing — quadratic in practice.

import type { ConditionalTotalRule, DataRow, MeasureConfig, SortDirection, SortState, TotalsPosition } from '../types';
import { formatDate } from './parsing';

export type AxisLeafKind = 'leaf' | 'subtotal' | 'grandtotal' | 'collapsed';

export interface AxisLeaf {
  /** Field values (as display keys) from the root of the axis down to this node. */
  path: string[];
  /** Field names corresponding to each entry in `path`. */
  fieldPath: string[];
  kind: AxisLeafKind;
  depth: number;
  indices: number[];
  label: string;
}

const KEY_SEP = String.fromCharCode(1);

/** Stable key for a group's position in the tree, used both internally (collapse lookups) and by the UI to toggle a group's collapsed state. */
export function pathKeyFor(path: string[]): string {
  return path.join(KEY_SEP);
}

/** Drops any field whose value is null/undefined for every row (e.g. a parameter-driven calculated field currently set to "None") — otherwise it would render as a single, meaningless "(No value)" group. */
export function dropAllNullFields(fields: string[], data: DataRow[]): string[] {
  if (data.length === 0) return fields;
  return fields.filter((field) => data.some((row) => row[field] !== null && row[field] !== undefined));
}

/** Raw data indices whose values match `columnPath` at every level of `columnFields` it covers — i.e. the rows a clicked column (leaf or subtotal) aggregates over. Used to sort rows by that column's value. */
export function computeColumnMatchIndices(data: DataRow[], columnFields: string[], columnPath: string[]): Set<number> {
  const indices = new Set<number>();
  outer: for (let i = 0; i < data.length; i++) {
    for (let level = 0; level < columnPath.length; level++) {
      if (stringifyKey(data[i][columnFields[level]]) !== columnPath[level]) continue outer;
    }
    indices.add(i);
  }
  return indices;
}

interface RowSortContext {
  columnIndices: ReadonlySet<number>;
  measureFieldName: string;
  direction: SortDirection;
}

function computeSortMetric(data: DataRow[], indices: number[], ctx: RowSortContext): number | null {
  let sum = 0;
  let sawValue = false;
  for (const idx of indices) {
    if (!ctx.columnIndices.has(idx)) continue;
    const v = data[idx][ctx.measureFieldName];
    if (typeof v === 'number') {
      sum += v;
      sawValue = true;
    }
  }
  return sawValue ? sum : null;
}

interface GroupNode {
  key: string;
  /** Used only to order siblings; dates sort chronologically (ISO), everything else sorts by its display text. */
  sortKey: string;
  /** This group's aggregate for the sort column/measure, when a RowSortContext is active; null otherwise or if it has no matching data. */
  sortMetric: number | null;
  path: string[];
  isLeaf: boolean;
  isCollapsed: boolean;
  indices: number[];
  children: GroupNode[];
}

function stringifyKey(value: DataRow[string]): string {
  if (value === null || value === undefined) return '(No value)';
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

function sortableKey(value: DataRow[string]): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildTree(
  data: DataRow[],
  fields: string[],
  collapsedPaths: ReadonlySet<string>,
  sortContext: RowSortContext | null = null,
): GroupNode[] {
  const rootIndices = data.map((_, i) => i);
  if (fields.length === 0) {
    return [{ key: '__all__', sortKey: '', sortMetric: null, path: [], isLeaf: true, isCollapsed: false, indices: rootIndices, children: [] }];
  }
  return buildLevel(data, fields, 0, [], rootIndices, collapsedPaths, sortContext);
}

function buildLevel(
  data: DataRow[],
  fields: string[],
  level: number,
  parentPath: string[],
  indices: number[],
  collapsedPaths: ReadonlySet<string>,
  sortContext: RowSortContext | null,
): GroupNode[] {
  const fieldName = fields[level];
  const groups = new Map<string, { indices: number[]; sortKey: string }>();
  for (const idx of indices) {
    const raw = data[idx][fieldName];
    const key = stringifyKey(raw);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { indices: [], sortKey: sortableKey(raw) };
      groups.set(key, bucket);
    }
    bucket.indices.push(idx);
  }

  const isLastField = level === fields.length - 1;
  const nodes: GroupNode[] = [];
  for (const [key, group] of groups) {
    const path = [...parentPath, key];
    const collapsedHere = !isLastField && collapsedPaths.has(pathKeyFor(path));
    const isLeaf = isLastField || collapsedHere;
    nodes.push({
      key,
      sortKey: group.sortKey,
      sortMetric: sortContext ? computeSortMetric(data, group.indices, sortContext) : null,
      path,
      isLeaf,
      isCollapsed: collapsedHere,
      indices: isLeaf ? group.indices : [],
      children: isLeaf ? [] : buildLevel(data, fields, level + 1, path, group.indices, collapsedPaths, sortContext),
    });
  }
  if (sortContext) {
    nodes.sort((a, b) => {
      if (a.sortMetric === null && b.sortMetric === null) return 0;
      if (a.sortMetric === null) return 1; // rows with no matching value in the sort column always sort last
      if (b.sortMetric === null) return -1;
      return sortContext.direction === 'asc' ? a.sortMetric - b.sortMetric : b.sortMetric - a.sortMetric;
    });
  } else {
    nodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'en-US', { numeric: true }));
  }
  return nodes;
}

function collectIndices(node: GroupNode): number[] {
  if (node.isLeaf) return node.indices;
  return node.children.flatMap(collectIndices);
}

/** All path keys of groups that have children (i.e. could be collapsed), across every level — used for "collapse all". */
export function getAllGroupPathKeys(data: DataRow[], fields: string[]): string[] {
  const keys: string[] = [];
  function walk(nodes: GroupNode[]) {
    for (const node of nodes) {
      if (!node.isLeaf) {
        keys.push(pathKeyFor(node.path));
        walk(node.children);
      }
    }
  }
  walk(buildTree(data, fields, new Set()));
  return keys;
}

export function aggregateMeasure(data: DataRow[], indices: number[], measure: MeasureConfig): number | null {
  let sum = 0;
  let sawValue = false;
  for (const idx of indices) {
    const v = data[idx][measure.fieldName];
    if (typeof v === 'number') {
      sum += v;
      sawValue = true;
    }
  }
  return sawValue ? sum : null;
}

function shouldShowTotal(
  data: DataRow[],
  childCount: number,
  indices: number[],
  rule: ConditionalTotalRule,
  primaryMeasure: MeasureConfig | undefined,
): boolean {
  // Single-item groups never get a total — hardcoded, not a creator/user choice
  // (there's nothing to "total" when a group has just one member).
  if (childCount <= 1) return false;
  if (rule.minValueThreshold !== null && primaryMeasure) {
    const value = aggregateMeasure(data, indices, primaryMeasure);
    if (value === null || Math.abs(value) < rule.minValueThreshold) return false;
  }
  return true;
}

function flattenAxis(
  data: DataRow[],
  nodes: GroupNode[],
  fields: string[],
  totalsPosition: TotalsPosition,
  conditionalTotals: ConditionalTotalRule,
  primaryMeasure: MeasureConfig | undefined,
  depth = 0,
): AxisLeaf[] {
  const leaves: AxisLeaf[] = [];
  for (const node of nodes) {
    if (node.isLeaf) {
      leaves.push({
        path: node.path,
        fieldPath: fields.slice(0, node.path.length),
        kind: node.isCollapsed ? 'collapsed' : 'leaf',
        depth,
        indices: node.indices,
        label: node.key,
      });
      continue;
    }

    const childLeaves = flattenAxis(data, node.children, fields, totalsPosition, conditionalTotals, primaryMeasure, depth + 1);

    let subtotalLeaf: AxisLeaf | null = null;
    const groupIndices = collectIndices(node);
    if (shouldShowTotal(data, node.children.length, groupIndices, conditionalTotals, primaryMeasure)) {
      subtotalLeaf = {
        path: node.path,
        fieldPath: fields.slice(0, node.path.length),
        kind: 'subtotal',
        depth,
        indices: groupIndices,
        label: `${node.key} Total`,
      };
    }

    if (subtotalLeaf && totalsPosition === 'before') leaves.push(subtotalLeaf);
    leaves.push(...childLeaves);
    if (subtotalLeaf && totalsPosition === 'after') leaves.push(subtotalLeaf);
  }
  return leaves;
}

// --- Header grid construction, shared between row and column headers ---
//
// A "run" is a maximal, contiguous stretch of axis positions that share a
// header cell at a given field level: either several sibling leaves under the
// same ancestor group (e.g. the "RegionA" header spanning CityX/CityY/its own
// subtotal), or a single subtotal/grand-total/collapsed-group's own
// distinguishing cell, which instead spans *down* through the remaining,
// unused field levels (it has no further breakdown).

interface HeaderRun {
  level: number;
  startIndex: number;
  /** How many consecutive axis positions this run covers. */
  length: number;
  label: string;
  pathKey: string;
  /** 'ancestor' groups siblings under a shared prefix; 'leaf' is a terminal, unmergeable cell; otherwise mirrors the underlying AxisLeaf's kind. */
  cellKind: 'ancestor' | 'leaf' | 'subtotal' | 'grandtotal' | 'collapsed';
  /** For a subtotal/grandtotal/collapsed's own cell, how many field levels it spans (down for columns, across for rows). Always 1 for ancestor/leaf cells. */
  levelSpan: number;
}

function computeHeaderRuns(axis: AxisLeaf[], numLevels: number): HeaderRun[] {
  if (numLevels === 0) {
    return axis.map((item, i) => ({
      level: 0,
      startIndex: i,
      length: 1,
      label: item.label,
      pathKey: pathKeyFor(item.path),
      cellKind: item.kind === 'grandtotal' ? 'grandtotal' : 'leaf',
      levelSpan: 1,
    }));
  }

  // The level at which a node's *own* distinguishing cell begins (spanning
  // through the remaining levels). A subtotal still shares its prefix with
  // real sibling leaves, so its own cell starts one level below where it
  // lives (leaving room for the shared ancestor-merge cell above it). A
  // collapsed group has no visible siblings left at its own level — there's
  // nothing to merge it with — so its own cell starts *at* its own level;
  // treating it like a subtotal here would render two stacked cells both
  // showing its label instead of one cell spanning the full width.
  const ownLabelStartLevel = (item: AxisLeaf): number => {
    if (item.kind === 'grandtotal') return 0;
    if (item.kind === 'collapsed') return item.depth;
    return item.depth + 1;
  };
  const isTrueLeaf = (item: AxisLeaf) => item.path.length === numLevels;

  function identity(item: AxisLeaf, level: number): string | null {
    if (isTrueLeaf(item)) return item.path.slice(0, level + 1).join(KEY_SEP);
    const start = ownLabelStartLevel(item);
    if (level < start) return item.path.slice(0, level + 1).join(KEY_SEP);
    if (level === start) return item.kind === 'grandtotal' ? 'GRANDTOTAL' : `TOTAL${KEY_SEP}${item.path.join(KEY_SEP)}`;
    return null;
  }

  const runs: HeaderRun[] = [];
  for (let level = 0; level < numLevels; level++) {
    let i = 0;
    while (i < axis.length) {
      const id = identity(axis[i], level);
      if (id === null) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < axis.length && identity(axis[j], level) === id) j++;
      const length = j - i;
      const first = axis[i];
      const isOwnLabelCell = length === 1 && level === ownLabelStartLevel(first) && !isTrueLeaf(first);
      const cellKind: HeaderRun['cellKind'] = isOwnLabelCell
        ? (first.kind as 'subtotal' | 'grandtotal' | 'collapsed')
        : level === numLevels - 1
          ? 'leaf'
          : 'ancestor';
      runs.push({
        level,
        startIndex: i,
        length,
        label: isOwnLabelCell ? first.label : first.path[level],
        pathKey: isOwnLabelCell ? pathKeyFor(first.path) : pathKeyFor(first.path.slice(0, level + 1)),
        cellKind,
        levelSpan: isOwnLabelCell ? numLevels - level : 1,
      });
      i = j;
    }
  }
  return runs;
}

export interface HeaderCell {
  label: string;
  colSpan: number;
  rowSpan: number;
  pathKey: string;
  cellKind: HeaderRun['cellKind'];
}

/**
 * Builds merged column-header rows (one row per grouping field level). An
 * ancestor field's header spans across all of its descendant columns *and*
 * its own subtotal/collapsed column; a subtotal/grand-total/collapsed group
 * instead gets a single cell spanning downward through the remaining levels.
 *
 * `numLevels` is the axis's effective field count; colSpan is expressed in
 * axis-leaf units — the caller multiplies by the number of measures for
 * actual table columns.
 */
export function buildHeaderRows(axis: AxisLeaf[], numLevels: number): HeaderCell[][] {
  const runs = computeHeaderRuns(axis, numLevels);
  const rows: HeaderCell[][] = Array.from({ length: Math.max(numLevels, 1) }, () => []);
  for (const run of runs) {
    rows[run.level].push({ label: run.label, colSpan: run.length, rowSpan: run.levelSpan, pathKey: run.pathKey, cellKind: run.cellKind });
  }
  return rows;
}

/**
 * Builds the row-header grid: `grid[axisIndex][level]` is either the cell to
 * render there or null if that position is covered by an earlier row's
 * rowSpan. This is the transpose of buildHeaderRows — an ancestor cell spans
 * *down* through the rows it groups (rowSpan) in a single field-level column,
 * while a subtotal/grand-total/collapsed cell spans *across* the remaining
 * field-level columns (colSpan) within its own single row.
 */
export function buildRowHeaderGrid(axis: AxisLeaf[], numLevels: number): (HeaderCell | null)[][] {
  const runs = computeHeaderRuns(axis, numLevels);
  const grid: (HeaderCell | null)[][] = axis.map(() => new Array(Math.max(numLevels, 1)).fill(null));
  for (const run of runs) {
    const isOwnLabelCell = run.cellKind === 'subtotal' || run.cellKind === 'grandtotal' || run.cellKind === 'collapsed';
    grid[run.startIndex][run.level] = {
      label: run.label,
      rowSpan: isOwnLabelCell ? 1 : run.length,
      colSpan: isOwnLabelCell ? run.levelSpan : 1,
      pathKey: run.pathKey,
      cellKind: run.cellKind,
    };
  }
  return grid;
}

// --- Cell values, computed from a base grid (see file header perf note) ---

interface BaseAssignment {
  /** Axis leaves that are 'leaf' or 'collapsed' — the finest grain, partitioning every raw row exactly once. */
  baseAxis: AxisLeaf[];
  /** Maps every axis entry (base or rollup) to the base-axis ordinals it aggregates over. */
  baseOrdinalsOf: Map<AxisLeaf, number[]>;
  /** rawToBase[rawRowIndex] = ordinal into baseAxis. */
  rawToBase: Int32Array;
}

function assignBaseOrdinals(axis: AxisLeaf[], rowCount: number): BaseAssignment {
  const baseAxis = axis.filter((l) => l.kind === 'leaf' || l.kind === 'collapsed');
  const rawToBase = new Int32Array(rowCount).fill(-1);
  baseAxis.forEach((leaf, ordinal) => {
    for (const rawIdx of leaf.indices) rawToBase[rawIdx] = ordinal;
  });

  const basePaths = baseAxis.map((b) => b.path);
  const baseOrdinalsOf = new Map<AxisLeaf, number[]>();
  baseAxis.forEach((leaf, ordinal) => baseOrdinalsOf.set(leaf, [ordinal]));

  for (const item of axis) {
    if (item.kind === 'leaf' || item.kind === 'collapsed') continue;
    const prefix = item.path;
    const matches: number[] = [];
    for (let i = 0; i < basePaths.length; i++) {
      if (prefix.length === 0 || pathStartsWith(basePaths[i], prefix)) matches.push(i);
    }
    baseOrdinalsOf.set(item, matches);
  }

  return { baseAxis, baseOrdinalsOf, rawToBase };
}

function pathStartsWith(path: string[], prefix: string[]): boolean {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

export interface PivotTableResult {
  rowAxis: AxisLeaf[];
  columnAxis: AxisLeaf[];
  /** The row/column fields actually used — may be shorter than what was passed in if an all-null field was dropped (see dropAllNullFields). */
  effectiveRowFields: string[];
  effectiveColumnFields: string[];
  getCell(rowLeaf: AxisLeaf, columnLeaf: AxisLeaf, measure: MeasureConfig): number | null;
}

export function buildPivotTable(
  data: DataRow[],
  rowFieldsInput: string[],
  columnFieldsInput: string[],
  measures: MeasureConfig[],
  rowTotalsPosition: TotalsPosition,
  columnTotalsPosition: TotalsPosition,
  conditionalTotals: ConditionalTotalRule,
  collapsedRowPaths: ReadonlySet<string>,
  collapsedColumnPaths: ReadonlySet<string>,
  sort: SortState = { columnPath: null, measureFieldName: null, direction: 'desc' },
): PivotTableResult {
  const rowFields = dropAllNullFields(rowFieldsInput, data);
  const columnFields = dropAllNullFields(columnFieldsInput, data);

  const primaryMeasure = measures[0];

  const rowSortContext: RowSortContext | null =
    sort.columnPath && sort.measureFieldName
      ? { columnIndices: computeColumnMatchIndices(data, columnFields, sort.columnPath), measureFieldName: sort.measureFieldName, direction: sort.direction }
      : null;

  const rowTree = buildTree(data, rowFields, collapsedRowPaths, rowSortContext);
  const columnTree = buildTree(data, columnFields, collapsedColumnPaths);

  const rowAxis = flattenAxis(data, rowTree, rowFields, rowTotalsPosition, conditionalTotals, primaryMeasure);
  const columnAxis = flattenAxis(data, columnTree, columnFields, columnTotalsPosition, conditionalTotals, primaryMeasure);

  const allIndices = data.map((_, i) => i);
  if (shouldShowTotal(data, rowTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    const grandTotal: AxisLeaf = { path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' };
    if (rowTotalsPosition === 'before') rowAxis.unshift(grandTotal);
    else rowAxis.push(grandTotal);
  }
  if (shouldShowTotal(data, columnTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    const grandTotal: AxisLeaf = { path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' };
    if (columnTotalsPosition === 'before') columnAxis.unshift(grandTotal);
    else columnAxis.push(grandTotal);
  }

  const rowAssignment = assignBaseOrdinals(rowAxis, data.length);
  const colAssignment = assignBaseOrdinals(columnAxis, data.length);

  const numBaseRows = rowAssignment.baseAxis.length;
  const numBaseCols = colAssignment.baseAxis.length;
  const numMeasures = measures.length;
  const baseSum = new Float64Array(numBaseRows * numBaseCols * numMeasures);
  const baseSeen = new Uint8Array(numBaseRows * numBaseCols * numMeasures);

  for (let rawIdx = 0; rawIdx < data.length; rawIdx++) {
    const br = rowAssignment.rawToBase[rawIdx];
    const bc = colAssignment.rawToBase[rawIdx];
    if (br < 0 || bc < 0) continue;
    const row = data[rawIdx];
    const base = (br * numBaseCols + bc) * numMeasures;
    for (let mi = 0; mi < numMeasures; mi++) {
      const v = row[measures[mi].fieldName];
      if (typeof v === 'number') {
        baseSum[base + mi] += v;
        baseSeen[base + mi] = 1;
      }
    }
  }

  function getCell(rowLeaf: AxisLeaf, columnLeaf: AxisLeaf, measure: MeasureConfig): number | null {
    const mi = measures.indexOf(measure);
    if (mi < 0) return null;
    const rowOrdinals = rowAssignment.baseOrdinalsOf.get(rowLeaf);
    const colOrdinals = colAssignment.baseOrdinalsOf.get(columnLeaf);
    if (!rowOrdinals || !colOrdinals) return null;

    let sum = 0;
    let sawValue = false;
    for (const r of rowOrdinals) {
      const rowBase = r * numBaseCols;
      for (const c of colOrdinals) {
        const idx = (rowBase + c) * numMeasures + mi;
        if (baseSeen[idx]) {
          sum += baseSum[idx];
          sawValue = true;
        }
      }
    }
    return sawValue ? sum : null;
  }

  return { rowAxis, columnAxis, effectiveRowFields: rowFields, effectiveColumnFields: columnFields, getCell };
}
