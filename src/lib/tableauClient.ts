// Thin wrapper around the global `tableau.extensions` object for a Viz Extension
// (tableau.extensions.worksheetContent), so the rest of the app never touches
// the raw API directly. See src/lib/tableau-globals.d.ts for the type source.

import type { DataTable, DataValue, Encoding, Worksheet } from '@tableau/extensions-api-types';
import type { DataRow } from '../types';
import { rawToDate, rawToNumber } from './parsing';

export async function initializeVizExtension(): Promise<void> {
  await tableau.extensions.initializeAsync();
}

/** Must be called instead of initializeVizExtension by the code running inside the settings dialog. Returns the payload the parent passed to displayDialogAsync. */
export async function initializeSettingsDialog(): Promise<string> {
  return tableau.extensions.initializeDialogAsync();
}

/** Opens the settings dialog and resolves once it's closed. */
export async function openSettingsDialog(url: string): Promise<string> {
  return tableau.extensions.ui.displayDialogAsync(url, '', { width: 480, height: 640 });
}

export function closeSettingsDialog(payload = ''): void {
  tableau.extensions.ui.closeDialog(payload);
}

export function getWorksheet(): Worksheet {
  const worksheet = tableau.extensions.worksheetContent?.worksheet;
  if (!worksheet) {
    throw new Error('This extension must be run as a Viz Extension on a worksheet (worksheetContent is unavailable).');
  }
  return worksheet;
}

export function getSettingsString(key: string): string | undefined {
  return tableau.extensions.settings.get(key);
}

export function setSettingsString(key: string, value: string): void {
  tableau.extensions.settings.set(key, value);
}

export async function saveSettings(): Promise<void> {
  await tableau.extensions.settings.saveAsync();
}

export function onSettingsChanged(handler: () => void): () => boolean {
  return tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, handler);
}

export function onSummaryDataChanged(worksheet: Worksheet, handler: () => void): () => boolean {
  return worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, handler);
}

export interface EncodingMap {
  rows: string[];
  columns: string[];
  measures: string[];
}

/**
 * Reads which fields the creator has dropped onto our Rows/Columns/Measures
 * encoding tiles on the Marks card. Multiple fields on the same tile show up
 * as multiple entries sharing that encoding's id (per the official
 * getEncodingMap pattern in Tableau's own Viz Extension samples).
 */
export async function getEncodingMap(worksheet: Worksheet): Promise<EncodingMap> {
  const visualSpec = await worksheet.getVisualSpecificationAsync();
  const map: EncodingMap = { rows: [], columns: [], measures: [] };

  if (visualSpec.activeMarksSpecificationIndex < 0) return map;

  const marksCard = visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];
  for (const encoding of marksCard.encodings as Encoding[]) {
    if (encoding.id === 'rows') map.rows.push(encoding.field.name);
    else if (encoding.id === 'columns') map.columns.push(encoding.field.name);
    else if (encoding.id === 'measures') map.measures.push(encoding.field.name);
  }
  return map;
}

function convertPageToNamedRows(page: DataTable): DataRow[] {
  const rows: DataRow[] = [];
  for (const dataRow of page.data) {
    const row: DataRow = {};
    for (const column of page.columns) {
      row[column.fieldName] = coerceCell(dataRow[column.index], column.dataType);
    }
    rows.push(row);
  }
  return rows;
}

/** Reads the worksheet's full summary data, page by page, coercing every value through the locale-independent parsers in ./parsing. */
export async function readWorksheetData(worksheet: Worksheet): Promise<DataRow[]> {
  const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
  try {
    let rows: DataRow[] = [];
    for (let page = 0; page < reader.pageCount; page++) {
      rows = rows.concat(convertPageToNamedRows(await reader.getPageAsync(page)));
    }
    return rows;
  } finally {
    await reader.releaseAsync();
  }
}

function coerceCell(cell: DataValue, dataType: string): DataRow[string] {
  // nativeValue is already the proper native JS type (number/boolean/Date/string, or null
  // for special values like %null%/%no-access%) — no locale-sensitive string parsing needed.
  const native = cell.nativeValue;
  if (native === null || native === undefined) return null;
  if (dataType === 'int' || dataType === 'float') return rawToNumber(native);
  if (dataType === 'date' || dataType === 'date-time') return rawToDate(native);
  if (dataType === 'bool') return Boolean(native);
  return String(native);
}
