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
//
// Governance split: everyone using the worksheet can pick the color mode
// (front toolbar) and, for heatmap, which axis/field to compare — but only
// the creator (via the native "Format Extension" button, wired up in
// VizApp/tableauClient) can set totals position, the conditional-totals
// threshold, the period-comparison field/direction/colors, the heatmap's
// bucket colors, and per-measure formatting.

export interface MeasureConfig {
  fieldName: string;
}

/** Where a subtotal/grand-total sits relative to its group: 'before' = top/left, 'after' = bottom/right. */
export type TotalsPosition = 'before' | 'after';

export interface ConditionalTotalRule {
  /** Hide a subtotal/grand total when the aggregated value does not exceed this threshold. Null disables the check. */
  minValueThreshold: number | null;
}

/** Period comparison and heatmap are mutually exclusive — only one coloring mode applies at a time. Chosen by whoever is using the worksheet, not just the creator. */
export type ColorMode = 'none' | 'periodComparison' | 'heatmap';

export type ComparisonDirection = 'higherIsBetter' | 'lowerIsBetter';

/** Entirely creator-configured (via Format Extension) — never exposed to the end user. */
export interface PeriodComparisonConfig {
  /** The column-axis field whose consecutive members represent periods to compare (e.g. Month, Quarter). */
  periodField: string | null;
  direction: ComparisonDirection;
  improvedColor: string;
  declinedColor: string;
  neutralColor: string;
}

/** Which axis the heatmap compares across, using `compareField` on the other axis. Chosen by the end user (front toolbar). */
export type HeatmapScope = 'rows' | 'columns';

export interface HeatmapConfig {
  scope: HeatmapScope;
  /**
   * For scope 'rows', a column field whose group "represents" each period
   * (its subtotal, or its sole child when the subtotal is hidden as a
   * single-item group) — only representative cells are colored. For scope
   * 'columns', a row field used the same way. Chosen by the end user.
   */
  compareField: string | null;
  /** Exactly 4 colors, weakest to strongest — creator-configured. Values are bucketed into quartiles of the comparison domain, not smoothly interpolated. */
  bucketColors: [string, string, string, string];
}

export interface FormattingConfig {
  colorMode: ColorMode;
  periodComparison: PeriodComparisonConfig;
  heatmap: HeatmapConfig;
}

/** Per-measure display formatting, keyed by the measure's field name. Creator-configured. */
export interface MeasureFormat {
  /** -1 means automatic: 0 decimals for whole numbers, 2 for fractional. */
  decimals: number;
  prefix: string;
  suffix: string;
  /** Empty string means use the raw field name (or labelParameterName's value, if set). */
  label: string;
  /** When set, the name of a Tableau parameter whose current value overrides `label`. */
  labelParameterName: string | null;
}

export function defaultMeasureFormat(): MeasureFormat {
  return { decimals: -1, prefix: '', suffix: '', label: '', labelParameterName: null };
}

/**
 * The toolbar + settings dialog's live state. Anyone viewing or authoring the
 * worksheet can adjust it for their current session; changes are also
 * persisted via tableau.extensions.settings so they become the default for
 * everyone else, but that only actually sticks while authoring.
 *
 * Totals are always shown for both rows and columns, with single-item
 * groups' totals always hidden (hardcoded in pivotEngine — not configurable).
 */
export interface PivotDisplayState {
  rowTotalsPosition: TotalsPosition;
  columnTotalsPosition: TotalsPosition;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
  measureFormats: Record<string, MeasureFormat>;
  /** Hides the row that shows each measure's name/label — handy with a single measure whose name is redundant. */
  hideMeasureHeaderRow: boolean;
  /** Stable path keys (see pivotEngine.pathKeyFor) of collapsed row/column groups. */
  collapsedRowPaths: string[];
  collapsedColumnPaths: string[];
}

export interface DataRow {
  [fieldName: string]: string | number | boolean | Date | null;
}
