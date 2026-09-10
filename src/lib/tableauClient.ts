// Thin wrapper around the global `tableau.extensions` object so the rest of the
// app never touches the raw API directly.

import type { DataRow, FieldInfo } from '../types';
import { rawToDate, rawToNumber } from './parsing';

export async function initializeDashboardExtension(onConfigure?: () => void): Promise<void> {
  await tableau.extensions.initializeAsync(onConfigure ? { configure: onConfigure } : undefined);
}

export async function initializeConfigureDialog(): Promise<string> {
  return tableau.extensions.initializeDialogAsync();
}

export function getWorksheets(): Tableau.Worksheet[] {
  return tableau.extensions.dashboardContent?.dashboard.worksheets ?? [];
}

export function getWorksheetByName(name: string): Tableau.Worksheet | undefined {
  return getWorksheets().find((w) => w.name === name);
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

export function onSettingsChanged(handler: () => void): () => void {
  const eventType = tableau.TableauEventType?.SettingsChanged ?? 'settingschanged';
  tableau.extensions.settings.addEventListener(eventType, handler);
  return () => tableau.extensions.settings.removeEventListener(eventType, handler);
}

export function onSummaryDataChanged(worksheet: Tableau.Worksheet, handler: () => void): () => void {
  const eventType = tableau.TableauEventType?.SummaryDataChanged ?? 'summarydatachanged';
  worksheet.addEventListener(eventType, handler);
  return () => worksheet.removeEventListener(eventType, handler);
}

export interface WorksheetData {
  fields: FieldInfo[];
  rows: DataRow[];
}

/**
 * Reads the worksheet's full summary data table and converts it into plain rows
 * keyed by field name, coercing every value through the locale-independent
 * parsers in ./parsing. Measures are inferred as numeric (int/float) columns,
 * everything else is treated as a dimension.
 */
export async function readWorksheetData(worksheet: Tableau.Worksheet): Promise<WorksheetData> {
  const table = await worksheet.getSummaryDataAsync({ ignoreSelection: true, maxRows: 0 });

  const fields: FieldInfo[] = table.columns.map((col) => ({
    fieldName: col.fieldName,
    role: col.dataType === 'int' || col.dataType === 'float' ? 'measure' : 'dimension',
    dataType: col.dataType,
  }));

  const rows: DataRow[] = table.data.map((dataRow) => {
    const row: DataRow = {};
    table.columns.forEach((col, colIndex) => {
      const cell = dataRow[colIndex];
      row[col.fieldName] = coerceCell(cell.value, col.dataType);
    });
    return row;
  });

  return { fields, rows };
}

/** Lightweight fields-only read, used by the Configure dialog to populate the whitelist pickers without pulling every row. */
export async function getWorksheetFields(worksheet: Tableau.Worksheet): Promise<FieldInfo[]> {
  const table = await worksheet.getSummaryDataAsync({ ignoreSelection: true, maxRows: 1 });
  return table.columns.map((col) => ({
    fieldName: col.fieldName,
    role: col.dataType === 'int' || col.dataType === 'float' ? 'measure' : 'dimension',
    dataType: col.dataType,
  }));
}

function coerceCell(raw: Tableau.DataValue['value'], dataType: string): DataRow[string] {
  if (dataType === 'int' || dataType === 'float') return rawToNumber(raw);
  if (dataType === 'date' || dataType === 'date-time') return rawToDate(raw);
  if (dataType === 'bool') return Boolean(raw);
  return raw === null || raw === undefined ? null : String(raw);
}
