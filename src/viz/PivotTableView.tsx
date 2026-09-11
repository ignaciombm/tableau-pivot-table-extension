import { useMemo } from 'react';
import type { DataRow, MeasureConfig, PivotDisplayState } from '../types';
import { buildHeaderRows, buildPivotTable, buildRowHeaderGrid, type AxisLeaf, type HeaderCell } from '../lib/pivotEngine';
import { buildPeriodComparisonPlan, cellKey, computeHeatmapColors, getPeriodComparisonColor, type HeatmapContext } from '../lib/colorEngine';
import { formatMeasureValue } from '../lib/parsing';
import { getMeasureFormat } from '../lib/settingsSchema';
import { buildPivotCsv, downloadCsv } from '../lib/csvExport';

interface Props {
  data: DataRow[];
  rowFields: string[];
  columnFields: string[];
  measures: MeasureConfig[];
  displayState: PivotDisplayState;
  onToggleRowPath: (pathKey: string) => void;
  onToggleColumnPath: (pathKey: string) => void;
}

function rowKeyOf(leaf: AxisLeaf): string {
  return `${leaf.kind}:${leaf.path.join('/')}`;
}

function isRollup(leaf: AxisLeaf): boolean {
  return leaf.kind !== 'leaf';
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

export function PivotTableView({ data, rowFields, columnFields, measures, displayState, onToggleRowPath, onToggleColumnPath }: Props) {
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
      ),
    [data, rowFields, columnFields, measures, rowTotalsPosition, columnTotalsPosition, conditionalTotals, collapsedRowPaths, collapsedColumnPaths],
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
                  <th
                    className="corner-cell"
                    rowSpan={columnHeaderRows.length + (hideMeasureHeaderRow ? 0 : 1)}
                    colSpan={rowHeaderSpan}
                  />
                )}
                {headerRow.map((cell, cellIndex) => (
                  <th
                    key={`${level}-${cellIndex}`}
                    colSpan={cell.colSpan * numMeasures}
                    rowSpan={cell.rowSpan}
                    className={cell.cellKind === 'subtotal' || cell.cellKind === 'grandtotal' ? 'total-header' : undefined}
                  >
                    <CollapseToggle cell={cell} onToggle={onToggleColumnPath} />
                    {cell.label}
                  </th>
                ))}
              </tr>
            ))}
            {measures.length > 0 && !hideMeasureHeaderRow && (
              <tr>
                {pivot.columnAxis.map((_colLeaf, c) =>
                  measures.map((m, mi) => (
                    <th key={`${c}-${mi}`} className="measure-header">
                      {getMeasureFormat(displayState, m.fieldName).label || m.fieldName}
                    </th>
                  )),
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
                    >
                      <CollapseToggle cell={cell} onToggle={onToggleRowPath} />
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
