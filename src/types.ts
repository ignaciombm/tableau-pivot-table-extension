// Shared domain types for the viz extension.
// PivotDisplayState is persisted as a JSON string via tableau.extensions.settings
// (best-effort — it only actually survives to future sessions while authoring,
// see src/lib/tableauClient.ts), so it must stay plain-data (serializable).
//
// Note on measures: unlike an admin-configured "sum vs count" choice, which
// field goes on the Measures encoding, and with what aggregation, is decided
// by the creator when they drop it onto the Marks card in Tableau — the
// summary data we read back is already aggregated accordingly. Our own
// subtotal/grand-total rollup always additively sums those already-aggregated
// values, which is exact for Sum/Count-based measures and an approximation
// for Avg/Min/Max/CountD/Median.

export interface MeasureConfig {
  fieldName: string;
}

export type TotalsMode = 'none' | 'rows' | 'columns' | 'both';

/** Where a subtotal/grand-total sits relative to its group: 'before' = top/left, 'after' = bottom/right. */
export type TotalsPosition = 'before' | 'after';

export interface ConditionalTotalRule {
  /** Hide a subtotal/grand total when its group contains only one item. */
  hideSingleItemGroups: boolean;
  /** Hide a subtotal/grand total when the aggregated value does not exceed this threshold. Null disables the check. */
  minValueThreshold: number | null;
}

export type ComparisonDirection = 'higherIsBetter' | 'lowerIsBetter';

export interface PeriodComparisonConfig {
  enabled: boolean;
  /** The column-axis field whose consecutive members represent periods to compare (e.g. Month, Quarter). */
  periodField: string | null;
  direction: ComparisonDirection;
  improvedColor: string;
  declinedColor: string;
  neutralColor: string;
}

export type HeatmapScope = 'table' | 'rows' | 'columns';

export interface HeatmapConfig {
  enabled: boolean;
  scope: HeatmapScope;
  minColor: string;
  midColor: string;
  maxColor: string;
  /** When scope is 'rows' or 'columns', restrict the heatmap to these row/column field keys. Empty = all. */
  targetKeys: string[];
}

export interface FormattingConfig {
  periodComparison: PeriodComparisonConfig;
  heatmap: HeatmapConfig;
}

/** Per-measure display formatting, keyed by the measure's field name. */
export interface MeasureFormat {
  /** -1 means automatic: 0 decimals for whole numbers, 2 for fractional. */
  decimals: number;
  prefix: string;
  suffix: string;
  /** Empty string means use the raw field name. */
  label: string;
}

export function defaultMeasureFormat(): MeasureFormat {
  return { decimals: -1, prefix: '', suffix: '', label: '' };
}

/**
 * The toolbar + settings dialog's live state. Anyone viewing or authoring the
 * worksheet can adjust it for their current session; changes are also
 * persisted via tableau.extensions.settings so they become the default for
 * everyone else, but that only actually sticks while authoring.
 */
export interface PivotDisplayState {
  totalsMode: TotalsMode;
  rowTotalsPosition: TotalsPosition;
  columnTotalsPosition: TotalsPosition;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
  measureFormats: Record<string, MeasureFormat>;
  /** Stable path keys (see pivotEngine.pathKeyFor) of collapsed row/column groups. */
  collapsedRowPaths: string[];
  collapsedColumnPaths: string[];
}

export interface DataRow {
  [fieldName: string]: string | number | boolean | Date | null;
}
