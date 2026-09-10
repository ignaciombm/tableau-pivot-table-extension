// Core pivot aggregation engine: groups flat worksheet rows into a row axis and
// a column axis (each a flat, ordered list of leaves/subtotals/grand-total),
// and exposes cell lookups by intersecting the two axes' underlying row sets.
//
// Aggregation is intentionally limited to sum/count (see MeasureConfig) to match
// the governance requirements — Tableau's own worksheet aggregation already runs
// upstream when the summary data is fetched, so this only re-aggregates across
// the rows a pivot cell/subtotal/grand-total groups together.

import type { ConditionalTotalRule, DataRow, MeasureConfig, TotalsMode } from '../types';

export type AxisLeafKind = 'leaf' | 'subtotal' | 'grandtotal';

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

interface GroupNode {
  key: string;
  path: string[];
  isLeaf: boolean;
  indices: number[];
  children: GroupNode[];
}

function stringifyKey(value: DataRow[string]): string {
  if (value === null || value === undefined) return '(No value)';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildTree(data: DataRow[], fields: string[]): GroupNode[] {
  const rootIndices = data.map((_, i) => i);
  if (fields.length === 0) {
    return [{ key: '__all__', path: [], isLeaf: true, indices: rootIndices, children: [] }];
  }
  return buildLevel(data, fields, 0, [], rootIndices);
}

function buildLevel(
  data: DataRow[],
  fields: string[],
  level: number,
  parentPath: string[],
  indices: number[],
): GroupNode[] {
  const fieldName = fields[level];
  const groups = new Map<string, number[]>();
  for (const idx of indices) {
    const key = stringifyKey(data[idx][fieldName]);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(idx);
  }

  const isLeafLevel = level === fields.length - 1;
  const nodes: GroupNode[] = [];
  for (const [key, groupIndices] of groups) {
    const path = [...parentPath, key];
    nodes.push({
      key,
      path,
      isLeaf: isLeafLevel,
      indices: isLeafLevel ? groupIndices : [],
      children: isLeafLevel ? [] : buildLevel(data, fields, level + 1, path, groupIndices),
    });
  }
  nodes.sort((a, b) => a.key.localeCompare(b.key, 'en-US', { numeric: true }));
  return nodes;
}

function collectIndices(node: GroupNode): number[] {
  if (node.isLeaf) return node.indices;
  return node.children.flatMap(collectIndices);
}

export function aggregateMeasure(data: DataRow[], indices: number[], measure: MeasureConfig): number | null {
  if (measure.aggregation === 'count') return indices.length;
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
        kind: 'leaf',
        depth,
        indices: node.indices,
        label: node.key,
      });
    } else {
      leaves.push(
        ...flattenAxis(data, node.children, fields, totalsEnabled, conditionalTotals, primaryMeasure, depth + 1),
      );
      if (totalsEnabled) {
        const groupIndices = collectIndices(node);
        if (shouldShowTotal(data, node.children.length, groupIndices, conditionalTotals, primaryMeasure)) {
          leaves.push({
            path: node.path,
            fieldPath: fields.slice(0, node.path.length),
            kind: 'subtotal',
            depth,
            indices: groupIndices,
            label: `${node.key} Total`,
          });
        }
      }
    }
  }
  return leaves;
}

export interface HeaderCell {
  label: string;
  colSpan: number;
  rowSpan: number;
}

/**
 * Builds merged header rows for an axis (one row per grouping field level), the
 * way a spreadsheet pivot table does: an ancestor field's header spans across
 * all of its descendant columns *and* its own subtotal column, while a
 * subtotal/grand-total gets its own single header cell that instead spans
 * downward (rowSpan) through the remaining, unused field levels.
 *
 * `numLevels` is the axis's field count (rowFields.length / columnFields.length);
 * colSpan is expressed in axis-leaf units — the caller multiplies by the number
 * of measures to get actual table-column spans.
 */
export function buildHeaderRows(axis: AxisLeaf[], numLevels: number): HeaderCell[][] {
  if (numLevels === 0) {
    return [axis.map((item) => ({ label: item.label, colSpan: 1, rowSpan: 1 }))];
  }

  const SEP = '';
  const ownDepth = (item: AxisLeaf) => (item.kind === 'grandtotal' ? -1 : item.depth);

  function identity(item: AxisLeaf, level: number): string | null {
    if (item.kind === 'leaf') return item.path.slice(0, level + 1).join(SEP);
    const s = ownDepth(item);
    if (level <= s) return item.path.slice(0, level + 1).join(SEP);
    if (level === s + 1) return item.kind === 'grandtotal' ? 'GRANDTOTAL' : `${item.path.join(SEP)}${SEP}TOTAL`;
    return null;
  }

  const rows: HeaderCell[][] = [];
  for (let level = 0; level < numLevels; level++) {
    const row: HeaderCell[] = [];
    let i = 0;
    while (i < axis.length) {
      const id = identity(axis[i], level);
      if (id === null) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < axis.length && identity(axis[j], level) === id) j++;
      const groupSize = j - i;
      const first = axis[i];
      const isOwnLabelCell = groupSize === 1 && level === ownDepth(first) + 1 && first.kind !== 'leaf';
      row.push({
        label: isOwnLabelCell ? first.label : first.path[level],
        colSpan: groupSize,
        rowSpan: isOwnLabelCell ? numLevels - level : 1,
      });
      i = j;
    }
    rows.push(row);
  }
  return rows;
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
  conditionalTotals: ConditionalTotalRule,
): PivotTableResult {
  const rowTotalsEnabled = totalsMode === 'rows' || totalsMode === 'both';
  const columnTotalsEnabled = totalsMode === 'columns' || totalsMode === 'both';
  const primaryMeasure = measures[0];

  const rowTree = buildTree(data, rowFields);
  const columnTree = buildTree(data, columnFields);

  const rowAxis = flattenAxis(data, rowTree, rowFields, rowTotalsEnabled, conditionalTotals, primaryMeasure);
  const columnAxis = flattenAxis(data, columnTree, columnFields, columnTotalsEnabled, conditionalTotals, primaryMeasure);

  const allIndices = data.map((_, i) => i);
  if (rowTotalsEnabled && shouldShowTotal(data, rowTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    rowAxis.push({ path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' });
  }
  if (columnTotalsEnabled && shouldShowTotal(data, columnTree.length, allIndices, conditionalTotals, primaryMeasure)) {
    columnAxis.push({ path: [], fieldPath: [], kind: 'grandtotal', depth: 0, indices: allIndices, label: 'Grand Total' });
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
