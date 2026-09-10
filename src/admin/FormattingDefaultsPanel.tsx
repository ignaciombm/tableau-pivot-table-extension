import type { ComparisonDirection, ConditionalTotalRule, FormattingConfig, HeatmapScope, TotalsMode } from '../types';

interface Props {
  totalsMode: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  formatting: FormattingConfig;
  allowUserFormattingOverrides: boolean;
  periodFieldOptions: string[];
  onTotalsModeChange: (mode: TotalsMode) => void;
  onConditionalTotalsChange: (rule: ConditionalTotalRule) => void;
  onFormattingChange: (formatting: FormattingConfig) => void;
  onAllowOverridesChange: (allow: boolean) => void;
}

export function FormattingDefaultsPanel({
  totalsMode,
  conditionalTotals,
  formatting,
  allowUserFormattingOverrides,
  periodFieldOptions,
  onTotalsModeChange,
  onConditionalTotalsChange,
  onFormattingChange,
  onAllowOverridesChange,
}: Props) {
  return (
    <section className="panel-section">
      <h3>Totals &amp; Conditional Formatting Defaults</h3>

      <h4>Grand totals / subtotals</h4>
      <select value={totalsMode} onChange={(e) => onTotalsModeChange(e.target.value as TotalsMode)}>
        <option value="none">None</option>
        <option value="rows">Rows only</option>
        <option value="columns">Columns only</option>
        <option value="both">Both</option>
      </select>

      <div className="checkbox-row">
        <label>
          <input
            type="checkbox"
            checked={conditionalTotals.hideSingleItemGroups}
            onChange={(e) => onConditionalTotalsChange({ ...conditionalTotals, hideSingleItemGroups: e.target.checked })}
          />
          Hide totals for single-item groups
        </label>
      </div>
      <div className="checkbox-row">
        <label>
          Hide totals below threshold (primary measure):
          <input
            type="number"
            style={{ marginLeft: 8, width: 120 }}
            value={conditionalTotals.minValueThreshold ?? ''}
            placeholder="No threshold"
            onChange={(e) =>
              onConditionalTotalsChange({
                ...conditionalTotals,
                minValueThreshold: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>

      <h4>Period-over-period comparison</h4>
      <div className="checkbox-row">
        <label>
          <input
            type="checkbox"
            checked={formatting.periodComparison.enabled}
            onChange={(e) =>
              onFormattingChange({
                ...formatting,
                periodComparison: { ...formatting.periodComparison, enabled: e.target.checked },
              })
            }
          />
          Enable by default
        </label>
      </div>
      {formatting.periodComparison.enabled && (
        <>
          <label>
            Period field:
            <select
              style={{ marginLeft: 8 }}
              value={formatting.periodComparison.periodField ?? ''}
              onChange={(e) =>
                onFormattingChange({
                  ...formatting,
                  periodComparison: { ...formatting.periodComparison, periodField: e.target.value || null },
                })
              }
            >
              <option value="">Select a field…</option>
              {periodFieldOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="checkbox-row">
            <label>
              Direction:
              <select
                style={{ marginLeft: 8 }}
                value={formatting.periodComparison.direction}
                onChange={(e) =>
                  onFormattingChange({
                    ...formatting,
                    periodComparison: { ...formatting.periodComparison, direction: e.target.value as ComparisonDirection },
                  })
                }
              >
                <option value="higherIsBetter">Higher is better</option>
                <option value="lowerIsBetter">Lower is better</option>
              </select>
            </label>
          </div>
          <div className="color-row">
            <label>
              Improved
              <input
                type="color"
                value={formatting.periodComparison.improvedColor}
                onChange={(e) =>
                  onFormattingChange({
                    ...formatting,
                    periodComparison: { ...formatting.periodComparison, improvedColor: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Declined
              <input
                type="color"
                value={formatting.periodComparison.declinedColor}
                onChange={(e) =>
                  onFormattingChange({
                    ...formatting,
                    periodComparison: { ...formatting.periodComparison, declinedColor: e.target.value },
                  })
                }
              />
            </label>
          </div>
        </>
      )}

      <h4>Heatmap / gradient</h4>
      <div className="checkbox-row">
        <label>
          <input
            type="checkbox"
            checked={formatting.heatmap.enabled}
            onChange={(e) =>
              onFormattingChange({ ...formatting, heatmap: { ...formatting.heatmap, enabled: e.target.checked } })
            }
          />
          Enable by default
        </label>
      </div>
      {formatting.heatmap.enabled && (
        <>
          <label>
            Scope:
            <select
              style={{ marginLeft: 8 }}
              value={formatting.heatmap.scope}
              onChange={(e) =>
                onFormattingChange({ ...formatting, heatmap: { ...formatting.heatmap, scope: e.target.value as HeatmapScope } })
              }
            >
              <option value="table">Entire table</option>
              <option value="rows">Per row</option>
              <option value="columns">Per column</option>
            </select>
          </label>
          <div className="color-row">
            <label>
              Low
              <input
                type="color"
                value={formatting.heatmap.minColor}
                onChange={(e) => onFormattingChange({ ...formatting, heatmap: { ...formatting.heatmap, minColor: e.target.value } })}
              />
            </label>
            <label>
              Mid
              <input
                type="color"
                value={formatting.heatmap.midColor}
                onChange={(e) => onFormattingChange({ ...formatting, heatmap: { ...formatting.heatmap, midColor: e.target.value } })}
              />
            </label>
            <label>
              High
              <input
                type="color"
                value={formatting.heatmap.maxColor}
                onChange={(e) => onFormattingChange({ ...formatting, heatmap: { ...formatting.heatmap, maxColor: e.target.value } })}
              />
            </label>
          </div>
        </>
      )}

      <div className="checkbox-row">
        <label>
          <input
            type="checkbox"
            checked={allowUserFormattingOverrides}
            onChange={(e) => onAllowOverridesChange(e.target.checked)}
          />
          Allow end users to override these formatting defaults
        </label>
      </div>
    </section>
  );
}
