// Shared domain types for both the Configure (admin) and Dashboard (end-user) apps.
// Persisted as JSON strings via tableau.extensions.settings, so every type here
// must be plain-data (serializable).

export type FieldRole = 'dimension' | 'measure';

export interface FieldInfo {
  fieldName: string;
  role: FieldRole;
  /** Tableau data type reported by the worksheet's data table, e.g. 'string' | 'int' | 'float' | 'date' | 'date-time' | 'bool'. */
  dataType: string;
}

export type TotalsMode = 'none' | 'rows' | 'columns' | 'both';

export type AggregationType = 'sum' | 'count';

export interface MeasureConfig {
  fieldName: string;
  aggregation: AggregationType;
}

/** Governs which axis, if any, the dashboard creator locks to a fixed set of fields. */
export type AxisLockMode = 'free' | 'lockColumns' | 'lockRows';

export interface LayoutConfig {
  axisLock: AxisLockMode;
  /** Fixed column fields, used when axisLock === 'lockColumns'. */
  lockedColumns: string[];
  /** Fixed row fields, used when axisLock === 'lockRows'. */
  lockedRows: string[];
}

export interface DefaultFieldsConfig {
  rows: string[];
  columns: string[];
  measures: MeasureConfig[];
}

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

/** The full creator-governed configuration, persisted via tableau.extensions.settings. */
export interface ExtensionSettings {
  settingsVersion: 1;
  worksheetName: string | null;
  allowedDimensions: string[];
  allowedMeasures: string[];
  layout: LayoutConfig;
  defaults: DefaultFieldsConfig;
  totalsModeDefault: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  formattingDefaults: FormattingConfig;
  /** If false, end users cannot override the creator's formatting defaults at all. */
  allowUserFormattingOverrides: boolean;
}

/** The end user's current, session-only pivot configuration (not persisted by default). */
export interface UserPivotState {
  rows: string[];
  columns: string[];
  measures: MeasureConfig[];
  totalsMode: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
}

export interface DataRow {
  [fieldName: string]: string | number | boolean | Date | null;
}
