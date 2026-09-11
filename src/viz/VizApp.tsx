import { useEffect, useMemo, useRef, useState } from 'react';
import type { Parameter, Worksheet } from '@tableau/extensions-api-types';
import type { DataRow, PivotDisplayState } from '../types';
import { createDefaultDisplayState, parseDisplayState, serializeDisplayState, SETTINGS_KEY } from '../lib/settingsSchema';
import { dropAllNullFields, getAllGroupPathKeys } from '../lib/pivotEngine';
import {
  type EncodingMap,
  getEncodingMap,
  getParameters,
  getSettingsString,
  getWorksheet,
  initializeVizExtension,
  onParameterChanged,
  onSettingsChanged,
  onSummaryDataChanged,
  openSettingsDialog,
  readWorksheetData,
  saveSettings,
  setSettingsString,
} from '../lib/tableauClient';
import { TotalsControls } from './TotalsControls';
import { PivotTableView } from './PivotTableView';

type Status = 'loading' | 'ready' | 'error';

const EMPTY_ENCODINGS: EncodingMap = { rows: [], columns: [], measures: [] };

function toggledPath(paths: string[], pathKey: string): string[] {
  return paths.includes(pathKey) ? paths.filter((p) => p !== pathKey) : [...paths, pathKey];
}

export function VizApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [encodings, setEncodings] = useState<EncodingMap>(EMPTY_ENCODINGS);
  const [displayState, setDisplayState] = useState<PivotDisplayState>(createDefaultDisplayState());
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [parameterTick, setParameterTick] = useState(0);

  const worksheetRef = useRef<Worksheet | null>(null);

  useEffect(() => {
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeSettings: (() => void) | undefined;
    let unsubscribeParameters: Array<() => void> = [];

    async function refresh() {
      const worksheet = worksheetRef.current;
      if (!worksheet) return;
      try {
        const [encodingMap, dataRows] = await Promise.all([getEncodingMap(worksheet), readWorksheetData(worksheet)]);
        setEncodings(encodingMap);
        setRows(dataRows);
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    (async () => {
      try {
        await initializeVizExtension();
        const worksheet = getWorksheet();
        worksheetRef.current = worksheet;

        setDisplayState(parseDisplayState(getSettingsString(SETTINGS_KEY)));
        await refresh();

        const params = await getParameters(worksheet);
        setParameters(params);
        unsubscribeParameters = params.map((p) => onParameterChanged(p, () => setParameterTick((t) => t + 1)));

        unsubscribeData = onSummaryDataChanged(worksheet, refresh);
        unsubscribeSettings = onSettingsChanged(() => setDisplayState(parseDisplayState(getSettingsString(SETTINGS_KEY))));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      unsubscribeData?.();
      unsubscribeSettings?.();
      unsubscribeParameters.forEach((unsub) => unsub());
    };
  }, []);

  function updateDisplayState(next: PivotDisplayState) {
    setDisplayState(next);
    setSettingsString(SETTINGS_KEY, serializeDisplayState(next));
    // Persisting only actually survives to future sessions while authoring;
    // for a viewer this still updates the current session's live settings.
    saveSettings().catch(() => {});
  }

  async function handleOpenSettings() {
    const url = new URL('configure.html', window.location.href).toString();
    try {
      await openSettingsDialog(url);
    } catch {
      // Dialog closed without saving (e.g. the user clicked the X) — nothing to do.
    }
    setDisplayState(parseDisplayState(getSettingsString(SETTINGS_KEY)));
  }

  function handleCollapseAllRows() {
    const effectiveRowFields = dropAllNullFields(encodings.rows, rows);
    updateDisplayState({ ...displayState, collapsedRowPaths: getAllGroupPathKeys(rows, effectiveRowFields) });
  }

  function handleExpandAllRows() {
    updateDisplayState({ ...displayState, collapsedRowPaths: [] });
  }

  // Resolve each measure's label from its chosen Tableau parameter (if any), live.
  const effectiveDisplayState = useMemo((): PivotDisplayState => {
    const hasParameterLabels = Object.values(displayState.measureFormats).some((f) => f.labelParameterName);
    if (!hasParameterLabels) return displayState;

    const measureFormats = { ...displayState.measureFormats };
    for (const [fieldName, format] of Object.entries(measureFormats)) {
      if (!format.labelParameterName) continue;
      const parameter = parameters.find((p) => p.name === format.labelParameterName);
      const resolvedLabel = parameter?.currentValue.formattedValue ?? parameter?.currentValue.value;
      if (resolvedLabel !== undefined && resolvedLabel !== null) {
        measureFormats[fieldName] = { ...format, label: String(resolvedLabel) };
      }
    }
    return { ...displayState, measureFormats };
  }, [displayState, parameters, parameterTick]);

  if (status === 'loading') return <div className="viz-app">Loading…</div>;
  if (status === 'error') return <div className="viz-app error">Error: {error}</div>;

  const hasEncodings = encodings.rows.length > 0 || encodings.columns.length > 0 || encodings.measures.length > 0;
  if (!hasEncodings) {
    return (
      <div className="viz-app empty-state">
        Drag fields onto <strong>Rows</strong>, <strong>Columns</strong>, and <strong>Measures</strong> on the Marks
        card to build your pivot table.
      </div>
    );
  }

  return (
    <div className="viz-app">
      <div className="controls-bar">
        <TotalsControls totalsMode={displayState.totalsMode} onTotalsModeChange={(totalsMode) => updateDisplayState({ ...displayState, totalsMode })} />
        <button type="button" onClick={handleCollapseAllRows}>
          Collapse rows
        </button>
        <button type="button" onClick={handleExpandAllRows}>
          Expand rows
        </button>
        <button type="button" className="settings-button" onClick={handleOpenSettings} aria-label="Settings" title="Settings">
          ⚙ Settings
        </button>
      </div>
      <PivotTableView
        data={rows}
        rowFields={encodings.rows}
        columnFields={encodings.columns}
        measures={encodings.measures.map((fieldName) => ({ fieldName }))}
        displayState={effectiveDisplayState}
        onToggleRowPath={(pathKey) => updateDisplayState({ ...displayState, collapsedRowPaths: toggledPath(displayState.collapsedRowPaths, pathKey) })}
        onToggleColumnPath={(pathKey) =>
          updateDisplayState({ ...displayState, collapsedColumnPaths: toggledPath(displayState.collapsedColumnPaths, pathKey) })
        }
      />
    </div>
  );
}
