import type { MeasureFormat, PivotDisplayState } from '../types';
import { defaultMeasureFormat } from '../types';

export const SETTINGS_KEY = 'pivotDisplayState';

export function createDefaultDisplayState(): PivotDisplayState {
  return {
    rowTotalsPosition: 'after',
    columnTotalsPosition: 'after',
    conditionalTotals: {
      minValueThreshold: null,
    },
    formatting: {
      colorMode: 'none',
      periodComparison: {
        periodField: null,
        direction: 'higherIsBetter',
        improvedColor: '#1a7f4b',
        declinedColor: '#c0392b',
        neutralColor: '#6b7280',
      },
      heatmap: {
        scope: 'rows',
        compareField: null,
        bucketColors: ['#fdecea', '#ffe9a8', '#a8d5a2', '#1a7f4b'],
      },
    },
    measureFormats: {},
    hideMeasureHeaderRow: false,
    collapsedRowPaths: [],
    collapsedColumnPaths: [],
  };
}

function mergeMeasureFormats(defaults: Record<string, MeasureFormat>, parsed: unknown): Record<string, MeasureFormat> {
  if (!parsed || typeof parsed !== 'object') return defaults;
  const merged: Record<string, MeasureFormat> = { ...defaults };
  for (const [fieldName, value] of Object.entries(parsed as Record<string, Partial<MeasureFormat>>)) {
    merged[fieldName] = { ...defaultMeasureFormat(), ...value };
  }
  return merged;
}

/** Merge a possibly-partial/older persisted state onto current defaults, so new fields introduced later never crash old workbooks. */
export function parseDisplayState(raw: string | undefined | null): PivotDisplayState {
  const defaults = createDefaultDisplayState();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      conditionalTotals: { ...defaults.conditionalTotals, ...parsed.conditionalTotals },
      formatting: {
        colorMode: parsed.formatting?.colorMode ?? defaults.formatting.colorMode,
        periodComparison: { ...defaults.formatting.periodComparison, ...parsed.formatting?.periodComparison },
        heatmap: {
          ...defaults.formatting.heatmap,
          ...parsed.formatting?.heatmap,
          bucketColors: Array.isArray(parsed.formatting?.heatmap?.bucketColors) && parsed.formatting.heatmap.bucketColors.length === 4
            ? parsed.formatting.heatmap.bucketColors
            : defaults.formatting.heatmap.bucketColors,
        },
      },
      measureFormats: mergeMeasureFormats(defaults.measureFormats, parsed.measureFormats),
      collapsedRowPaths: Array.isArray(parsed.collapsedRowPaths) ? parsed.collapsedRowPaths : defaults.collapsedRowPaths,
      collapsedColumnPaths: Array.isArray(parsed.collapsedColumnPaths) ? parsed.collapsedColumnPaths : defaults.collapsedColumnPaths,
    };
  } catch {
    return defaults;
  }
}

export function serializeDisplayState(state: PivotDisplayState): string {
  return JSON.stringify(state);
}

export function getMeasureFormat(state: PivotDisplayState, fieldName: string): MeasureFormat {
  return state.measureFormats[fieldName] ?? defaultMeasureFormat();
}
