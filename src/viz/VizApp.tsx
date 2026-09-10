import { useEffect, useRef, useState } from 'react';
import type { Worksheet } from '@tableau/extensions-api-types';
import type { DataRow, PivotDisplayState } from '../types';
import { createDefaultDisplayState, parseDisplayState, serializeDisplayState, SETTINGS_KEY } from '../lib/settingsSchema';
import {
  type EncodingMap,
  getEncodingMap,
  getSettingsString,
  getWorksheet,
  initializeVizExtension,
  isAuthoringMode,
  onSettingsChanged,
  onSummaryDataChanged,
  readWorksheetData,
  saveSettings,
  setSettingsString,
} from '../lib/tableauClient';
import { TotalsControls } from './TotalsControls';
import { FormattingControls } from './FormattingControls';
import { PivotTableView } from './PivotTableView';

type Status = 'loading' | 'ready' | 'error';

const EMPTY_ENCODINGS: EncodingMap = { rows: [], columns: [], measures: [] };

export function VizApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [encodings, setEncodings] = useState<EncodingMap>(EMPTY_ENCODINGS);
  const [displayState, setDisplayState] = useState<PivotDisplayState>(createDefaultDisplayState());

  const worksheetRef = useRef<Worksheet | null>(null);

  useEffect(() => {
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeSettings: (() => void) | undefined;

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
    };
  }, []);

  function updateDisplayState(next: PivotDisplayState) {
    setDisplayState(next);
    // Settings can only be persisted while authoring the worksheet; for viewers
    // this just changes their own current session, which is the right fallback.
    if (isAuthoringMode()) {
      setSettingsString(SETTINGS_KEY, serializeDisplayState(next));
      saveSettings().catch(() => {});
    }
  }

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
        <TotalsControls
          totalsMode={displayState.totalsMode}
          conditionalTotals={displayState.conditionalTotals}
          onTotalsModeChange={(totalsMode) => updateDisplayState({ ...displayState, totalsMode })}
          onConditionalTotalsChange={(conditionalTotals) => updateDisplayState({ ...displayState, conditionalTotals })}
        />
        <FormattingControls
          formatting={displayState.formatting}
          periodFieldOptions={encodings.columns}
          onChange={(formatting) => updateDisplayState({ ...displayState, formatting })}
        />
      </div>
      <PivotTableView
        data={rows}
        rowFields={encodings.rows}
        columnFields={encodings.columns}
        measures={encodings.measures.map((fieldName) => ({ fieldName }))}
        totalsMode={displayState.totalsMode}
        conditionalTotals={displayState.conditionalTotals}
        formatting={displayState.formatting}
      />
    </div>
  );
}
