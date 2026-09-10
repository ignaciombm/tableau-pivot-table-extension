import type { TotalsMode } from '../types';

interface Props {
  totalsMode: TotalsMode;
  onTotalsModeChange: (mode: TotalsMode) => void;
}

export function TotalsControls({ totalsMode, onTotalsModeChange }: Props) {
  return (
    <label className="inline-select">
      Totals:
      <select value={totalsMode} onChange={(e) => onTotalsModeChange(e.target.value as TotalsMode)}>
        <option value="none">None</option>
        <option value="rows">Rows only</option>
        <option value="columns">Columns only</option>
        <option value="both">Both</option>
      </select>
    </label>
  );
}
