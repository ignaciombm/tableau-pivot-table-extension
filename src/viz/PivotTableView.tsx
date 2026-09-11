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

  // --- Row-header column widths (user-resizable). Only the deepest level is
  // ever sticky (see the cellKind !== 'ancestor' checks in rendering below) —
  // shallower levels scroll away normally, since their group is already
  // labeled by its own subtotal row, and pinning every level wastes width. ---

  const [localRowColumnWidths, setLocalRowColumnWidths] = useState<number[]>(() =>
    Array.from({ length: numRowLevels }, (_, i) => displayState.rowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH),
  );
  useEffect(() => {
    setLocalRowColumnWidths(Array.from({ length: numRowLevels }, (_, i) => displayState.rowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH));
  }, [displayState.rowColumnWidths, numRowLevels]);

  function widthOfSpan(level: number, span: number): number {
    let sum = 0;
    for (let i = level; i < level + span && i < localRowColumnWidths.length; i++) sum += localRowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH;
    return sum;
  }

  // Pointer capture (rather than window-level mouse listeners) so the drag
  // keeps working even if the cursor leaves the extension's iframe bounds
  // mid-drag, which a plain `window.addEventListener('mousemove', ...)`
  // cannot survive — the browser stops delivering those events to us once
  // the pointer exits our frame.
  function handleResizeStart(level: number, startEvent: React.PointerEvent<HTMLDivElement>) {
    startEvent.preventDefault();
    const handle = startEvent.currentTarget;
    handle.setPointerCapture(startEvent.pointerId);
    const startX = startEvent.clientX;
    const startWidth = localRowColumnWidths[level] ?? DEFAULT_ROW_COLUMN_WIDTH;

    function onMove(e: PointerEvent) {
      const nextWidth = Math.max(MIN_ROW_COLUMN_WIDTH, startWidth + (e.clientX - startX));
      setLocalRowColumnWidths((prev) => {
        const next = [...prev];
        next[level] = nextWidth;
        return next;
      });
    }
    function onUp() {
      handle.releasePointerCapture(startEvent.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      setLocalRowColumnWidths((current) => {
        onDisplayStateChange({ ...displayState, rowColumnWidths: current });
        return current;
      });
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  const numHeaderRows = columnHeaderRows.length + (measures.length > 0 && !hideMeasureHeaderRow ? 1 : 0);
  const cornerHeight = numHeaderRows * HEADER_ROW_HEIGHT;

  function toggleRowPath(pathKey: string) {
    onDisplayStateChange({ ...displayState, collapsedRowPaths: toggledPath(displayState.collapsedRowPaths, pathKey) });
  }
  function toggleColumnPath(pathKey: string) {
    onDisplayStateChange({ ...displayState, collapsedColumnPaths: toggledPath(displayState.collapsedColumnPaths, pathKey) });
  }
  function handleSortClick(columnPath: string[], measureFieldName: string) {
    const isSameColumn = displayState.sort.measureFieldName === measureFieldName && pathsEqual(displayState.sort.columnPath, columnPath);
    const nextDirection = isSameColumn && displayState.sort.direction === 'desc' ? 'asc' : 'desc';
    onDisplayStateChange({ ...displayState, sort: { columnPath, measureFieldName, direction: nextDirection } });
  }
  function isSortedBy(columnPath: string[], measureFieldName: string): boolean {
    return displayState.sort.measureFieldName === measureFieldName && pathsEqual(displayState.sort.columnPath, columnPath);
  }

  const rowHeaderSpan = Math.max(1, numRowLevels);
  const numMeasures = Math.max(1, measures.length);
  const primaryMeasureFieldName = measures[0]?.fieldName;

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
            {columnHeaderRows.map((headerRow, level) => {
              const isDeepestColumnLevel = level === columnHeaderRows.length - 1;
              return (
                <tr key={`col-h-${level}`}>
                  {level === 0 &&
                    Array.from({ length: rowHeaderSpan }, (_, i) => i).map((i) => {
                      const isDeepest = i >= numRowLevels - 1;
                      const width = localRowColumnWidths[i] ?? DEFAULT_ROW_COLUMN_WIDTH;
                      return (
                        <th
                          key={`corner-${i}`}
                          className="corner-cell"
                          rowSpan={numHeaderRows}
                          style={isDeepest ? { position: 'sticky', top: 0, left: 0, width } : { position: 'static', width }}
                        >
                          {i < rowHeaderSpan - 1 && (
                            <div className="resize-handles" style={{ height: cornerHeight }}>
                              <div className="resize-handle" style={{ right: -3 }} onPointerDown={(e) => handleResizeStart(i, e)} />
                            </div>
                          )}
                        </th>
                      );
                    })}
                  {headerRow.map((cell, cellIndex) => (
                    <th
                      key={`${level}-${cellIndex}`}
                      colSpan={cell.colSpan * numMeasures}
                      rowSpan={cell.rowSpan}
                      style={{ top: level * HEADER_ROW_HEIGHT }}
                      className={[
                        cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? 'total-header' : '',
                        isDeepestColumnLevel && primaryMeasureFieldName ? 'sortable' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onClick={isDeepestColumnLevel && primaryMeasureFieldName ? () => handleSortClick(cell.path, primaryMeasureFieldName) : undefined}
                      title={isDeepestColumnLevel && primaryMeasureFieldName ? 'Click to sort rows by this column' : undefined}
                    >
                      <CollapseToggle cell={cell} onToggle={toggleColumnPath} />
                      {cell.label}
                      {isDeepestColumnLevel && primaryMeasureFieldName && isSortedBy(cell.path, primaryMeasureFieldName) && (
                        <span className="sort-indicator">{displayState.sort.direction === 'asc' ? ' ▲' : ' ▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              );
            })}
            {measures.length > 0 && !hideMeasureHeaderRow && (
              <tr>
                {pivot.columnAxis.map((colLeaf, c) =>
                  measures.map((m, mi) => (
                    <th
                      key={`${c}-${mi}`}
                      className="measure-header"
                      style={{ top: numColumnLevels * HEADER_ROW_HEIGHT }}
                      onClick={() => handleSortClick(colLeaf.path, m.fieldName)}
                      title="Click to sort rows by this column"
                    >
                      {getMeasureFormat(displayState, m.fieldName).label || m.fieldName}
                      {isSortedBy(colLeaf.path, m.fieldName) && (
                        <span className="sort-indicator">{displayState.sort.direction === 'asc' ? ' ▲' : ' ▼'}</span>
                      )}
                    </th>
                  )),
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {pivot.rowAxis.map((rowLeaf, r) => (
              <tr key={rowKeyOf(rowLeaf)} className={rowLeaf.kind === 'subtotal' || rowLeaf.kind === 'grandtotal' ? 'total-row' : undefined}>
                {rowHeaderGrid[r].map((cell, level) => {
                  if (cell === null) return null;
                  const isDeepest = cell.cellKind !== 'ancestor';
                  return (
                    <td
                      key={level}
                      className={`row-header${cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? ' total-header' : ''}`}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      style={
                        isDeepest
                          ? { position: 'sticky', left: 0, width: widthOfSpan(level, cell.colSpan) }
                          : { position: 'static', width: widthOfSpan(level, cell.colSpan) }
                      }
                    >
                      <CollapseToggle cell={cell} onToggle={toggleRowPath} />
                      {cell.label}
                    </td>
                  );
                })}
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
