import type { ConditionalTotalRule, TotalsMode } from '../types';

interface Props {
  totalsMode: TotalsMode;
  conditionalTotals: ConditionalTotalRule;
  onTotalsModeChange: (mode: TotalsMode) => void;
  onConditionalTotalsChange: (rule: ConditionalTotalRule) => void;
}

export function TotalsControls({ totalsMode, conditionalTotals, onTotalsModeChange, onConditionalTotalsChange }: Props) {
  return (
    <div className="totals-controls">
      <label className="inline-select">
        Totals:
        <select value={totalsMode} onChange={(e) => onTotalsModeChange(e.target.value as TotalsMode)}>
          <option value="none">None</option>
          <option value="rows">Rows only</option>
          <option value="columns">Columns only</option>
          <option value="both">Both</option>
        </select>
      </label>
      <label className="inline-checkbox">
        <input
          type="checkbox"
          checked={conditionalTotals.hideSingleItemGroups}
          onChange={(e) => onConditionalTotalsChange({ ...conditionalTotals, hideSingleItemGroups: e.target.checked })}
        />
        Hide single-item totals
      </label>
      <label className="inline-checkbox">
        Min. threshold:
        <input
          type="number"
          style={{ width: 90, marginLeft: 4 }}
          value={conditionalTotals.minValueThreshold ?? ''}
          placeholder="None"
          onChange={(e) =>
            onConditionalTotalsChange({
              ...conditionalTotals,
              minValueThreshold: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        />
      </label>
    </div>
  );
}
