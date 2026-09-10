// Core pivot aggregation engine: groups flat worksheet rows into a row axis and
// a column axis (each a flat, ordered list of leaves/subtotals/grand-total/
// collapsed-groups), and exposes cell lookups by intersecting the two axes'
// underlying row sets.
//
// Each row's measure values are already aggregated by Tableau (per whatever
// aggregation the creator chose when dropping the field onto the Measures
// encoding). This engine only re-aggregates by additive sum across the rows a
// pivot cell/subtotal/grand-total groups together — exact for Sum/Count-based
// measures, an approximation for Avg/Min/Max/CountD/Median.

import type { ConditionalTotalRule, DataRow, MeasureConfig, TotalsMode, TotalsPosition } from '../types';
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

interface GroupNode {
  key: string;
  /** Used only to order siblings; dates sort chronologically (ISO), everything else sorts by its display text. */
  sortKey: string;
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

function buildTree(data: DataRow[], fields: string[], collapsedPaths: ReadonlySet<string>): GroupNode[] {
  const rootIndices = data.map((_, i) => i);
  if (fields.length === 0) {
    return [{ key: '__all__', sortKey: '', path: [], isLeaf: true, isCollapsed: false, indices: rootIndices, children: [] }];
  }
  return buildLevel(data, fields, 0, [], rootIndices, collapsedPaths);
}

function buildLevel(
  data: DataRow[],
  fields: string[],
  level: number,
  parentPath: string[],
  indices: number[],
  collapsedPaths: ReadonlySet<string>,
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
      path,
      isLeaf,
      isCollapsed: collapsedHere,
      indices: isLeaf ? group.indices : [],
      children: isLeaf ? [] : buildLevel(data, fields, level + 1, path, group.indices, collapsedPaths),
    });
  }
  nodes.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'en-US', { numeric: true }));
  return nodes;
}

function collectIndices(node: GroupNode): number[] {
  if (node.isLeaf) return node.indices;
  return node.children.flatMap(collectIndices);
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
  if (rule.hideSingleItemGroups && childCount <= 1) return false;
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
  totalsEnabled: boolean,
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

    const childLeaves = flattenAxis(data, node.children, fields, totalsEnabled, totalsPosition, conditionalTotals, primaryMeasure, depth + 1);

    let subtotalLeaf: AxisLeaf | null = null;
    if (totalsEnabled) {
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
 * `numLevels` is columnFields.length; colSpan is expressed in axis-leaf units
 * — the caller multiplies by the number of measures for actual table columns.
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

export interface PivotTableResult {
  rowAxis: AxisLeaf[];
  columnAxis: AxisLeaf[];
  getCell(rowLeaf: AxisLeaf, columnLeaf: AxisLeaf, measure: MeasureConfig): number | null;
}

export function buildPivotTable(
  data: DataRow[],
  rowFields: string[],
  columnFields: string[],
  measures: MeasureConfig[],
  totalsMode: TotalsMode,
  rowTotalsPosition: TotalsPosition,
  columnTotalsPosition: TotalsPosition,
  conditionalTotals: ConditionalTotalRule,
  collapsedRowPaths: ReadonlySet<string>,
  collapsedColumnPaths: ReadonlySet<string>,
): PivotTableResult {
  const rowTotalsEnabled = totalsMode === 'rows' || totalsMode === 'both';
  const columnTotalsEnabled = totalsMode === 'columns' || totalsMode === 'both';
  const primaryMeasure = measures[0];

  const rowTree = buildTree(data, rowFields, collapsedRowPaths);
  const columnTree = buildTree(data, columnFields, collapsedColumnPaths);

  const rowAxis = flattenAxis(data, rowTree, rowFields, rowTotalsEnabled, rowTotalsPosition, conditionalTotals, primaryMeasure);
  const columnAxis = flattenAxis(data, columnTree, columnFields, columnTotalsEnabled, columnTotalsPosition, conditionalTotals, primaryMeasure);

  const allIndices = data.map((_, i) => i);
  if (rowTotalsEnabled && shouldShowTotal(data, rowTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    const grandTotal: AxisLeaf = { path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' };
    if (rowTotalsPosition === 'before') rowAxis.unshift(grandTotal);
    else rowAxis.push(grandTotal);
  }
  if (columnTotalsEnabled && shouldShowTotal(data, columnTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    const grandTotal: AxisLeaf = { path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' };
    if (columnTotalsPosition === 'before') columnAxis.unshift(grandTotal);
    else columnAxis.push(grandTotal);
  }

  function getCell(rowLeaf: AxisLeaf, columnLeaf: AxisLeaf, measure: MeasureConfig): number | null {
    const [smaller, larger] =
      rowLeaf.indices.length <= columnLeaf.indices.length
        ? [rowLeaf.indices, columnLeaf.indices]
        : [columnLeaf.indices, rowLeaf.indices];
    const largerSet = new Set(larger);
    const intersection: number[] = [];
    for (const idx of smaller) {
      if (largerSet.has(idx)) intersection.push(idx);
    }
    return aggregateMeasure(data, intersection, measure);
  }

  return { rowAxis, columnAxis, getCell };
}
