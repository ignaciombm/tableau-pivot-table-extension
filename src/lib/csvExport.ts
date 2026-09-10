// Exports the currently rendered pivot table to a CSV file, triggered by a
// browser download (works the same way inside a Tableau extension iframe).
//
// Values are exported as plain, unformatted numbers (not the locale-formatted
// display strings) so the file can be safely reopened in any spreadsheet tool
// regardless of that tool's own locale settings.

import type { AxisLeaf, PivotTableResult } from './pivotEngine';
import type { MeasureConfig } from '../types';

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function axisLabelForCsv(leaf: AxisLeaf): string {
  if (leaf.kind === 'grandtotal') return 'Grand Total';
  if (leaf.kind === 'subtotal') return [...leaf.path.slice(0, -1), leaf.label].join(' > ');
  return leaf.path.join(' > ');
}

export function buildPivotCsv(pivot: PivotTableResult, measures: MeasureConfig[]): string {
  const measureLabel = (m: MeasureConfig) => `${m.fieldName}${m.aggregation === 'count' ? ' (count)' : ''}`;

  const header = [
    '',
    ...pivot.columnAxis.flatMap((colLeaf) => measures.map((m) => `${axisLabelForCsv(colLeaf)} - ${measureLabel(m)}`)),
  ];

  const lines = [header.map(csvEscape).join(',')];

  for (const rowLeaf of pivot.rowAxis) {
    const cells = pivot.columnAxis.flatMap((colLeaf) =>
      measures.map((m) => {
        const value = pivot.getCell(rowLeaf, colLeaf, m);
        return value === null ? '' : String(value);
      }),
    );
    lines.push([axisLabelForCsv(rowLeaf), ...cells].map(csvEscape).join(','));
  }

  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csvContent: string): void {
  // Leading BOM so spreadsheet apps detect UTF-8 correctly regardless of the OS locale.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
