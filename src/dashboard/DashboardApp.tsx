import { useEffect, useRef, useState } from 'react';
import type { DataRow, ExtensionSettings, FieldInfo, FormattingConfig, UserPivotState } from '../types';
import { parseSettings, SETTINGS_KEY } from '../lib/settingsSchema';
import {
  getSettingsString,
  getWorksheetByName,
  initializeDashboardExtension,
  onSettingsChanged,
  onSummaryDataChanged,
  readWorksheetData,
} from '../lib/tableauClient';
import { FieldPicker } from './FieldPicker';
import { FormattingControls } from './FormattingControls';
import { PivotTableView } from './PivotTableView';

type Status = 'loading' | 'ready' | 'no-config' | 'error';

function buildInitialUserState(settings: ExtensionSettings): UserPivotState {
  return {
    rows: settings.layout.axisLock === 'lockRows' ? settings.layout.lockedRows : settings.defaults.rows,
    columns: settings.layout.axisLock === 'lockColumns' ? settings.layout.lockedColumns : settings.defaults.columns,
    measures: settings.defaults.measures,
    totalsMode: settings.totalsModeDefault,
    conditionalTotals: settings.conditionalTotals,
    formatting: settings.formattingDefaults,
  };
}

export function DashboardApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [userState, setUserState] = useState<UserPivotState | null>(null);

  const dataUnsubscribeRef = useRef<(() => void) | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    async function refreshData(worksheetName: string) {
      const worksheet = getWorksheetByName(worksheetName);
      if (!worksheet) return;
      const { fields: f, rows: r } = await readWorksheetData(worksheet);
      setFields(f);
      setRows(r);
    }

    async function loadSettingsAndData() {
      try {
        const parsed = parseSettings(getSettingsString(SETTINGS_KEY));
        setSettings(parsed);

        if (!parsed.worksheetName) {
          setStatus('no-config');
          return;
        }
        const worksheet = getWorksheetByName(parsed.worksheetName);
        if (!worksheet) {
          setError(`Worksheet "${parsed.worksheetName}" was not found on this dashboard.`);
          setStatus('error');
          return;
        }

        const { fields: f, rows: r } = await readWorksheetData(worksheet);
        setFields(f);
        setRows(r);
        setUserState(buildInitialUserState(parsed));

        dataUnsubscribeRef.current?.();
        dataUnsubscribeRef.current = onSummaryDataChanged(worksheet, () => refreshData(parsed.worksheetName!));

        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    reloadRef.current = loadSettingsAndData;

    function handleConfigure() {
      const url = new URL('configure.html', window.location.href).toString();
      tableau.extensions.ui
        .displayDialogAsync(url, '', { height: 640, width: 520 })
        .then(() => reloadRef.current())
        .catch(() => {
          /* user closed the dialog without saving */
        });
    }

    let unsubscribeSettings: (() => void) | undefined;
    (async () => {
      try {
        await initializeDashboardExtension(handleConfigure);
        await loadSettingsAndData();
        unsubscribeSettings = onSettingsChanged(() => loadSettingsAndData());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      unsubscribeSettings?.();
      dataUnsubscribeRef.current?.();
    };
  }, []);

  if (status === 'loading') return <div className="dashboard-app">Loading…</div>;
  if (status === 'error') return <div className="dashboard-app error">Error: {error}</div>;
  if (status === 'no-config' || !settings) {
    return (
      <div className="dashboard-app empty-state">
        This pivot table has not been configured yet. Right-click the extension and choose <strong>Configure…</strong>{' '}
        to get started.
      </div>
    );
  }
  if (!userState) return null;

  const effectiveFormatting: FormattingConfig = settings.allowUserFormattingOverrides ? userState.formatting : settings.formattingDefaults;

  return (
    <div className="dashboard-app">
      <div className="controls-bar">
        <FieldPicker settings={settings} userState={userState} onChange={setUserState} />
        {settings.allowUserFormattingOverrides && (
          <FormattingControls
            formatting={userState.formatting}
            periodFieldOptions={userState.columns}
            onChange={(formatting) => setUserState((s) => (s ? { ...s, formatting } : s))}
          />
        )}
      </div>
      <PivotTableView
        data={rows}
        fields={fields}
        rowFields={userState.rows}
        columnFields={userState.columns}
        measures={userState.measures}
        totalsMode={userState.totalsMode}
        conditionalTotals={userState.conditionalTotals}
        formatting={effectiveFormatting}
      />
    </div>
  );
}
