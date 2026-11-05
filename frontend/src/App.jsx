import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calculate, getMeta } from './api.js'
import InputForm from './components/InputForm.jsx'
import ImageInput from './components/ImageInput.jsx'
import DronePhoto from './components/DronePhoto.jsx'
import Results from './components/Results.jsx'

const INITIAL_FORM = {
  voltage_kv: 220, location: 'elsewhere', insulated: false,
  span: 350, attach_height: 30, conductor: 'ACSR Zebra', phase_gap: 5.5,
  factor_of_safety: 2, ref_temp: 32, max_temp: 75, wind_pressure: 0, phase_offset: 0,
  phase_sag_dev: {},
  tree: { enabled: true, height: 14, x: 175, offset: 6, canopy_radius: 3, growth_rate: 0.5 },
}

const isFilled = (v) => v !== '' && Number.isFinite(v)
const clampTreePosition = (position, span) => Math.min(Math.max(Number(position) || 0, 0), span)

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
  const [assets, setAssets] = useState({ from: '', to: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const treePositionEdited = useRef(false)
  const lastMeasuredSpan = useRef(null)

  useEffect(() => {
    const ctrl = new AbortController()
    getMeta(ctrl.signal).then(setMeta).catch((e) => e.name !== 'AbortError' && setError(e.message))
    return () => ctrl.abort()
  }, [])

  const payload = useMemo(() => buildPayload(form, mode === 'image' ? measured : null), [form, mode, measured])
  const spanLabel = assets.from && assets.to ? `Span ${assets.from} → ${assets.to}` : ''

  // One debounced request per real input change; stale requests are aborted.
  useEffect(() => {
    if (!payload || mode === 'drone') return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      calculate(payload, ctrl.signal)
        .then((r) => { setResult(r); setError('') })
        .catch((e) => e.name !== 'AbortError' && setError(e.message))
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [payload, mode])

  const update = useCallback((patch, options) => {
    if (options?.treePosition) treePositionEdited.current = true
    setForm((f) => {
      const spanChanged = Number.isFinite(patch.span) && patch.span >= 0 && patch.span !== f.span
      if (!spanChanged) return { ...f, ...patch }
      const x = treePositionEdited.current ? clampTreePosition(f.tree.x, patch.span) : patch.span / 2
      treePositionEdited.current = false
      return { ...f, ...patch, tree: { ...f.tree, x } }
    })
  }, [])

  const handleMeasured = useCallback((next) => {
    setMeasured(next)
    const span = next?.span ?? null
    if (span === lastMeasuredSpan.current) return
    lastMeasuredSpan.current = span
    if (Number.isFinite(span) && span >= 0) {
      setForm((f) => {
        const x = treePositionEdited.current ? clampTreePosition(f.tree.x, span) : span / 2
        treePositionEdited.current = false
        return { ...f, tree: { ...f.tree, x } }
      })
    }
  }, [])

  const applyVoltage = useCallback((kv) => setForm((f) => {
    const preset = meta?.presets[kv] ?? {}
    const span = preset.span ?? f.span
    const spanChanged = span !== f.span
    const x = spanChanged
      ? treePositionEdited.current ? clampTreePosition(f.tree.x, span) : span / 2
      : f.tree.x
    if (spanChanged) treePositionEdited.current = false
    return { ...f, ...preset, voltage_kv: kv, insulated: false, tree: { ...f.tree, x } }
  }), [meta])

  const exportReport = () => {
    const blob = new Blob([JSON.stringify({ generated: new Date().toISOString(), mode, assets,
      camera: mode === 'image' ? measured?.camera ?? null : null, input: payload, result }, null, 2)],
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
            {[['text', 'Text'], ['image', 'Side-view image'], ['drone', 'Drone photo']].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''}
                onClick={() => setMode(key)}>{label}</button>
            ))}
          </div>
          {mode === 'image' && <ImageInput onMeasured={handleMeasured} assets={assets} onAssets={setAssets} />}
          {mode !== 'drone' && (meta
            ? <InputForm form={form} meta={meta} onChange={update} onVoltage={applyVoltage}
                geometryFromImage={mode === 'image' && Boolean(measured)} imageGeometry={mode === 'image' ? measured : null} />
            : <p className="muted">Loading reference data…</p>)}
        </aside>

        <section className="results">
          {mode === 'drone' ? (
            <>
              <div className="alert soft">Drone photo mode detects conductors, poles and vegetation. Sag and clearance need the side-view or text input.</div>
              <DronePhoto assets={assets} onAssets={setAssets} />
            </>
          ) : (
            <>
              {error && <div className="alert">{error}</div>}
              {!payload && <div className="alert soft">Fill in every field to run the check.</div>}
              {result ? <Results result={result} voltage={form.voltage_kv} tree={payload?.tree} span={payload?.span ?? form.span}
                sources={meta?.sources} showArmB={mode !== 'image'} spanLabel={spanLabel}
                photoTemp={mode === 'image' && measured ? measured.photo_temp : null} />
                : <p className="muted">Calculating…</p>}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
