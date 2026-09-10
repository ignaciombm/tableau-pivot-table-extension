import { useEffect, useState } from 'react';
import type { ExtensionSettings, FieldInfo } from '../types';
import { createDefaultSettings, parseSettings, serializeSettings, SETTINGS_KEY } from '../lib/settingsSchema';
import {
  getSettingsString,
  getWorksheetByName,
  getWorksheetFields,
  getWorksheets,
  initializeConfigureDialog,
  saveSettings,
  setSettingsString,
} from '../lib/tableauClient';
import { FieldWhitelist } from './FieldWhitelist';
import { LayoutControl } from './LayoutControl';
import { DefaultFieldsPanel } from './DefaultFieldsPanel';
import { FormattingDefaultsPanel } from './FormattingDefaultsPanel';

type Status = 'loading' | 'ready' | 'saving' | 'error';

export function AdminApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings>(createDefaultSettings());
  const [worksheetNames, setWorksheetNames] = useState<string[]>([]);
  const [fields, setFields] = useState<FieldInfo[]>([]);

  useEffect(() => {
    (async () => {
      try {
        await initializeConfigureDialog();
        const initial = parseSettings(getSettingsString(SETTINGS_KEY));
        setSettings(initial);
        setWorksheetNames(getWorksheets().map((w) => w.name));
        if (initial.worksheetName) {
          const worksheet = getWorksheetByName(initial.worksheetName);
          if (worksheet) setFields(await getWorksheetFields(worksheet));
        }
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
  }, []);

  async function handleWorksheetChange(name: string) {
    setSettings((s) => ({
      ...s,
      worksheetName: name,
      allowedDimensions: [],
      allowedMeasures: [],
      defaults: { rows: [], columns: [], measures: [] },
      layout: { ...s.layout, lockedColumns: [], lockedRows: [] },
    }));
    setFields([]);
    const worksheet = getWorksheetByName(name);
    if (worksheet) setFields(await getWorksheetFields(worksheet));
  }

  async function handleSave() {
    setStatus('saving');
    try {
      setSettingsString(SETTINGS_KEY, serializeSettings(settings));
      await saveSettings();
      tableau.extensions.ui.closeDialog('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('ready');
    }
  }

  function handleCancel() {
    tableau.extensions.ui.closeDialog('cancelled');
  }

  if (status === 'loading') return <div className="admin-app">Loading configuration…</div>;
  if (status === 'error') return <div className="admin-app error">Error: {error}</div>;

  return (
    <div className="admin-app">
      <h2>Pivot Table — Configuration</h2>

      <section className="panel-section">
        <h3>Data Source</h3>
        <label>
          Worksheet:
          <select
            style={{ marginLeft: 8 }}
            value={settings.worksheetName ?? ''}
            onChange={(e) => handleWorksheetChange(e.target.value)}
          >
            <option value="">Select a worksheet…</option>
            {worksheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {settings.worksheetName && (
        <>
          <FieldWhitelist
            fields={fields}
            allowedDimensions={settings.allowedDimensions}
            allowedMeasures={settings.allowedMeasures}
            onChange={(allowedDimensions, allowedMeasures) =>
              setSettings((s) => ({ ...s, allowedDimensions, allowedMeasures }))
            }
          />

          <LayoutControl
            layout={settings.layout}
            allowedDimensions={settings.allowedDimensions}
            onChange={(layout) => setSettings((s) => ({ ...s, layout }))}
          />

          <DefaultFieldsPanel
            defaults={settings.defaults}
            layout={settings.layout}
            allowedDimensions={settings.allowedDimensions}
            allowedMeasures={settings.allowedMeasures}
            onChange={(defaults) => setSettings((s) => ({ ...s, defaults }))}
          />

          <FormattingDefaultsPanel
            totalsMode={settings.totalsModeDefault}
            conditionalTotals={settings.conditionalTotals}
            formatting={settings.formattingDefaults}
            allowUserFormattingOverrides={settings.allowUserFormattingOverrides}
            periodFieldOptions={settings.allowedDimensions}
            onTotalsModeChange={(totalsModeDefault) => setSettings((s) => ({ ...s, totalsModeDefault }))}
            onConditionalTotalsChange={(conditionalTotals) => setSettings((s) => ({ ...s, conditionalTotals }))}
            onFormattingChange={(formattingDefaults) => setSettings((s) => ({ ...s, formattingDefaults }))}
            onAllowOverridesChange={(allowUserFormattingOverrides) =>
              setSettings((s) => ({ ...s, allowUserFormattingOverrides }))
            }
          />
        </>
      )}

      {error && <p className="error">{error}</p>}

      <div className="button-row">
        <button onClick={handleCancel}>Cancel</button>
        <button className="primary" onClick={handleSave} disabled={status === 'saving' || !settings.worksheetName}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
