import { useCallback, useEffect, useMemo, useState } from 'react'
import { calculate, getMeta } from './api.js'
import InputForm from './components/InputForm.jsx'
import ImageInput from './components/ImageInput.jsx'
import Results from './components/Results.jsx'

const INITIAL_FORM = {
  voltage_kv: 220, location: 'elsewhere', insulated: false,
  span: 350, attach_height: 30, conductor: 'ACSR Zebra', phase_gap: 5.5,
  factor_of_safety: 2, ref_temp: 32, max_temp: 75, wind_pressure: 0, phase_offset: 0,
  phase_sag_dev: {},
  tree: { enabled: true, height: 14, x: 175, offset: 6, canopy_radius: 3, growth_rate: 0.5 },
}

const isFilled = (v) => v !== '' && Number.isFinite(v)

function buildPayload(form, measured) {
  const { tree, ...rest } = form
  const { enabled, ...treeFields } = tree
  const payload = { ...rest, tree: enabled ? treeFields : null }
  if (measured) {
    const { sag, phase_sags, ...geometry } = measured
    Object.assign(payload, geometry, { measured: { sag, phase_sags } })
  }
  const numbers = [payload.span, payload.attach_height, payload.voltage_kv, payload.phase_gap, payload.max_temp,
    payload.factor_of_safety, ...(payload.tree ? Object.values(payload.tree) : [])]
  return numbers.every(isFilled) ? payload : null
}

export default function App() {
  const [meta, setMeta] = useState(null)
  const [mode, setMode] = useState('text')
  const [form, setForm] = useState(INITIAL_FORM)
  const [measured, setMeasured] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    getMeta(ctrl.signal).then(setMeta).catch((e) => e.name !== 'AbortError' && setError(e.message))
    return () => ctrl.abort()
  }, [])

  const payload = useMemo(() => buildPayload(form, mode === 'image' ? measured : null), [form, mode, measured])

  // One debounced request per real input change; stale requests are aborted.
  useEffect(() => {
    if (!payload) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      calculate(payload, ctrl.signal)
        .then((r) => { setResult(r); setError('') })
        .catch((e) => e.name !== 'AbortError' && setError(e.message))
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [payload])

  const update = useCallback((patch) => setForm((f) => ({ ...f, ...patch })), [])

  const applyVoltage = useCallback((kv) => setForm((f) => {
    const preset = meta?.presets[kv] ?? {}
    const span = preset.span ?? f.span
    return { ...f, ...preset, voltage_kv: kv, insulated: false, tree: { ...f.tree, x: span / 2 } }
  }), [meta])

  const exportReport = () => {
    const blob = new Blob([JSON.stringify({ generated: new Date().toISOString(), input: payload, result }, null, 2)],
      { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `span-report-${form.voltage_kv}kV.json` })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Sag &amp; Clearance Analyser</h1>
          <p>11 / 33 / 220 kV span check · ground, vegetation and B-R-Y phase ratios · CEA / MoEF references</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={exportReport} disabled={!result}>Export JSON</button>
          <button className="ghost" onClick={() => window.print()} disabled={!result}>Print</button>
        </div>
      </header>

      <main className={`layout ${mode}`}>
        <aside className="panel inputs">
          <div className="tabs" role="tablist">
            {[['text', 'Text input'], ['image', 'Image input']].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''}
                onClick={() => setMode(key)}>{label}</button>
            ))}
          </div>
          {mode === 'image' && <ImageInput onMeasured={setMeasured} />}
          {meta
            ? <InputForm form={form} meta={meta} onChange={update} onVoltage={applyVoltage}
                geometryFromImage={mode === 'image' && Boolean(measured)} />
            : <p className="muted">Loading reference data…</p>}
        </aside>

        <section className="results">
          {error && <div className="alert">{error}</div>}
          {!payload && <div className="alert soft">Fill in every field to run the check.</div>}
          {result ? <Results result={result} voltage={form.voltage_kv} tree={payload?.tree} span={payload?.span ?? form.span} sources={meta?.sources} />
            : <p className="muted">Calculating…</p>}
        </section>
      </main>
    </div>
  )
}
