import type { AxisLockMode, LayoutConfig } from '../types';

interface Props {
  layout: LayoutConfig;
  allowedDimensions: string[];
  onChange: (layout: LayoutConfig) => void;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const MODES: { value: AxisLockMode; label: string; description: string }[] = [
  { value: 'free', label: 'Full freedom', description: 'End users can choose fields for both rows and columns.' },
  { value: 'lockColumns', label: 'Lock columns', description: 'Columns are fixed by the creator; end users choose rows only.' },
  { value: 'lockRows', label: 'Lock rows', description: 'Rows are fixed by the creator; end users choose columns only.' },
];

export function LayoutControl({ layout, allowedDimensions, onChange }: Props) {
  return (
    <section className="panel-section">
      <h3>Layout Control</h3>
      <p className="hint">Decide which axes end users are allowed to rearrange.</p>
      <div className="radio-group">
        {MODES.map((mode) => (
          <label key={mode.value} className="radio-row">
            <input
              type="radio"
              name="axisLock"
              checked={layout.axisLock === mode.value}
              onChange={() => onChange({ ...layout, axisLock: mode.value })}
            />
            <span>
              <strong>{mode.label}</strong>
              <br />
              <span className="hint">{mode.description}</span>
            </span>
          </label>
        ))}
      </div>

      {layout.axisLock === 'lockColumns' && (
        <div>
          <h4>Fixed column fields (in order)</h4>
          {allowedDimensions.map((f) => (
            <label key={f} className="checkbox-row">
              <input
                type="checkbox"
                checked={layout.lockedColumns.includes(f)}
                onChange={() => onChange({ ...layout, lockedColumns: toggle(layout.lockedColumns, f) })}
              />
              {f}
            </label>
          ))}
        </div>
      )}

      {layout.axisLock === 'lockRows' && (
        <div>
          <h4>Fixed row fields (in order)</h4>
          {allowedDimensions.map((f) => (
            <label key={f} className="checkbox-row">
              <input
                type="checkbox"
                checked={layout.lockedRows.includes(f)}
                onChange={() => onChange({ ...layout, lockedRows: toggle(layout.lockedRows, f) })}
              />
              {f}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
