// Locale-independent parsing and formatting.
//
// Tableau's DataValue.value is already a raw, locale-free JS value (a number for
// int/float fields, an ISO-8601 string for date/date-time fields) — the
// locale-formatted display string lives separately in DataValue.formattedValue.
// The rule enforced throughout this extension: calculations always read `.value`,
// never `.formattedValue`, and every Intl formatter below is pinned to a fixed
// locale so rendering never drifts with the end user's browser or OS language.

const FIXED_LOCALE = 'en-US';

type RawValue = Tableau.DataValue['value'];

export function rawToNumber(raw: RawValue): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  // Defensive fallback only: string numbers should not normally reach here since
  // numeric fields already arrive as JS numbers, but guard against odd data sources.
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rawToDate(raw: RawValue): Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(FIXED_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatCurrency(value: number, currencyCode = 'USD'): string {
  return new Intl.NumberFormat(FIXED_LOCALE, {
    style: 'currency',
    currency: currencyCode,
  }).format(value);
}

export function formatDate(date: Date, style: 'short' | 'medium' = 'medium'): string {
  return new Intl.DateTimeFormat(FIXED_LOCALE, {
    dateStyle: style,
  }).format(date);
}

/** Renders any raw cell value for display, without ever depending on the browser's locale. */
export function formatRawValue(raw: RawValue, dataType: string): string {
  if (raw === null || raw === undefined) return '';
  if (dataType === 'int' || dataType === 'float') {
    const n = rawToNumber(raw);
    return n === null ? '' : formatNumber(n, dataType === 'float' ? 2 : 0);
  }
  if (dataType === 'date' || dataType === 'date-time') {
    const d = rawToDate(raw);
    return d === null ? '' : formatDate(d, dataType === 'date' ? 'short' : 'medium');
  }
  if (dataType === 'bool') {
    return raw ? 'True' : 'False';
  }
  return String(raw);
}
