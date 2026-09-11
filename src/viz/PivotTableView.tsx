import { useEffect, useMemo, useState } from 'react';
import type { DataRow, MeasureConfig, PivotDisplayState } from '../types';
import { buildHeaderRows, buildPivotTable, buildRowHeaderGrid, type AxisLeaf, type HeaderCell } from '../lib/pivotEngine';
import { buildPeriodComparisonPlan, cellKey, computeHeatmapColors, getPeriodComparisonColor, type HeatmapContext } from '../lib/colorEngine';
import { formatMeasureValue } from '../lib/parsing';
import { DEFAULT_ROW_COLUMN_WIDTH, getMeasureFormat } from '../lib/settingsSchema';
import { buildPivotCsv, downloadCsv } from '../lib/csvExport';

interface Props {
  data: DataRow[];
  rowFields: string[];
  columnFields: string[];
  measures: MeasureConfig[];
  displayState: PivotDisplayState;
  onDisplayStateChange: (next: PivotDisplayState) => void;
}

/** Every header/body cell is forced to this height (see viz.css) so sticky offsets can be computed as simple multiples instead of measuring the DOM. */
const HEADER_ROW_HEIGHT = 25;
const MIN_ROW_COLUMN_WIDTH = 60;

function rowKeyOf(leaf: AxisLeaf): string {
  return `${leaf.kind}:${leaf.path.join('/')}`;
}

function isRollup(leaf: AxisLeaf): boolean {
  return leaf.kind !== 'leaf';
}

function toggledPath(paths: string[], pathKey: string): string[] {
  return paths.includes(pathKey) ? paths.filter((p) => p !== pathKey) : [...paths, pathKey];
}

