import type { ComparisonDirection, FormattingConfig, HeatmapScope } from '../types';

interface Props {
  formatting: FormattingConfig;
  periodFieldOptions: string[];
  onChange: (formatting: FormattingConfig) => void;
}

export function FormattingControls({ formatting, periodFieldOptions, onChange }: Props) {
  return (
    <div className="formatting-controls">
      <div className="formatting-block">
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={formatting.periodComparison.enabled}
            onChange={(e) => onChange({ ...formatting, periodComparison: { ...formatting.periodComparison, enabled: e.target.checked } })}
          />
          Period comparison
        </label>
        {formatting.periodComparison.enabled && (
          <>
            <select
              value={formatting.periodComparison.periodField ?? ''}
              onChange={(e) =>
                onChange({ ...formatting, periodComparison: { ...formatting.periodComparison, periodField: e.target.value || null } })
              }
            >
              <option value="">Select period field…</option>
              {periodFieldOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              value={formatting.periodComparison.direction}
              onChange={(e) =>
                onChange({
                  ...formatting,
                  periodComparison: { ...formatting.periodComparison, direction: e.target.value as ComparisonDirection },
                })
              }
            >
              <option value="higherIsBetter">Higher is better</option>
              <option value="lowerIsBetter">Lower is better</option>
            </select>
          </>
        )}
      </div>

      <div className="formatting-block">
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={formatting.heatmap.enabled}
            onChange={(e) => onChange({ ...formatting, heatmap: { ...formatting.heatmap, enabled: e.target.checked } })}
          />
          Heatmap
        </label>
        {formatting.heatmap.enabled && (
          <select
            value={formatting.heatmap.scope}
            onChange={(e) => onChange({ ...formatting, heatmap: { ...formatting.heatmap, scope: e.target.value as HeatmapScope } })}
          >
            <option value="table">Entire table</option>
            <option value="rows">Per row</option>
            <option value="columns">Per column</option>
          </select>
        )}
      </div>
    </div>
  );
}
