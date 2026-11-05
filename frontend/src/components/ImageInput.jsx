import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { vectorize } from '../api.js'
import { homography, metricSag } from '../homography.js'
import CameraInfo from './CameraInfo.jsx'
import { NumberField } from './InputForm.jsx'

const SAMPLES = [
  { file: 'sag_diagram_132kv.jpeg', label: 'Sag diagram (250 m span)' },
  { file: 'sag_clearance_infographic.jpeg', label: 'Clearance infographic' },
  { file: 'practice_question_220kV.png', label: 'Practice question (300 m span)' },
]
const TOWER_KEYS = ['t1top', 't1base', 't2top', 't2base']
const TOWER_LABELS = { t1top: 'T1 top', t1base: 'T1 base', t2top: 'T2 top', t2base: 'T2 base' }
const PHASES_TOP_DOWN = { 1: ['A-Y'], 2: ['A-R', 'A-Y'], 3: ['A-B', 'A-R', 'A-Y'] }

const sagPx = ({ L, R, low }) => low[1] - (L[1] + ((R[1] - L[1]) * (low[0] - L[0])) / (R[0] - L[0] || 1))

function corrected(vec, h, towers, cal) {
  if (!towers || !(cal.span > 0) || !(cal.height > 0)) return null
  // TOWER_KEYS order: t1top, t1base, t2top, t2base  ->  (0,H) (0,0) (L,H) (L,0)
  const H = homography(TOWER_KEYS.map((k) => towers[k]), [[0, cal.height], [0, 0], [cal.span, cal.height], [cal.span, 0]])
  if (!H) return null
  const main = vec.curves.at(-1)
  const pts = main ? main.points.map(([x, y]) => H(x, y)) : [h.L, h.low, h.R].map(([x, y]) => H(x, y))
  const sag = metricSag(pts)
  const [, yL] = H(...h.L), [, yR] = H(...h.R)
  const attach = (yL + yR) / 2
  // viewing angle estimate: how much the far tower is foreshortened relative to the near one
  const hT1 = Math.hypot(towers.t1top[0] - towers.t1base[0], towers.t1top[1] - towers.t1base[1])
  const hT2 = Math.hypot(towers.t2top[0] - towers.t2base[0], towers.t2top[1] - towers.t2base[1])
  const angle = Math.round(Math.abs(Math.acos(Math.min(hT1, hT2) / Math.max(hT1, hT2)) * 180 / Math.PI))
  return sag > 0 && attach > 0 ? { sag, attach, angle } : null
}

function measure(vec, h, cal, towers) {
  if (!vec || !h || !(cal.span > 0)) return null
  const spanPx = h.R[0] - h.L[0]
  const heightPx = h.ground - (h.L[1] + h.R[1]) / 2
  if (spanPx <= 0 || heightPx <= 0) return null
  const xScale = cal.span / spanPx
  const yScale = cal.height > 0 ? cal.height / heightPx : xScale
  const sag = sagPx(h) * yScale
  if (!(sag > 0)) return null

  // Main (lowest) curve is edited by hand; other detected curves supply upper-phase sags.
  const others = vec.curves.slice(0, -1)
  const ids = PHASES_TOP_DOWN[vec.curves.length] ?? PHASES_TOP_DOWN[3]
  const phase_sags = Object.fromEntries(
    others.map((c, i) => [ids[i], +(c.sag_px * yScale).toFixed(3)]).concat([[ids.at(-1), +sag.toFixed(3)]]))
  const tops = vec.curves.map((c) => (c.attach_left[1] + c.attach_right[1]) / 2)
  const out = { span: +cal.span.toFixed(2), attach_height: +(heightPx * yScale).toFixed(2), sag: +sag.toFixed(3), phase_sags,
    photo_temp: cal.photo_temp === '' ? 35 : cal.photo_temp }
  if (tops.length > 1) out.phase_gap = +(((tops.at(-1) - tops[0]) / (tops.length - 1)) * yScale).toFixed(2)
  const fix = corrected(vec, h, towers, cal)
  if (fix) {
    const k = fix.sag / sag                      // scale every phase by the same correction factor
    out.sag = +fix.sag.toFixed(3)
    out.attach_height = +fix.attach.toFixed(2)
    for (const id of Object.keys(out.phase_sags)) out.phase_sags[id] = +(out.phase_sags[id] * k).toFixed(3)
  }
  return { values: out, xScale, yScale, rawSag: sag, corrected: fix }
}

