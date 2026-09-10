// Conditional formatting: period-over-period comparison coloring and
// relative heatmap/gradient coloring, driven by the toolbar's PivotDisplayState.

import type { AxisLeaf } from './pivotEngine';
import type { HeatmapConfig, PeriodComparisonConfig } from '../types';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lerpColor(fromHex: string, toHex: string, t: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const mixed: [number, number, number] = [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
  return rgbToHex(mixed);
}

export function interpolateHeatmapColor(value: number, min: number, max: number, config: HeatmapConfig): string {
  if (max === min) return config.midColor;
  const t = (value - min) / (max - min);
  return t <= 0.5 ? lerpColor(config.minColor, config.midColor, t / 0.5) : lerpColor(config.midColor, config.maxColor, (t - 0.5) / 0.5);
}

export interface HeatmapEntry {
  rowKey: string;
  columnKey: string;
  value: number | null;
}

/** Returns a map of "rowKey||columnKey" -> hex color for every cell within the configured heatmap scope. */
export function computeHeatmapColors(entries: HeatmapEntry[], config: HeatmapConfig): Map<string, string> {
  const colorByCellKey = new Map<string, string>();
  if (!config.enabled) return colorByCellKey;

  const domainKeyOf = (e: HeatmapEntry): string => {
    if (config.scope === 'rows') return e.rowKey;
    if (config.scope === 'columns') return e.columnKey;
    return '__table__';
  };

  const inScope = (e: HeatmapEntry): boolean => {
    if (config.targetKeys.length === 0) return true;
    const key = config.scope === 'columns' ? e.columnKey : e.rowKey;
    return config.targetKeys.includes(key);
  };

  const domains = new Map<string, { min: number; max: number }>();
  for (const e of entries) {
    if (e.value === null || !inScope(e)) continue;
    const domainKey = domainKeyOf(e);
    const existing = domains.get(domainKey);
    if (!existing) domains.set(domainKey, { min: e.value, max: e.value });
    else {
      existing.min = Math.min(existing.min, e.value);
      existing.max = Math.max(existing.max, e.value);
    }
  }

  for (const e of entries) {
    if (e.value === null || !inScope(e)) continue;
    const domain = domains.get(domainKeyOf(e))!;
    colorByCellKey.set(`${e.rowKey}||${e.columnKey}`, interpolateHeatmapColor(e.value, domain.min, domain.max, config));
  }

  return colorByCellKey;
}

export function getPeriodComparisonColor(
  current: number | null,
  previous: number | null,
  config: PeriodComparisonConfig,
): string | null {
  if (!config.enabled || current === null || previous === null) return null;
  if (current === previous) return config.neutralColor;
  const improved = config.direction === 'higherIsBetter' ? current > previous : current < previous;
  return improved ? config.improvedColor : config.declinedColor;
}

/**
 * Finds the nearest preceding leaf column that belongs to the same parent group
 * (i.e. shares every path segment except the period field itself), so
 * period-over-period coloring compares "this January" to "this year's December",
 * not across unrelated groups. Returns null at the start of a group or when the
 * axis isn't actually broken down by `periodField`.
 */
export function findPreviousPeriodLeaf(axis: AxisLeaf[], index: number, periodField: string): AxisLeaf | null {
  const current = axis[index];
  if (!current.fieldPath.includes(periodField) || current.kind !== 'leaf') return null;

  const periodDepth = current.fieldPath.indexOf(periodField);
  const parentPrefix = current.path.slice(0, periodDepth).join('');

  for (let i = index - 1; i >= 0; i--) {
    const candidate = axis[i];
    if (candidate.kind !== 'leaf' || candidate.fieldPath.length !== current.fieldPath.length) continue;
    const candidatePrefix = candidate.path.slice(0, periodDepth).join('');
    if (candidatePrefix !== parentPrefix) return null;
    return candidate;
  }
  return null;
}
