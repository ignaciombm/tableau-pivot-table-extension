import { useMemo } from 'react';
import type { DataRow, FormattingConfig, MeasureConfig, ConditionalTotalRule, TotalsMode } from '../types';
import { buildHeaderRows, buildPivotTable, type AxisLeaf } from '../lib/pivotEngine';
import { computeHeatmapColors, findPreviousPeriodLeaf, getPeriodComparisonColor, type HeatmapEntry } from '../lib/colorEngine';
import { formatNumber } from '../lib/parsing';
import { buildPivotCsv, downloadCsv } from '../lib/csvExport';

interface Props {
  data: DataRow[];
  rowFields: string[];
  columnFields: string[];
  measures: MeasureConfig[];
  totalsMode: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
}

function rowKeyOf(leaf: AxisLeaf): string {
  return `${leaf.kind}:${leaf.path.join('/')}`;
}

function formatCellValue(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

export function PivotTableView({ data, rowFields, columnFields, measures, totalsMode, conditionalTotals, formatting }: Props) {
  const pivot = useMemo(
    () => buildPivotTable(data, rowFields, columnFields, measures, totalsMode, conditionalTotals),
    [data, rowFields, columnFields, measures, totalsMode, conditionalTotals],
  );

  const columnHeaderRows = useMemo(
    () => buildHeaderRows(pivot.columnAxis, columnFields.length),
    [pivot.columnAxis, columnFields.length],
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
          entries.push({ rowKey: rowKeyOf(rowLeaf), columnKey: rowKeyOf(colLeaf), value: cellMatrix[r][c][measureIndex] });
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
    downloadCsv('pivot-table.csv', buildPivotCsv(pivot, measures.length > 0 ? measures : [{ fieldName: 'Count' }]));
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
                  <th key={`${level}-${cellIndex}`} colSpan={cell.colSpan * numMeasures} rowSpan={cell.rowSpan}>
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
                      {m.fieldName}
                    </th>
                  )),
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {pivot.rowAxis.map((rowLeaf, r) => (
              <tr key={rowKeyOf(rowLeaf)} className={rowLeaf.kind !== 'leaf' ? 'total-row' : undefined}>
                <td className="row-header" colSpan={rowHeaderSpan} style={{ paddingLeft: 8 + rowLeaf.depth * 16 }}>
                  {rowLeaf.label}
                </td>
                {pivot.columnAxis.map((colLeaf, c) =>
                  measures.map((_m, mi) => {
                    const value = cellMatrix[r][c][mi];
                    const background = colorForCell(r, c, mi);
                    return (
                      <td
                        key={`${r}-${c}-${mi}`}
                        className={`cell${colLeaf.kind !== 'leaf' ? ' total-column' : ''}`}
                        style={background ? { backgroundColor: background } : undefined}
                      >
                        {value === null ? '' : formatCellValue(value)}
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
