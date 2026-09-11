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

  // Plain `width` on a table cell is only ever a *hint* to the browser's
  // auto-layout algorithm — and, empirically, a hint it happily ignores for a
  // rowSpan>1 cell (our corner cells and any ancestor-covered row-header
  // cell both are) once the table as a whole needs to overflow its
  // scrollable wrapper. In that combination the browser falls back to
  // content-based sizing regardless of the specified width — `min-width` (and
  // `max-width`, to keep it from growing past that for a long label) is what
  // actually gets honored. Verified interactively: the same table with only
  // `width` set stays content-sized under horizontal overflow; adding
  // matching `min-width`/`max-width` makes the resize take effect.
  function fixedWidthStyle(width: number): React.CSSProperties {
    return { width, minWidth: width, maxWidth: width };
  }

  // Pointer capture (rather than window-level mouse listeners) so the drag
  // keeps working even if the cursor leaves the extension's iframe bounds
  // mid-drag, which a plain `window.addEventListener('mousemove', ...)`
  // cannot survive — the browser stops delivering those events to us once
  // the pointer exits our frame.
  //
  // Width updates are throttled to one per animation frame rather than one
  // per native pointermove: a pointermove can fire far more often than the
  // screen repaints (especially with a high-poll-rate mouse/trackpad), and
  // each width change re-renders every row's header cell — on a pivot table
  // with many rows, applying every single event synchronously can flood the
  // render queue badly enough to freeze the tab mid-drag.
  function handleResizeStart(level: number, startEvent: React.PointerEvent<HTMLDivElement>) {
    startEvent.preventDefault();
    const handle = startEvent.currentTarget;
    // setPointerCapture can throw (e.g. "No active pointer with the given id")
    // depending on exactly how the host embeds this iframe — since this runs
    // straight from a React event handler with no error boundary in place, an
    // uncaught exception here would crash and unmount the whole extension.
    // It's attempted purely as a best-effort robustness improvement (see
    // below for why the drag doesn't actually depend on it succeeding).
    try {
      handle.setPointerCapture(startEvent.pointerId);
    } catch {
      // Ignored — see the `document`-level listeners below for why the drag
      // still works without it.
    }
    const startX = startEvent.clientX;
    const startWidth = localRowColumnWidths[level] ?? DEFAULT_ROW_COLUMN_WIDTH;
    let rafId: number | null = null;
    let pendingWidth: number | null = null;

    function applyWidth(width: number) {
      setLocalRowColumnWidths((prev) => {
        const next = [...prev];
        next[level] = width;
        return next;
      });
    }

    function onMove(e: Event) {
      const pointerEvent = e as PointerEvent;
      pendingWidth = Math.max(MIN_ROW_COLUMN_WIDTH, startWidth + (pointerEvent.clientX - startX));
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingWidth !== null) applyWidth(pendingWidth);
        });
      }
    }
    function onUp() {
      try {
        handle.releasePointerCapture(startEvent.pointerId);
      } catch {
        // Ignored — see the matching try/catch around setPointerCapture above.
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (pendingWidth !== null) applyWidth(pendingWidth);
      setLocalRowColumnWidths((current) => {
        onDisplayStateChange({ ...displayState, rowColumnWidths: current });
        return current;
      });
    }
    // Listening on `document` rather than the 6px-wide handle itself is what
    // actually makes the drag work: a captured pointer's events still bubble
    // up through the DOM as normal, so `document` keeps receiving them either
    // way, but listening on the handle directly depends on setPointerCapture
    // having succeeded — the instant the cursor leaves that narrow strip
    // (immediately, in any real drag) with capture unavailable, the handle
    // stops being "under the pointer" and would never see another event.
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
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
  // A header cell is sortable when it has its own unambiguous path — a leaf,
  // or a subtotal/grand-total/collapsed group's own label cell — regardless
  // of which header row it happens to render in. A grand-total's own cell
  // always starts at level 0 (it spans down through every header row), so
  // gating on "is this the deepest header row" would make it unclickable
  // whenever there's more than one column level.
  function isSortableHeaderCell(cell: HeaderCell): boolean {
    return cell.cellKind !== 'ancestor' && !!primaryMeasureFieldName;
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
                          style={
                            isDeepest
                              ? { position: 'sticky', top: 0, left: 0, ...fixedWidthStyle(width) }
                              : { position: 'static', ...fixedWidthStyle(width) }
                          }
                        >
                          {/* One handle per row-header level, including the last — its right
                              edge is the boundary against the data columns, and without a
                              handle there that level (e.g. the innermost dimension) could
                              never be resized at all. */}
                          <div className="resize-handles" style={{ height: cornerHeight }}>
                            <div className="resize-handle" style={{ right: -3 }} onPointerDown={(e) => handleResizeStart(i, e)} />
                          </div>
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
                        isSortableHeaderCell(cell) ? 'sortable' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onClick={isSortableHeaderCell(cell) ? () => handleSortClick(cell.path, primaryMeasureFieldName!) : undefined}
                      title={isSortableHeaderCell(cell) ? 'Click to sort rows by this column' : undefined}
                    >
                      <CollapseToggle cell={cell} onToggle={toggleColumnPath} />
                      {cell.label}
                      {isSortableHeaderCell(cell) && isSortedBy(cell.path, primaryMeasureFieldName!) && (
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
                  if (cell.colSpan > 1) {
                    // Own-label cell (subtotal/grand-total/collapsed) spanning multiple
                    // row-header levels because it has no further breakdown below it —
                    // e.g. Grand Total's own label always starts at level 0. Split it
                    // into one <td> per level, the same idea as the corner cell: only
                    // the deepest one stays pinned (and carries the label), so the
                    // shallower ones scroll away with their column instead of dragging
                    // the combined width of every level along with them.
                    return Array.from({ length: cell.colSpan }, (_, i) => {
                      const splitLevel = level + i;
                      const isDeepestSplit = i === cell.colSpan - 1;
                      return (
                        <td
                          key={`${level}-${i}`}
                          className={`row-header${cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? ' total-header' : ''}`}
                          rowSpan={cell.rowSpan}
                          style={
                            isDeepestSplit
                              ? { position: 'sticky', left: 0, ...fixedWidthStyle(widthOfSpan(splitLevel, 1)) }
                              : { position: 'static', ...fixedWidthStyle(widthOfSpan(splitLevel, 1)) }
                          }
                        >
                          {isDeepestSplit && <CollapseToggle cell={cell} onToggle={toggleRowPath} />}
                          {isDeepestSplit ? cell.label : ''}
                        </td>
                      );
                    });
                  }
                  const isDeepest = cell.cellKind !== 'ancestor';
                  return (
                    <td
                      key={level}
                      className={`row-header${cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? ' total-header' : ''}`}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      style={
                        isDeepest
                          ? { position: 'sticky', left: 0, ...fixedWidthStyle(widthOfSpan(level, cell.colSpan)) }
                          : { position: 'static', ...fixedWidthStyle(widthOfSpan(level, cell.colSpan)) }
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
