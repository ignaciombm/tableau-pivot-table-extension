import { useEffect, useState } from 'react';
import type { ComparisonDirection, HeatmapScope, MeasureFormat, PivotDisplayState, TotalsPosition } from '../types';
import { createDefaultDisplayState, parseDisplayState, serializeDisplayState, SETTINGS_KEY } from '../lib/settingsSchema';
import {
  closeSettingsDialog,
  getEncodingMap,
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

  useEffect(() => {
    (async () => {
      try {
        await initializeSettingsDialog();
        const worksheet = getWorksheet();
        const encodings = await getEncodingMap(worksheet);
        setMeasureFieldNames(encodings.measures);
        setColumnFieldNames(encodings.columns);
        setState(parseDisplayState(getSettingsString(SETTINGS_KEY)));
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, []);

  function measureFormat(fieldName: string): MeasureFormat {
    return state.measureFormats[fieldName] ?? { decimals: -1, prefix: '', suffix: '', label: '' };
  }

  function updateMeasureFormat(fieldName: string, format: MeasureFormat) {
    setState((s) => ({ ...s, measureFormats: { ...s.measureFormats, [fieldName]: format } }));
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

      <section className="panel-section">
        <h3>Totals Position</h3>
        <label className="row">
          Row totals:
          <select
            value={state.rowTotalsPosition}
            onChange={(e) => setState((s) => ({ ...s, rowTotalsPosition: e.target.value as TotalsPosition }))}
          >
            <option value="after">Bottom</option>
            <option value="before">Top</option>
          </select>
        </label>
        <label className="row">
          Column totals:
          <select
            value={state.columnTotalsPosition}
            onChange={(e) => setState((s) => ({ ...s, columnTotalsPosition: e.target.value as TotalsPosition }))}
          >
            <option value="after">Right</option>
            <option value="before">Left</option>
          </select>
        </label>
      </section>

      <section className="panel-section">
        <h3>Conditional Totals</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={state.conditionalTotals.hideSingleItemGroups}
            onChange={(e) => setState((s) => ({ ...s, conditionalTotals: { ...s.conditionalTotals, hideSingleItemGroups: e.target.checked } }))}
          />
          Hide totals for single-item groups
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
                conditionalTotals: { ...s.conditionalTotals, minValueThreshold: e.target.value === '' ? null : Number(e.target.value) },
              }))
            }
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Period-over-period Comparison</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={state.formatting.periodComparison.enabled}
            onChange={(e) =>
              setState((s) => ({ ...s, formatting: { ...s.formatting, periodComparison: { ...s.formatting.periodComparison, enabled: e.target.checked } } }))
            }
          />
          Enabled
        </label>
        {state.formatting.periodComparison.enabled && (
          <>
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
          </>
        )}
      </section>

      <section className="panel-section">
        <h3>Heatmap</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={state.formatting.heatmap.enabled}
            onChange={(e) => setState((s) => ({ ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, enabled: e.target.checked } } }))}
          />
          Enabled
        </label>
        {state.formatting.heatmap.enabled && (
          <>
            <label className="row">
              Scope:
              <select
                value={state.formatting.heatmap.scope}
                onChange={(e) => setState((s) => ({ ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, scope: e.target.value as HeatmapScope } } }))}
              >
                <option value="table">Entire table</option>
                <option value="rows">Per row</option>
                <option value="columns">Per column</option>
              </select>
            </label>
            <p className="hint">Subtotal/grand-total cells are always colored on their own separate scale.</p>
            <div className="color-row">
              <label>
                Low
                <input
                  type="color"
                  value={state.formatting.heatmap.minColor}
                  onChange={(e) => setState((s) => ({ ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, minColor: e.target.value } } }))}
                />
              </label>
              <label>
                Mid
                <input
                  type="color"
                  value={state.formatting.heatmap.midColor}
                  onChange={(e) => setState((s) => ({ ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, midColor: e.target.value } } }))}
                />
              </label>
              <label>
                High
                <input
                  type="color"
                  value={state.formatting.heatmap.maxColor}
                  onChange={(e) => setState((s) => ({ ...s, formatting: { ...s.formatting, heatmap: { ...s.formatting.heatmap, maxColor: e.target.value } } }))}
                />
              </label>
            </div>
          </>
        )}
      </section>

      <section className="panel-section">
        <h3>Measure Formatting</h3>
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
                  onChange={(e) => updateMeasureFormat(fieldName, { ...format, label: e.target.value })}
                />
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
