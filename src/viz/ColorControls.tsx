import type { ColorMode, HeatmapConfig, HeatmapScope } from '../types';

interface Props {
  colorMode: ColorMode;
  heatmap: HeatmapConfig;
  rowFieldNames: string[];
  columnFieldNames: string[];
  onColorModeChange: (mode: ColorMode) => void;
  onHeatmapChange: (heatmap: HeatmapConfig) => void;
}

/**
 * The only color controls exposed to whoever is using the worksheet — how
 * period comparison itself compares (field, direction, colors) is entirely
 * creator-configured (Format Extension) and never shown here.
 */
export function ColorControls({ colorMode, heatmap, rowFieldNames, columnFieldNames, onColorModeChange, onHeatmapChange }: Props) {
  const compareFieldOptions = heatmap.scope === 'rows' ? columnFieldNames : rowFieldNames;

  return (
    <div className="color-controls">
      <label className="inline-select">
        Color:
        <select value={colorMode} onChange={(e) => onColorModeChange(e.target.value as ColorMode)}>
          <option value="none">None</option>
          <option value="periodComparison">Period comparison</option>
          <option value="heatmap">Heatmap</option>
        </select>
      </label>
      {colorMode === 'heatmap' && (
        <>
          <label className="inline-select">
            Compare:
            <select
              value={heatmap.scope}
              onChange={(e) => onHeatmapChange({ ...heatmap, scope: e.target.value as HeatmapScope, compareField: null })}
            >
              <option value="rows">Rows</option>
              <option value="columns">Columns</option>
            </select>
          </label>
          <label className="inline-select">
            <select value={heatmap.compareField ?? ''} onChange={(e) => onHeatmapChange({ ...heatmap, compareField: e.target.value || null })}>
              <option value="">Field…</option>
              {compareFieldOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
