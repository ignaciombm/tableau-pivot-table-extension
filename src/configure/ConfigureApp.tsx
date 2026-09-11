import { useEffect, useState } from 'react';
import type { Parameter } from '@tableau/extensions-api-types';
import type { ComparisonDirection, MeasureFormat, PivotDisplayState, TotalsPosition } from '../types';
import { defaultMeasureFormat } from '../types';
import { createDefaultDisplayState, parseDisplayState, serializeDisplayState, SETTINGS_KEY } from '../lib/settingsSchema';
import {
  closeSettingsDialog,
  getEncodingMap,
  getParameters,
  getSettingsString,
  getWorksheet,
  initializeSettingsDialog,
  saveSettings,
  setSettingsString,
} from '../lib/tableauClient';
import { EXTENSION_VERSION } from '../lib/version';

type Status = 'loading' | 'ready' | 'error';

export function ConfigureApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<PivotDisplayState>(createDefaultDisplayState());
  const [measureFieldNames, setMeasureFieldNames] = useState<string[]>([]);
  const [columnFieldNames, setColumnFieldNames] = useState<string[]>([]);
  const [parameters, setParameters] = useState<Parameter[]>([]);

  useEffect(() => {
    (async () => {
      try {
        await initializeSettingsDialog();
        const worksheet = getWorksheet();
        const [encodings, params] = await Promise.all([getEncodingMap(worksheet), getParameters(worksheet)]);
        setMeasureFieldNames(encodings.measures);
        setColumnFieldNames(encodings.columns);
        setParameters(params);
        setState(parseDisplayState(getSettingsString(SETTINGS_KEY)));
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, []);

  function measureFormat(fieldName: string): MeasureFormat {
    return state.measureFormats[fieldName] ?? defaultMeasureFormat();
  }

  function updateMeasureFormat(fieldName: string, format: MeasureFormat) {
    setState((s) => ({ ...s, measureFormats: { ...s.measureFormats, [fieldName]: format } }));
  }

  function updateBucketColor(index: 0 | 1 | 2 | 3, color: string) {
    setState((s) => {
      const bucketColors = [...s.formatting.heatmap.bucketColors] as [string, string, string, string];
      bucketColors[index] = color;
      return { ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, bucketColors } } };
    });
  }

  async function handleSave() {
    setSettingsString(SETTINGS_KEY, serializeDisplayState(state));
    // Persisting only actually sticks while authoring; attempt it regardless and
    // don't block closing the dialog if it's rejected while just viewing.
    await saveSettings().catch(() => {});
    closeSettingsDialog('saved');
  }

  function handleCancel() {
    closeSettingsDialog('cancelled');
  }

  if (status === 'loading') return <div className="configure-app">Loading…</div>;
  if (status === 'error') return <div className="configure-app error">Error: {error}</div>;

  return (
    <div className="configure-app">
      <h2>Pivot Table — Settings</h2>
      <p className="hint">
        These settings are creator-only. Whoever uses the worksheet can still pick the color mode itself (none/period
        comparison/heatmap) and, for heatmap, which rows or columns to compare — everything below just governs how those
        look and behave.
      </p>

      <section className="panel-section">
        <h3>Totals</h3>
        <p className="hint">Totals are always shown for both rows and columns; a single-item group's total is always hidden.</p>
        <label className="row">
          Row totals position:
          <select
            value={state.rowTotalsPosition}
            onChange={(e) => setState((s) => ({ ...s, rowTotalsPosition: e.target.value as TotalsPosition }))}
          >
            <option value="after">Bottom</option>
            <option value="before">Top</option>
          </select>
        </label>
        <label className="row">
          Column totals position:
          <select
            value={state.columnTotalsPosition}
            onChange={(e) => setState((s) => ({ ...s, columnTotalsPosition: e.target.value as TotalsPosition }))}
          >
            <option value="after">Right</option>
            <option value="before">Left</option>
          </select>
        </label>
        <label className="row">
          Hide totals below threshold:
          <input
            type="number"
            style={{ width: 100, marginLeft: 8 }}
            value={state.conditionalTotals.minValueThreshold ?? ''}
            placeholder="None"
            onChange={(e) =>
              setState((s) => ({
                ...s,
                conditionalTotals: { minValueThreshold: e.target.value === '' ? null : Number(e.target.value) },
              }))
            }
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Period-over-period Comparison</h3>
        <p className="hint">
          Applies whenever someone picks "Period comparison" from the toolbar. Compares each period's <em>representative</em>{' '}
          value — its total, or its sole item when the total is hidden as a single-item group — against the previous
          period's. Breakdown rows within a period are never colored.
        </p>
        <label className="row">
          Period field:
          <select
            value={state.formatting.periodComparison.periodField ?? ''}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                formatting: { ...s.formatting, periodComparison: { ...s.formatting.periodComparison, periodField: e.target.value || null } },
              }))
            }
          >
            <option value="">Select a column field…</option>
            {columnFieldNames.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          Direction:
          <select
            value={state.formatting.periodComparison.direction}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                formatting: { ...s.formatting, periodComparison: { ...s.formatting.periodComparison, direction: e.target.value as ComparisonDirection } },
              }))
            }
          >
            <option value="higherIsBetter">Higher is better</option>
            <option value="lowerIsBetter">Lower is better</option>
          </select>
        </label>
        <div className="color-row">
          <label>
            Improved
            <input
              type="color"
              value={state.formatting.periodComparison.improvedColor}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  formatting: { ...s.formatting, periodComparison: { ...s.formatting.periodComparison, improvedColor: e.target.value } },
                }))
              }
            />
          </label>
          <label>
            Declined
            <input
              type="color"
              value={state.formatting.periodComparison.declinedColor}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  formatting: { ...s.formatting, periodComparison: { ...s.formatting.periodComparison, declinedColor: e.target.value } },
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="panel-section">
        <h3>Heatmap</h3>
        <p className="hint">
          Applies whenever someone picks "Heatmap" from the toolbar (they also choose there whether to compare rows or
          columns, and which field). Values are bucketed into 4 quartiles, weakest to strongest — not a smooth gradient.
        </p>
        <div className="color-row">
          {([0, 1, 2, 3] as const).map((i) => (
            <label key={i}>
              {['Lowest', 'Low', 'High', 'Highest'][i]}
              <input type="color" value={state.formatting.heatmap.bucketColors[i]} onChange={(e) => updateBucketColor(i, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h3>Measure Formatting</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={state.hideMeasureHeaderRow}
            onChange={(e) => setState((s) => ({ ...s, hideMeasureHeaderRow: e.target.checked }))}
          />
          Hide the row showing measure names
        </label>
        {measureFieldNames.length === 0 && <p className="hint">No measures on the Measures encoding yet.</p>}
        {measureFieldNames.map((fieldName) => {
          const format = measureFormat(fieldName);
          return (
            <div key={fieldName} className="measure-format-row">
              <strong>{fieldName}</strong>
              <label>
                Label
                <input
                  type="text"
                  placeholder={fieldName}
                  value={format.label}
                  disabled={!!format.labelParameterName}
                  onChange={(e) => updateMeasureFormat(fieldName, { ...format, label: e.target.value })}
                />
              </label>
              <label>
                Or from parameter
                <select
                  value={format.labelParameterName ?? ''}
                  onChange={(e) => updateMeasureFormat(fieldName, { ...format, labelParameterName: e.target.value || null })}
                >
                  <option value="">(none)</option>
                  {parameters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Decimals
                <select value={format.decimals} onChange={(e) => updateMeasureFormat(fieldName, { ...format, decimals: Number(e.target.value) })}>
                  <option value={-1}>Auto</option>
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>
              <label>
                Prefix
                <input
                  type="text"
                  style={{ width: 50 }}
                  value={format.prefix}
                  onChange={(e) => updateMeasureFormat(fieldName, { ...format, prefix: e.target.value })}
                />
              </label>
              <label>
                Suffix
                <input
                  type="text"
                  style={{ width: 50 }}
                  value={format.suffix}
                  onChange={(e) => updateMeasureFormat(fieldName, { ...format, suffix: e.target.value })}
                />
              </label>
            </div>
          );
        })}
      </section>

      {error && <p className="error">{error}</p>}

      <div className="button-row">
        <span className="version-label">v{EXTENSION_VERSION}</span>
        <button onClick={handleCancel}>Cancel</button>
        <button className="primary" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
