// Shared domain types for the viz extension.
// PivotDisplayState is persisted as a JSON string via tableau.extensions.settings
// when running in authoring mode, so it must stay plain-data (serializable).
//
// Note on measures: unlike the old dashboard-extension version, there is no
// per-measure "sum vs count" choice here. Which field goes on the Measures
// encoding, and with what aggregation, is decided by the creator when they
// drop it onto the Marks card in Tableau — the summary data we read back is
// already aggregated accordingly. Our own subtotal/grand-total rollup always
// additively sums those already-aggregated values, which is exact for
// Sum/Count-based measures and an approximation for Avg/Min/Max/CountD/Median.

export interface MeasureConfig {
  fieldName: string;
}

export type TotalsMode = 'none' | 'rows' | 'columns' | 'both';

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

/**
 * The toolbar's live state: totals behavior and conditional formatting.
 * Anyone viewing or authoring the worksheet can adjust it for their current
 * session; when running in authoring mode, changes are also persisted via
 * tableau.extensions.settings so they become the default for everyone else.
 */
export interface PivotDisplayState {
  totalsMode: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
}

export interface DataRow {
  [fieldName: string]: string | number | boolean | Date | null;
}
