import { memo } from 'react'

const toNumber = (raw) => (raw === '' ? '' : Number(raw))
const PHASE_IDS = ['A-B', 'A-R', 'A-Y', 'B-B', 'B-R', 'B-Y']   // BRY order, top to bottom
const LOCATIONS = [['elsewhere', 'Open ground'], ['along_street', 'Along a street'], ['across_street', 'Across a street']]

export function NumberField({ label, unit, value, onChange, step = 'any', min, disabled, hint }) {
  return (
    <label className="field">
      <span>{label}{unit && <em>({unit})</em>}</span>
      <input type="number" value={value} step={step} min={min} disabled={disabled}
        onChange={(e) => onChange(toNumber(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function InputForm({ form, meta, onChange, onVoltage, geometryFromImage, imageGeometry }) {
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
          <small>{Number(cond.weight_kg_km).toFixed(2)} kg/km · Ø {Number(cond.diameter_mm).toFixed(2)} mm · UTS {Number(cond.uts_kN).toFixed(2)} kN{!cond.verified && ' · typical values, verify'}</small>
        </label>
        <div className="grid2">
          <NumberField label="Span" unit="m" value={geometryFromImage ? imageGeometry?.span ?? '' : form.span}
            onChange={(span) => onChange({ span })} disabled={geometryFromImage} hint={geoHint} />
          <NumberField label="Attachment height" unit="m" value={geometryFromImage ? imageGeometry?.attach_height ?? '' : form.attach_height}
            onChange={(attach_height) => onChange({ attach_height })}
            disabled={geometryFromImage} hint={geoHint ?? 'lowest phase'} />
          <NumberField label="Phase spacing" unit="m" value={geometryFromImage ? imageGeometry?.phase_gap ?? '' : form.phase_gap}
            onChange={(phase_gap) => onChange({ phase_gap })} disabled={geometryFromImage}
            hint={geoHint ?? 'B-R and R-Y, at tower'} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Tree clearance</legend>
        <label className="check field-check"><input type="checkbox" checked={form.tree.enabled} onChange={(e) => setTree({ enabled: e.target.checked })} />
          Check a tree or canopy</label>
        {form.tree.enabled && (
          <div className="grid2">
            <NumberField label="Tree height" unit="m" value={form.tree.height} onChange={(height) => setTree({ height })} />
            <NumberField label="Tree distance from line (to trunk)" unit="m" value={form.tree.offset} onChange={(offset) => setTree({ offset })} />
          </div>
        )}
        {form.tree.enabled && form.tree.canopy_radius !== '' && form.tree.offset !== ''
          && Number(form.tree.canopy_radius) >= Number(form.tree.offset)
          && <p className="note small">Canopy reaches under the line.</p>}
      </fieldset>

      <details className="advanced">
        <summary>Advanced</summary>
        <fieldset>
          <legend>Line geometry</legend>
          <NumberField label="Phase offset from centre line" unit="m" value={form.phase_offset} onChange={(phase_offset) => onChange({ phase_offset })} hint="arm A on the tree side (+), arm B mirrored (−)" />
        </fieldset>
        <fieldset>
          <legend>Operating conditions</legend>
          <div className="grid2">
            <NumberField label={<>Factor of safety <span className="info-tip" title="A safety factor reduces the conductor's rated strength to set a conservative working tension." aria-label="A safety factor reduces the conductor's rated strength to set a conservative working tension.">ⓘ</span></>} unit="x" value={form.factor_of_safety} onChange={(factor_of_safety) => onChange({ factor_of_safety })}
              disabled={geometryFromImage} hint={geometryFromImage ? 'tension implied by image' : 'T = UTS ÷ FoS'} />
            <NumberField label="Reference temperature" unit="°C" value={form.ref_temp} onChange={(ref_temp) => onChange({ ref_temp })}
              disabled={geometryFromImage} hint={geometryFromImage ? 'photo temperature used instead' : 'tension = UTS ÷ FoS at this temperature'} />
            <NumberField label="Maximum conductor temperature" unit="°C" value={form.max_temp} onChange={(max_temp) => onChange({ max_temp })} />
            <NumberField label="Wind pressure" unit="Pa" value={form.wind_pressure} min={0} onChange={(wind_pressure) => onChange({ wind_pressure })} hint="tree check only · 0 = still air" />
          </div>
        </fieldset>
        <fieldset>
          <legend>Simulate phase sag fault</legend>
          <div className="grid3">
            {PHASE_IDS.map((id) => (
              <NumberField key={id} label={`Arm ${id[0]} · ${id[2]}`} unit="%" value={form.phase_sag_dev[id] ?? 0} step={5}
                onChange={(v) => setDev(id, v)} />
            ))}
          </div>
        </fieldset>
        {form.tree.enabled && (
          <fieldset>
            <legend>Tree detail</legend>
            <div className="grid2">
              <NumberField label="Canopy radius (spread from trunk)" unit="m" value={form.tree.canopy_radius} onChange={(canopy_radius) => setTree({ canopy_radius })} />
              <NumberField label="Position along span" unit="m" value={form.tree.x}
                onChange={(x) => onChange({ tree: { ...form.tree, x } }, { treePosition: true })} />
              <NumberField label="Growth rate" unit="m/yr" value={form.tree.growth_rate} onChange={(growth_rate) => setTree({ growth_rate })} />
            </div>
          </fieldset>
        )}
      </details>
    </div>
  )
}

export default memo(InputForm)
