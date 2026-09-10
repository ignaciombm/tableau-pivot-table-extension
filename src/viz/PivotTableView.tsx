import { useMemo } from 'react';
import type { DataRow, MeasureConfig, PivotDisplayState } from '../types';
import { buildHeaderRows, buildPivotTable, buildRowHeaderGrid, type AxisLeaf, type HeaderCell } from '../lib/pivotEngine';
import { computeHeatmapColors, findPreviousPeriodLeaf, getPeriodComparisonColor, type HeatmapEntry } from '../lib/colorEngine';
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
  const { totalsMode, rowTotalsPosition, columnTotalsPosition, conditionalTotals, formatting } = displayState;
  const collapsedRowPaths = useMemo(() => new Set(displayState.collapsedRowPaths), [displayState.collapsedRowPaths]);
  const collapsedColumnPaths = useMemo(() => new Set(displayState.collapsedColumnPaths), [displayState.collapsedColumnPaths]);

  const pivot = useMemo(
    () =>
      buildPivotTable(
        data,
        rowFields,
        columnFields,
        measures,
        totalsMode,
        rowTotalsPosition,
        columnTotalsPosition,
        conditionalTotals,
        collapsedRowPaths,
        collapsedColumnPaths,
      ),
    [data, rowFields, columnFields, measures, totalsMode, rowTotalsPosition, columnTotalsPosition, conditionalTotals, collapsedRowPaths, collapsedColumnPaths],
  );

  const columnHeaderRows = useMemo(
    () => buildHeaderRows(pivot.columnAxis, columnFields.length),
    [pivot.columnAxis, columnFields.length],
  );
  const rowHeaderGrid = useMemo(
    () => buildRowHeaderGrid(pivot.rowAxis, rowFields.length),
    [pivot.rowAxis, rowFields.length],
  );

  const cellMatrix = useMemo(
    () => pivot.rowAxis.map((rowLeaf) => pivot.columnAxis.map((colLeaf) => measures.map((m) => pivot.getCell(rowLeaf, colLeaf, m)))),
    [pivot, measures],
  );

  const heatmapColorsByMeasure = useMemo(() => {
    if (!formatting.heatmap.enabled) return [];
    return measures.map((_, measureIndex) => {
      const entries: HeatmapEntry[] = [];
      pivot.rowAxis.forEach((rowLeaf, r) => {
        pivot.columnAxis.forEach((colLeaf, c) => {
          entries.push({
            rowKey: rowKeyOf(rowLeaf),
            columnKey: rowKeyOf(colLeaf),
            value: cellMatrix[r][c][measureIndex],
            isTotal: isRollup(rowLeaf) || isRollup(colLeaf),
          });
        });
      });
      return computeHeatmapColors(entries, formatting.heatmap);
    });
  }, [formatting.heatmap, pivot, cellMatrix, measures]);

  function colorForCell(rowIndex: number, colIndex: number, measureIndex: number): string | undefined {
    const periodField = formatting.periodComparison.periodField;
    if (formatting.periodComparison.enabled && periodField) {
      const previousLeaf = findPreviousPeriodLeaf(pivot.columnAxis, colIndex, periodField);
      if (previousLeaf) {
        const previousColIndex = pivot.columnAxis.indexOf(previousLeaf);
        const previousValue = cellMatrix[rowIndex][previousColIndex][measureIndex];
        const currentValue = cellMatrix[rowIndex][colIndex][measureIndex];
        const color = getPeriodComparisonColor(currentValue, previousValue, formatting.periodComparison);
        if (color) return color;
      }
    }
    if (formatting.heatmap.enabled) {
      const key = `${rowKeyOf(pivot.rowAxis[rowIndex])}||${rowKeyOf(pivot.columnAxis[colIndex])}`;
      return heatmapColorsByMeasure[measureIndex]?.get(key);
    }
    return undefined;
  }

  const rowHeaderSpan = Math.max(1, rowFields.length);
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
                {level === 0 && <th className="corner-cell" rowSpan={columnHeaderRows.length + 1} colSpan={rowHeaderSpan} />}
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
            {measures.length > 0 && (
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
