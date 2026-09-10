import type { FieldInfo } from '../types';

interface Props {
  fields: FieldInfo[];
  allowedDimensions: string[];
  allowedMeasures: string[];
  onChange: (allowedDimensions: string[], allowedMeasures: string[]) => void;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FieldWhitelist({ fields, allowedDimensions, allowedMeasures, onChange }: Props) {
  const dimensions = fields.filter((f) => f.role === 'dimension');
  const measures = fields.filter((f) => f.role === 'measure');

  return (
    <section className="panel-section">
      <h3>Field Whitelist</h3>
      <p className="hint">Choose which dimensions and measures end users are allowed to use in the pivot table.</p>
      <div className="two-column">
        <div>
          <h4>Dimensions</h4>
          {dimensions.length === 0 && <p className="hint">No dimensions found on this worksheet.</p>}
          {dimensions.map((f) => (
            <label key={f.fieldName} className="checkbox-row">
              <input
                type="checkbox"
                checked={allowedDimensions.includes(f.fieldName)}
                onChange={() => onChange(toggle(allowedDimensions, f.fieldName), allowedMeasures)}
              />
              {f.fieldName}
            </label>
          ))}
        </div>
        <div>
          <h4>Measures</h4>
          {measures.length === 0 && <p className="hint">No measures found on this worksheet.</p>}
          {measures.map((f) => (
            <label key={f.fieldName} className="checkbox-row">
              <input
                type="checkbox"
                checked={allowedMeasures.includes(f.fieldName)}
                onChange={() => onChange(allowedDimensions, toggle(allowedMeasures, f.fieldName))}
              />
              {f.fieldName}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