function pathsEqual(a: string[] | null, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

function CollapseToggle({ cell, onToggle }: { cell: HeaderCell; onToggle: (pathKey: string) => void }) {
  if (cell.cellKind === 'ancestor') {
    return (
      <button type="button" className="collapse-toggle" onClick={() => onToggle(cell.pathKey)} aria-label="Collapse group" title="Collapse">
        ▾
      </button>
    );
  }
  if (cell.cellKind === 'collapsed') {
    return (
      <button type="button" className="collapse-toggle" onClick={() => onToggle(cell.pathKey)} aria-label="Expand group" title="Expand">
        ▸
      </button>
    );
  }
  return null;
}

export function PivotTableView({ data, rowFields, columnFields, measures, displayState, onDisplayStateChange }: Props) {
  const { rowTotalsPosition, columnTotalsPosition, conditionalTotals, formatting, hideMeasureHeaderRow } = displayState;
  const collapsedRowPaths = useMemo(() => new Set(displayState.collapsedRowPaths), [displayState.collapsedRowPaths]);
  const collapsedColumnPaths = useMemo(() => new Set(displayState.collapsedColumnPaths), [displayState.collapsedColumnPaths]);

  const pivot = useMemo(
    () =>
      buildPivotTable(
        data,
        rowFields,
        columnFields,
        measures,
        rowTotalsPosition,
        columnTotalsPosition,
        conditionalTotals,
        collapsedRowPaths,
        collapsedColumnPaths,
        displayState.sort,
      ),
    [
      data,
      rowFields,
      columnFields,
      measures,
      rowTotalsPosition,
      columnTotalsPosition,
      conditionalTotals,
      collapsedRowPaths,
      collapsedColumnPaths,
      displayState.sort,
    ],
  );

  const numRowLevels = pivot.effectiveRowFields.length;
  const numColumnLevels = pivot.effectiveColumnFields.length;

  const columnHeaderRows = useMemo(() => buildHeaderRows(pivot.columnAxis, numColumnLevels), [pivot.columnAxis, numColumnLevels]);
  const rowHeaderGrid = useMemo(() => buildRowHeaderGrid(pivot.rowAxis, numRowLevels), [pivot.rowAxis, numRowLevels]);

  const cellMatrix = useMemo(
    () => pivot.rowAxis.map((rowLeaf) => pivot.columnAxis.map((colLeaf) => measures.map((m) => pivot.getCell(rowLeaf, colLeaf, m)))),
    [pivot, measures],
  );

  const columnIndexOf = useMemo(() => new Map(pivot.columnAxis.map((leaf, i) => [leaf, i])), [pivot.columnAxis]);
  const rowIndexOf = useMemo(() => new Map(pivot.rowAxis.map((leaf, i) => [leaf, i])), [pivot.rowAxis]);

  const periodPlan = useMemo(() => {
    if (formatting.colorMode !== 'periodComparison' || !formatting.periodComparison.periodField) return new Map<AxisLeaf, AxisLeaf | null>();
    return buildPeriodComparisonPlan(pivot.columnAxis, pivot.effectiveColumnFields, formatting.periodComparison.periodField);
  }, [formatting.colorMode, formatting.periodComparison.periodField, pivot.columnAxis, pivot.effectiveColumnFields]);

  const heatmapColorsByMeasure = useMemo(() => {
    if (formatting.colorMode !== 'heatmap') return [];
    return measures.map((_, measureIndex) => {
      const ctx: HeatmapContext = {
        rowAxis: pivot.rowAxis,
        columnAxis: pivot.columnAxis,
        rowFields: pivot.effectiveRowFields,
        columnFields: pivot.effectiveColumnFields,
        getValue: (row, column) => cellMatrix[rowIndexOf.get(row)!][columnIndexOf.get(column)!][measureIndex],
      };
      return computeHeatmapColors(ctx, formatting.heatmap);
    });
  }, [formatting.colorMode, formatting.heatmap, pivot, cellMatrix, measures, rowIndexOf, columnIndexOf]);

  function colorForCell(rowIndex: number, colIndex: number, measureIndex: number): string | undefined {
    if (formatting.colorMode === 'periodComparison') {
      const colLeaf = pivot.columnAxis[colIndex];
      const previousLeaf = periodPlan.get(colLeaf);
      if (previousLeaf) {
        const previousColIndex = columnIndexOf.get(previousLeaf)!;
        const currentValue = cellMatrix[rowIndex][colIndex][measureIndex];
        const previousValue = cellMatrix[rowIndex][previousColIndex][measureIndex];
        return getPeriodComparisonColor(currentValue, previousValue, formatting.periodComparison) ?? undefined;
      }
      return undefined;
    }
    if (formatting.colorMode === 'heatmap') {
      const key = cellKey(pivot.rowAxis[rowIndex], pivot.columnAxis[colIndex]);
      return heatmapColorsByMeasure[measureIndex]?.get(key);
    }
    return undefined;
  }

  // --- Column widths for the row-header levels, and the sticky left/top offsets derived from them ---

  const [localRowColumnWidths, setLocalRowColumnWidths] = useState<number[]>(() =>
    Array.from({ length: numRowLevels }, (_, i) => displayState.rowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH),
  );
  useEffect(() => {
    setLocalRowColumnWidths(Array.from({ length: numRowLevels }, (_, i) => displayState.rowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH));
  }, [displayState.rowColumnWidths, numRowLevels]);

  const rowColumnLeftOffsets = useMemo(() => {
    const offsets: number[] = [];
    let cumulative = 0;
    for (const width of localRowColumnWidths) {
      offsets.push(cumulative);
      cumulative += width;
    }
    return offsets;
  }, [localRowColumnWidths]);
  const totalRowHeaderWidth = rowColumnLeftOffsets[numRowLevels - 1] !== undefined ? rowColumnLeftOffsets[numRowLevels - 1] + localRowColumnWidths[numRowLevels - 1] : DEFAULT_ROW_COLUMN_WIDTH;

  function widthOfSpan(level: number, span: number): number {
    let sum = 0;
    for (let i = level; i < level + span && i < localRowColumnWidths.length; i++) sum += localRowColumnWidths[i];
    return sum;
  }

  function handleResizeStart(level: number, startEvent: React.MouseEvent) {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = localRowColumnWidths[level] ?? DEFAULT_ROW_COLUMN_WIDTH;

    function onMove(e: MouseEvent) {
      const nextWidth = Math.max(MIN_ROW_COLUMN_WIDTH, startWidth + (e.clientX - startX));
      setLocalRowColumnWidths((prev) => {
        const next = [...prev];
        next[level] = nextWidth;
        return next;
      });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setLocalRowColumnWidths((current) => {
        onDisplayStateChange({ ...displayState, rowColumnWidths: current });
        return current;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const numHeaderRows = columnHeaderRows.length + (measures.length > 0 && !hideMeasureHeaderRow ? 1 : 0);
  const cornerHeight = numHeaderRows * HEADER_ROW_HEIGHT;

  function toggleRowPath(pathKey: string) {
    onDisplayStateChange({ ...displayState, collapsedRowPaths: toggledPath(displayState.collapsedRowPaths, pathKey) });
  }
  function toggleColumnPath(pathKey: string) {
    onDisplayStateChange({ ...displayState, collapsedColumnPaths: toggledPath(displayState.collapsedColumnPaths, pathKey) });
  }
  function handleSortClick(columnLeaf: AxisLeaf, measureFieldName: string) {
    const isSameColumn = displayState.sort.measureFieldName === measureFieldName && pathsEqual(displayState.sort.columnPath, columnLeaf.path);
    const nextDirection = isSameColumn && displayState.sort.direction === 'desc' ? 'asc' : 'desc';
    onDisplayStateChange({ ...displayState, sort: { columnPath: columnLeaf.path, measureFieldName, direction: nextDirection } });
  }

  const rowHeaderSpan = Math.max(1, numRowLevels);
  const numMeasures = Math.max(1, measures.length);

  function handleDownloadCsv() {
    downloadCsv('pivot-table.csv', buildPivotCsv(pivot, measures.length > 0 ? measures : [{ fieldName: 'Count' }], displayState));
  }

  return (
    <div className="pivot-table-container">
      <div className="pivot-table-toolbar">
        <button type="button" className="download-csv-button" onClick={handleDownloadCsv} disabled={pivot.rowAxis.length === 0}>
          Download CSV
        </button>
      </div>
      <div className="pivot-table-wrapper">
        <table className="pivot-table">
          <thead>
            {columnHeaderRows.map((headerRow, level) => (
              <tr key={`col-h-${level}`}>
                {level === 0 && (
                  <th className="corner-cell" rowSpan={numHeaderRows} colSpan={rowHeaderSpan} style={{ top: 0, left: 0, width: totalRowHeaderWidth }}>
                    <div className="resize-handles" style={{ height: cornerHeight }}>
                      {Array.from({ length: Math.max(numRowLevels - 1, 0) }, (_, i) => i).map((i) => (
                        <div
                          key={i}
                          className="resize-handle"
                          style={{ left: rowColumnLeftOffsets[i + 1] - 3 }}
                          onMouseDown={(e) => handleResizeStart(i, e)}
                        />
                      ))}
                    </div>
                  </th>
                )}
                {headerRow.map((cell, cellIndex) => (
                  <th
                    key={`${level}-${cellIndex}`}
                    colSpan={cell.colSpan * numMeasures}
                    rowSpan={cell.rowSpan}
                    style={{ top: level * HEADER_ROW_HEIGHT }}
                    className={cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? 'total-header' : undefined}
                  >
                    <CollapseToggle cell={cell} onToggle={toggleColumnPath} />
                    {cell.label}
                  </th>
                ))}
              </tr>
            ))}
            {measures.length > 0 && !hideMeasureHeaderRow && (
              <tr>
                {pivot.columnAxis.map((colLeaf, c) =>
                  measures.map((m, mi) => {
                    const isSorted = displayState.sort.measureFieldName === m.fieldName && pathsEqual(displayState.sort.columnPath, colLeaf.path);
                    return (
                      <th
                        key={`${c}-${mi}`}
                        className="measure-header"
                        style={{ top: numColumnLevels * HEADER_ROW_HEIGHT }}
                        onClick={() => handleSortClick(colLeaf, m.fieldName)}
                        title="Click to sort rows by this column"
                      >
                        {getMeasureFormat(displayState, m.fieldName).label || m.fieldName}
                        {isSorted && <span className="sort-indicator">{displayState.sort.direction === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </th>
                    );
                  }),
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {pivot.rowAxis.map((rowLeaf, r) => (
              <tr key={rowKeyOf(rowLeaf)} className={rowLeaf.kind === 'subtotal' || rowLeaf.kind === 'grandtotal' ? 'total-row' : undefined}>
                {rowHeaderGrid[r].map((cell, level) =>
                  cell === null ? null : (
                    <td
                      key={level}
                      className={`row-header${cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? ' total-header' : ''}`}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      style={{ left: rowColumnLeftOffsets[level], width: widthOfSpan(level, cell.colSpan) }}
                    >
                      <CollapseToggle cell={cell} onToggle={toggleRowPath} />
                      {cell.label}
                    </td>
                  ),
                )}
                {pivot.columnAxis.map((colLeaf, c) =>
                  measures.map((m, mi) => {
                    const value = cellMatrix[r][c][mi];
                    const background = colorForCell(r, c, mi);
                    return (
                      <td
                        key={`${r}-${c}-${mi}`}
                        className={`cell${isRollup(colLeaf) ? ' total-column' : ''}`}
                        style={background ? { backgroundColor: background } : undefined}
                      >
                        {value === null ? '' : formatMeasureValue(value, getMeasureFormat(displayState, m.fieldName))}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
            {pivot.rowAxis.length === 0 && (
              <tr>
                <td colSpan={rowHeaderSpan + pivot.columnAxis.length * numMeasures}>No data to display.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
