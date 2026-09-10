import type { AggregationType, ExtensionSettings, MeasureConfig, TotalsMode, UserPivotState } from '../types';

interface Props {
  settings: ExtensionSettings;
  userState: UserPivotState;
  onChange: (next: UserPivotState) => void;
}

function FieldList({
  label,
  selected,
  options,
  editable,
  onChange,
}: {
  label: string;
  selected: string[];
  options: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
}) {
  const remaining = options.filter((f) => !selected.includes(f));
  return (
    <div className="field-list">
      <span className="field-list-label">{label}</span>
      <div className="chip-row">
        {selected.map((f) => (
          <span key={f} className="chip">
            {f}
            {editable && (
              <button className="chip-remove" onClick={() => onChange(selected.filter((s) => s !== f))} aria-label={`Remove ${f}`}>
                ×
              </button>
            )}
          </span>
        ))}
        {editable && remaining.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...selected, e.target.value]);
            }}
          >
            <option value="">+ Add field…</option>
            {remaining.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        {!editable && <span className="hint">(fixed by dashboard creator)</span>}
      </div>
    </div>
  );
}

export function FieldPicker({ settings, userState, onChange }: Props) {
  const rowsEditable = settings.layout.axisLock !== 'lockRows';
  const columnsEditable = settings.layout.axisLock !== 'lockColumns';

  function toggleMeasure(fieldName: string) {
    const existing = userState.measures.find((m) => m.fieldName === fieldName);
    const measures: MeasureConfig[] = existing
      ? userState.measures.filter((m) => m.fieldName !== fieldName)
      : [...userState.measures, { fieldName, aggregation: 'sum' as AggregationType }];
    onChange({ ...userState, measures });
  }

  function setMeasureAggregation(fieldName: string, aggregation: AggregationType) {
    onChange({
      ...userState,
      measures: userState.measures.map((m) => (m.fieldName === fieldName ? { ...m, aggregation } : m)),
    });
  }

  return (
    <div className="field-picker">
      <FieldList
        label="Rows"
        selected={userState.rows}
        options={settings.allowedDimensions}
        editable={rowsEditable}
        onChange={(rows) => onChange({ ...userState, rows })}
      />
      <FieldList
        label="Columns"
        selected={userState.columns}
        options={settings.allowedDimensions}
        editable={columnsEditable}
        onChange={(columns) => onChange({ ...userState, columns })}
      />

      <div className="field-list">
        <span className="field-list-label">Measures</span>
        <div className="chip-row">
          {settings.allowedMeasures.map((f) => {
            const existing = userState.measures.find((m) => m.fieldName === f);
            return (
              <label key={f} className="measure-toggle">
                <input type="checkbox" checked={!!existing} onChange={() => toggleMeasure(f)} />
                {f}
                {existing && (
                  <select value={existing.aggregation} onChange={(e) => setMeasureAggregation(f, e.target.value as AggregationType)}>
                    <option value="sum">Sum</option>
                    <option value="count">Count</option>
                  </select>
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div className="field-list">
        <span className="field-list-label">Totals</span>
        <select value={userState.totalsMode} onChange={(e) => onChange({ ...userState, totalsMode: e.target.value as TotalsMode })}>
          <option value="none">None</option>
          <option value="rows">Rows only</option>
          <option value="columns">Columns only</option>
          <option value="both">Both</option>
        </select>
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={userState.conditionalTotals.hideSingleItemGroups}
            onChange={(e) =>
              onChange({
                ...userState,
                conditionalTotals: { ...userState.conditionalTotals, hideSingleItemGroups: e.target.checked },
              })
            }
          />
          Hide single-item totals
        </label>
        <label className="inline-checkbox">
          Min. threshold:
          <input
            type="number"
            style={{ width: 90, marginLeft: 4 }}
            value={userState.conditionalTotals.minValueThreshold ?? ''}
            placeholder="None"
            onChange={(e) =>
              onChange({
                ...userState,
                conditionalTotals: {
                  ...userState.conditionalTotals,
                  minValueThreshold: e.target.value === '' ? null : Number(e.target.value),
                },
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
