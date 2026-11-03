import { memo } from 'react'

const toNumber = (raw) => (raw === '' ? '' : Number(raw))
const PHASE_IDS = ['A-B', 'A-R', 'A-Y', 'B-B', 'B-R', 'B-Y']   // BRY order, top to bottom
const LOCATIONS = [['elsewhere', 'Open ground'], ['along_street', 'Along a street'], ['across_street', 'Across a street']]

export function NumberField({ label, unit, value, onChange, step = 'any', min, disabled, hint }) {
  return (
    <label className="field">
      <span>{label}{unit && <em>{unit}</em>}</span>
      <input type="number" value={value} step={step} min={min} disabled={disabled}
        onChange={(e) => onChange(toNumber(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function InputForm({ form, meta, onChange, onVoltage, geometryFromImage }) {
  const cond = meta.conductors[form.conductor]
  const setTree = (patch) => onChange({ tree: { ...form.tree, ...patch } })
  const setDev = (id, v) => onChange({ phase_sag_dev: { ...form.phase_sag_dev, [id]: v === '' ? 0 : v } })
  const geoHint = geometryFromImage ? 'from image' : undefined

  return (
    <div className="form">
      <fieldset>
        <legend>Line</legend>
        <label className="field">
          <span>System voltage<em>kV</em></span>
          <select value={form.voltage_kv} onChange={(e) => onVoltage(Number(e.target.value))}>
            {meta.voltages.map((v) => <option key={v} value={v}>{v} kV</option>)}
          </select>
          <small>Changing voltage loads typical span, height and conductor</small>
        </label>
        <label className="field">
          <span>Line location</span>
          <select value={form.location} onChange={(e) => onChange({ location: e.target.value })}>
            {LOCATIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <small>Sets the CEA ground clearance (streets need more)</small>
        </label>
        {form.voltage_kv === 11 && form.location === 'elsewhere' && (
          <label className="check field-check"><input type="checkbox" checked={form.insulated}
            onChange={(e) => onChange({ insulated: e.target.checked })} /> Insulated (covered) conductor</label>
        )}
        <label className="field">
          <span>Conductor</span>
          <select value={form.conductor} onChange={(e) => onChange({ conductor: e.target.value })}>
            {Object.keys(meta.conductors).map((c) => <option key={c}>{c}</option>)}
          </select>
          <small>{cond.weight_kg_km} kg/km · Ø {cond.diameter_mm} mm · UTS {cond.uts_kN} kN{!cond.verified && ' · typical values, verify'}</small>
        </label>
        <div className="grid2">
          <NumberField label="Span" unit="m" value={form.span} onChange={(span) => onChange({ span })} disabled={geometryFromImage} hint={geoHint} />
          <NumberField label="Attachment height" unit="m" value={form.attach_height} onChange={(attach_height) => onChange({ attach_height })}
            disabled={geometryFromImage} hint={geoHint ?? 'lowest phase'} />
          <NumberField label="Phase spacing" unit="m" value={form.phase_gap} onChange={(phase_gap) => onChange({ phase_gap })} hint="B-R and R-Y, at tower" />
          <NumberField label="Outer phase offset" unit="m" value={form.phase_offset} onChange={(phase_offset) => onChange({ phase_offset })} hint="from centre line" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Conditions</legend>
        <div className="grid2">
          <NumberField label="Factor of safety" value={form.factor_of_safety} onChange={(factor_of_safety) => onChange({ factor_of_safety })}
            disabled={geometryFromImage} hint={geometryFromImage ? 'tension implied by image' : 'T = UTS ÷ FoS'} />
          <NumberField label="Stringing temp" unit="°C" value={form.ref_temp} onChange={(ref_temp) => onChange({ ref_temp })} />
          <NumberField label="Max conductor temp" unit="°C" value={form.max_temp} onChange={(max_temp) => onChange({ max_temp })} />
          <NumberField label="Wind pressure" unit="Pa" value={form.wind_pressure} min={0} onChange={(wind_pressure) => onChange({ wind_pressure })} hint="0 = still air" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Simulate phase sag fault <em>% extra sag</em></legend>
        <div className="grid3">
          {PHASE_IDS.map((id) => (
            <NumberField key={id} label={`Arm ${id[0]} · ${id[2]}`} value={form.phase_sag_dev[id] ?? 0} step={5}
              onChange={(v) => setDev(id, v)} />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>
          <label className="check"><input type="checkbox" checked={form.tree.enabled} onChange={(e) => setTree({ enabled: e.target.checked })} />
            Vegetation / tree canopy</label>
        </legend>
        {form.tree.enabled && (
          <div className="grid2">
            <NumberField label="Tree height" unit="m" value={form.tree.height} onChange={(height) => setTree({ height })} />
            <NumberField label="Canopy radius" unit="m" value={form.tree.canopy_radius} onChange={(canopy_radius) => setTree({ canopy_radius })} />
            <NumberField label="Position along span" unit="m" value={form.tree.x} onChange={(x) => setTree({ x })} />
            <NumberField label="Offset from line" unit="m" value={form.tree.offset} onChange={(offset) => setTree({ offset })} />
            <NumberField label="Growth rate" unit="m/yr" value={form.tree.growth_rate} onChange={(growth_rate) => setTree({ growth_rate })} />
          </div>
        )}
      </fieldset>
    </div>
  )
}

export default memo(InputForm)
