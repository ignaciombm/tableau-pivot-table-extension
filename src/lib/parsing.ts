// Locale-independent parsing and formatting.
//
// Tableau's DataValue.nativeValue is already the proper native JS type (number,
// boolean, Date, string, or null for special values like %null%/%no-access%) —
// the locale-formatted display string lives separately in DataValue.formattedValue.
// The rule enforced throughout this extension: calculations always read
// `.nativeValue`, never `.formattedValue`, and every Intl formatter below is
// pinned to a fixed locale so rendering never drifts with the end user's
// browser, OS, or Tableau Server language.

import type { MeasureFormat } from '../types';

const FIXED_LOCALE = 'en-US';

type NativeValue = string | number | boolean | Date | null;

export function rawToNumber(native: NativeValue): number | null {
  if (native === null || native === undefined) return null;
  if (typeof native === 'number') return Number.isFinite(native) ? native : null;
  if (typeof native === 'boolean') return native ? 1 : 0;
  // Defensive fallback only: string numbers should not normally reach here since
  // numeric fields already arrive as JS numbers via DataValue.nativeValue.
  const parsed = Number(native);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rawToDate(native: NativeValue): Date | null {
  if (native === null || native === undefined) return null;
  if (native instanceof Date) return Number.isNaN(native.getTime()) ? null : native;
  if (typeof native === 'string') {
    const date = new Date(native);
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

export function formatDate(date: Date, style: 'short' | 'medium' = 'medium'): string {
  return new Intl.DateTimeFormat(FIXED_LOCALE, {
    dateStyle: style,
  }).format(date);
}

/** Applies a measure's configured decimals/prefix/suffix. decimals === -1 means automatic (0 for whole numbers, 2 otherwise). */
export function formatMeasureValue(value: number, format: MeasureFormat): string {
  const decimals = format.decimals === -1 ? (Number.isInteger(value) ? 0 : 2) : format.decimals;
  return `${format.prefix}${formatNumber(value, decimals)}${format.suffix}`;
}