function ImageInput({ onMeasured, assets, onAssets }) {
  const svgRef = useRef(null)
  const [img, setImg] = useState(null)          // { url, name }
  const [vec, setVec] = useState(null)
  const [handles, setHandles] = useState(null)  // { L, R, low, ground }
  const [cal, setCal] = useState({ span: '', height: '', photo_temp: 35 })
  const [towers, setTowers] = useState(null)   // { t1top, t1base, t2top, t2base } in image px
  const [drag, setDrag] = useState(null)
  const [status, setStatus] = useState('')

  const load = async (file, name) => {
    const url = URL.createObjectURL(file)
    setImg({ url, name })
    setCal((c) => ({ span: '', height: '', photo_temp: c.photo_temp }))
    setVec(null); setHandles(null); setTowers(null); setStatus('Vectorising…')
    try {
      const v = await vectorize(file)
      setVec(v)
      const main = v.curves.at(-1)
      setHandles(main
        ? { L: main.attach_left, R: main.attach_right, low: main.lowest, ground: v.ground_y }
        : { L: [v.width * 0.15, v.height * 0.3], R: [v.width * 0.85, v.height * 0.3], low: [v.width / 2, v.height * 0.45], ground: v.ground_y })
      setStatus(main ? `${v.curves.length} conductor(s) found · confidence ${Math.round(v.confidence * 100)}% · ground: ${v.ground_method}`
        : 'No conductor found automatically - drag the handles onto the wire.')
    } catch (e) {
      setStatus(e.message)
    }
  }

  const loadSample = async (s) => {
    const blob = await (await fetch(`/samples/${s.file}`)).blob()
    load(new File([blob], s.file, { type: blob.type }), s.label)
  }

  const measurement = useMemo(() => measure(vec, handles, cal, towers), [vec, handles, cal, towers])

  const markTowers = () => {
    if (!handles) return
    const g = handles.ground
    setTowers({ t1top: handles.L, t1base: [handles.L[0], g], t2top: handles.R, t2base: [handles.R[0], g] })
  }

  useEffect(() => {
    onMeasured(measurement?.values ?? null)
  }, [measurement, onMeasured])

  useEffect(() => () => img && URL.revokeObjectURL(img.url), [img])

  useEffect(() => () => onMeasured(null), [onMeasured])   // leaving image mode clears measurement

  const toImage = (e) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current.getScreenCTM().inverse())
    return [Math.max(0, Math.min(vec.width, pt.x)), Math.max(0, Math.min(vec.height, pt.y))]
  }
  const onMove = (e) => {
    if (!drag) return
    const p = toImage(e)
    if (TOWER_KEYS.includes(drag)) setTowers((t) => ({ ...t, [drag]: p }))
    else setHandles((h) => (drag === 'ground' ? { ...h, ground: p[1] } : { ...h, [drag]: p }))
  }

  const r = vec ? Math.max(6, vec.width / 110) : 6
  const stroke = vec ? Math.max(2, vec.width / 450) : 2

  return (
    <div className="image-input">
      <div className="upload-row">
        <label className="upload">
          <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && load(e.target.files[0], e.target.files[0].name)} />
          Upload span image
        </label>
        {SAMPLES.map((s) => <button key={s.file} className="ghost small" onClick={() => loadSample(s)}>{s.label}</button>)}
      </div>

      {img && (
        <div className="canvas">
          {vec ? (
            <svg ref={svgRef} viewBox={`0 0 ${vec.width} ${vec.height}`} onPointerMove={onMove}
              onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
              <image href={img.url} width={vec.width} height={vec.height} />
              {vec.curves.map((c, i) => (
                <polyline key={i} points={c.points.map((p) => p.join(',')).join(' ')} fill="none"
                  className={i === vec.curves.length - 1 ? 'det main' : 'det'} strokeWidth={stroke * 1.5} />
              ))}
              {handles && (
                <g strokeWidth={stroke}>
                  <line className="chord" x1={handles.L[0]} y1={handles.L[1]} x2={handles.R[0]} y2={handles.R[1]} />
                  <line className="ground" x1={0} x2={vec.width} y1={handles.ground} y2={handles.ground}
                    onPointerDown={() => setDrag('ground')} strokeWidth={stroke * 3} />
                  {['L', 'R', 'low'].map((k) => (
                    <circle key={k} className={`handle ${k}`} cx={handles[k][0]} cy={handles[k][1]} r={r}
                      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(k) }} />
                  ))}
                </g>
              )}
              {towers && (
                <g strokeWidth={stroke} className="towers">
                  <polygon className="tower-quad" points={[towers.t1base, towers.t1top, towers.t2top, towers.t2base].map((p) => p.join(',')).join(' ')} />
                  {TOWER_KEYS.map((k) => (
                    <g key={k}>
                      <rect className="handle tower" x={towers[k][0] - r} y={towers[k][1] - r} width={2 * r} height={2 * r}
                        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(k) }} />
                      <text className="handle-label" x={towers[k][0] + r * 1.4} y={towers[k][1] + r * 0.5} fontSize={r * 1.6}>{TOWER_LABELS[k]}</text>
                    </g>
                  ))}
                </g>
              )}
            </svg>
          ) : <img src={img.url} alt={img.name} />}
        </div>
      )}
      {status && <p className="muted small">{status}</p>}

      {vec && (
        <>
          <p className="legend-row small">
            <span><i className="dot L" />Attach T1</span><span><i className="dot R" />Attach T2</span>
            <span><i className="dot low" />Lowest point</span><span><i className="bar" />Ground (drag)</span>
          </p>
          <div className="grid2">
            <NumberField label="Known span" unit="m" value={cal.span} onChange={(span) => setCal((c) => ({ ...c, span }))} hint="sets horizontal scale" />
            <NumberField label="Known attach height" unit="m" value={cal.height} onChange={(height) => setCal((c) => ({ ...c, height }))}
              hint="optional · use when the image is not to scale" />
          </div>
          {cal.height === '' && <p className="note small calibration-note">Enter attachment height if the drawing isn't to scale.</p>}
          <div className="grid2">
            <NumberField label="Conductor temperature at photo time" unit="°C" value={cal.photo_temp}
              onChange={(photo_temp) => setCal((c) => ({ ...c, photo_temp }))} hint="start point for the temperature curve" />
            <div className="field">
              <span>Perspective correction</span>
              {towers
                ? <button type="button" className="ghost small" onClick={() => setTowers(null)}>Remove tower points</button>
                : <button type="button" className="ghost small" onClick={markTowers} disabled={!handles}>Mark 4 tower points</button>}
              <small>{towers ? (cal.height > 0 ? 'drag squares to tower tops and bases' : 'also needs known attach height') : 'no perspective correction'}</small>
            </div>
          </div>
          {measurement && (
            <table className="mini">
              <tbody>
                <tr><td>Scale</td><td>{(1 / measurement.xScale).toFixed(2)} px/m horiz · {(1 / measurement.yScale).toFixed(2)} px/m vert</td></tr>
                <tr><td>Measured in image</td><td>{measurement.rawSag.toFixed(2)} m</td></tr>
                {measurement.corrected && <tr><td>Corrected sag</td><td><b>{measurement.values.sag.toFixed(2)} m</b> · view angle ≈ {measurement.corrected.angle}°, correction applied</td></tr>}
                {!measurement.corrected && <tr><td>Sag used</td><td><b>{measurement.values.sag.toFixed(2)} m</b></td></tr>}
                <tr><td>Attachment height</td><td>{measurement.values.attach_height.toFixed(2)} m</td></tr>
                {measurement.values.phase_gap && <tr><td>Phase spacing</td><td>{measurement.values.phase_gap.toFixed(2)} m</td></tr>}
              </tbody>
            </table>
          )}
          <CameraInfo camera={vec.camera} />
          <div className="grid2">
            <label className="field"><span>From pole ID</span>
              <input value={assets.from} onChange={(e) => onAssets({ ...assets, from: e.target.value })} placeholder="0008" /></label>
            <label className="field"><span>To pole ID</span>
              <input value={assets.to} onChange={(e) => onAssets({ ...assets, to: e.target.value })} placeholder="0009" /></label>
          </div>
          {cal.height > 0 && measurement && Math.abs(measurement.xScale / measurement.yScale - 1) > 0.2 && (
            <p className="note small">Horizontal and vertical scales differ by {Math.round(Math.abs(measurement.xScale / measurement.yScale - 1) * 100)}% - this image is
              a schematic, not a to-scale photo. Results use the vertical scale for heights and sag.</p>
          )}
        </>
      )}
    </div>
  )
}

export default memo(ImageInput)
