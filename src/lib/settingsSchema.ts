import type { ExtensionSettings } from '../types';

export const SETTINGS_KEY = 'pivotTableSettings';

export function createDefaultSettings(): ExtensionSettings {
  return {
    settingsVersion: 1,
    worksheetName: null,
    allowedDimensions: [],
    allowedMeasures: [],
    layout: {
      axisLock: 'free',
      lockedColumns: [],
      lockedRows: [],
    },
    defaults: {
      rows: [],
      columns: [],
      measures: [],
    },
    totalsModeDefault: 'both',
    conditionalTotals: {
      hideSingleItemGroups: false,
      minValueThreshold: null,
    },
    formattingDefaults: {
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
    allowUserFormattingOverrides: true,
  };
}

/** Merge a possibly-partial/older persisted settings object onto current defaults, so new fields introduced later never crash old dashboards. */
export function parseSettings(raw: string | undefined | null): ExtensionSettings {
  const defaults = createDefaultSettings();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      layout: { ...defaults.layout, ...parsed.layout },
      defaults: { ...defaults.defaults, ...parsed.defaults },
      conditionalTotals: { ...defaults.conditionalTotals, ...parsed.conditionalTotals },
      formattingDefaults: {
        periodComparison: {
          ...defaults.formattingDefaults.periodComparison,
          ...parsed.formattingDefaults?.periodComparison,
        },
        heatmap: {
          ...defaults.formattingDefaults.heatmap,
          ...parsed.formattingDefaults?.heatmap,
        },
      },
    };
  } catch {
    return defaults;
  }
}

export function serializeSettings(settings: ExtensionSettings): string {
  return JSON.stringify(settings);
}
