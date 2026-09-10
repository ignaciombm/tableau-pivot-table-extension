// Minimal ambient typings for the subset of the Tableau Extensions API
// (loaded globally via tableau.extensions.1.latest.js, see index.html/configure.html)
// that this extension actually uses. Not an exhaustive re-declaration of the API.

declare namespace Tableau {
  interface DataValue {
    value: string | number | boolean | null;
    formattedValue: string;
  }

  interface Column {
    fieldName: string;
    fieldId: string;
    dataType: string; // 'string' | 'int' | 'float' | 'bool' | 'date' | 'date-time' | 'spatial'
    isReferenced: boolean;
    index: number;
  }

  interface DataTable {
    columns: Column[];
    data: DataValue[][];
    totalRowCount: number;
  }

  interface DataTableReader {
    getDataTableAsync(): Promise<DataTable>;
  }

  type MarksSelectedEvent = { getMarksAsync: () => Promise<unknown> };

  interface Worksheet {
    name: string;
    getSummaryDataAsync(options?: { maxRows?: number; ignoreSelection?: boolean }): Promise<DataTable>;
    getUnderlyingTableDataAsync(tableId: string): Promise<DataTable>;
    addEventListener(eventType: string, handler: (event: unknown) => void): void;
    removeEventListener(eventType: string, handler: (event: unknown) => void): void;
  }

  interface Dashboard {
    name: string;
    worksheets: Worksheet[];
  }

  interface Settings {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    erase(key: string): void;
    saveAsync(): Promise<Settings>;
    addEventListener(eventType: string, handler: (event: unknown) => void): void;
    removeEventListener(eventType: string, handler: (event: unknown) => void): void;
  }

  interface UI {
    displayDialogAsync(url: string, payload: string, options: { height: number; width: number }): Promise<string>;
    closeDialog(payload: string): void;
  }

  interface DashboardContent {
    dashboard: Dashboard;
  }

  interface Extensions {
    initializeAsync(options?: { configure?: () => void }): Promise<void>;
    initializeDialogAsync(): Promise<string>;
    dashboardContent?: DashboardContent;
    settings: Settings;
    ui: UI;
    environment: { context: 'authoring' | 'viewer'; mode: string };
  }
}

interface Window {
  tableau: { extensions: Tableau.Extensions; TableauEventType?: Record<string, string> };
}

declare const tableau: { extensions: Tableau.Extensions; TableauEventType?: Record<string, string> };
