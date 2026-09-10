import type { PivotDisplayState } from '../types';

export const SETTINGS_KEY = 'pivotDisplayState';

export function createDefaultDisplayState(): PivotDisplayState {
  return {
    totalsMode: 'both',
    conditionalTotals: {
      hideSingleItemGroups: false,
      minValueThreshold: null,
    },
    formatting: {
      periodComparison: {
        enabled: false,
        periodField: null,
        direction: 'higherIsBetter',
        improvedColor: '#1a7f4b',
        declinedColor: '#c0392b',
        neutralColor: '#6b7280',
      },
      heatmap: {
        enabled: false,
        scope: 'table',
        minColor: '#fdecea',
        midColor: '#ffe9a8',
        maxColor: '#1a7f4b',
        targetKeys: [],
      },
    },
  };
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
        periodComparison: { ...defaults.formatting.periodComparison, ...parsed.formatting?.periodComparison },
        heatmap: { ...defaults.formatting.heatmap, ...parsed.formatting?.heatmap },
      },
    };
  } catch {
    return defaults;
  }
}

export function serializeDisplayState(state: PivotDisplayState): string {
  return JSON.stringify(state);
}
