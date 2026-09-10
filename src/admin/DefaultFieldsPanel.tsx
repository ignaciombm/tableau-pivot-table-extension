import type { AggregationType, DefaultFieldsConfig, LayoutConfig } from '../types';

interface Props {
  defaults: DefaultFieldsConfig;
  layout: LayoutConfig;
  allowedDimensions: string[];
  allowedMeasures: string[];
  onChange: (defaults: DefaultFieldsConfig) => void;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function DefaultFieldsPanel({ defaults, layout, allowedDimensions, allowedMeasures, onChange }: Props) {
  const rowsEditable = layout.axisLock !== 'lockRows';
  const columnsEditable = layout.axisLock !== 'lockColumns';

  return (
    <section className="panel-section">
      <h3>Default Fields</h3>
      <p className="hint">Fields shown when the dashboard first loads. Locked axes use the fixed fields from Layout Control.</p>
      <div className="two-column">
        <div>
          <h4>Default rows {!rowsEditable && <span className="hint">(fixed by layout)</span>}</h4>
          {rowsEditable
            ? allowedDimensions.map((f) => (
                <label key={f} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={defaults.rows.includes(f)}
                    onChange={() => onChange({ ...defaults, rows: toggle(defaults.rows, f) })}
                  />
                  {f}
                </label>
              ))
            : layout.lockedRows.map((f) => <div key={f}>{f}</div>)}
        </div>
        <div>
          <h4>Default columns {!columnsEditable && <span className="hint">(fixed by layout)</span>}</h4>
          {columnsEditable
            ? allowedDimensions.map((f) => (
                <label key={f} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={defaults.columns.includes(f)}
                    onChange={() => onChange({ ...defaults, columns: toggle(defaults.columns, f) })}
                  />
                  {f}
                </label>
              ))
            : layout.lockedColumns.map((f) => <div key={f}>{f}</div>)}
        </div>
      </div>

      <h4>Default measures</h4>
      {allowedMeasures.length === 0 && <p className="hint">No measures whitelisted yet.</p>}
      {allowedMeasures.map((f) => {
        const existing = defaults.measures.find((m) => m.fieldName === f);
        return (
          <div key={f} className="checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={!!existing}
                onChange={() =>
                  onChange({
                    ...defaults,
                    measures: existing
                      ? defaults.measures.filter((m) => m.fieldName !== f)
                      : [...defaults.measures, { fieldName: f, aggregation: 'sum' as AggregationType }],
                  })
                }
              />
              {f}
            </label>
            {existing && (
              <select
                value={existing.aggregation}
                onChange={(e) =>
                  onChange({
                    ...defaults,
                    measures: defaults.measures.map((m) =>
                      m.fieldName === f ? { ...m, aggregation: e.target.value as AggregationType } : m,
                    ),
                  })
                }
              >
                <option value="sum">Sum</option>
                <option value="count">Count</option>
              </select>
            )}
          </div>
        );
      })}
    </section>
  );
}
