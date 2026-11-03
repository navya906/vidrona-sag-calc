import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { vectorize } from '../api.js'
import { NumberField } from './InputForm.jsx'

const SAMPLES = [
  { file: 'sag_diagram_132kv.jpeg', label: 'Sag diagram (250 m span)', span: 250, height: 20 },
  { file: 'sag_clearance_infographic.jpeg', label: 'Clearance infographic', span: 250, height: 20 },
]
const PHASES_TOP_DOWN = { 1: ['A-Y'], 2: ['A-R', 'A-Y'], 3: ['A-B', 'A-R', 'A-Y'] }

const sagPx = ({ L, R, low }) => low[1] - (L[1] + ((R[1] - L[1]) * (low[0] - L[0])) / (R[0] - L[0] || 1))

function measure(vec, h, cal) {
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
  const out = { span: +cal.span.toFixed(2), attach_height: +(heightPx * yScale).toFixed(2), sag: +sag.toFixed(3), phase_sags }
  if (tops.length > 1) out.phase_gap = +(((tops.at(-1) - tops[0]) / (tops.length - 1)) * yScale).toFixed(2)
  return { values: out, xScale, yScale }
}

function ImageInput({ onMeasured }) {
  const svgRef = useRef(null)
  const [img, setImg] = useState(null)          // { url, name }
  const [vec, setVec] = useState(null)
  const [handles, setHandles] = useState(null)  // { L, R, low, ground }
  const [cal, setCal] = useState({ span: 250, height: '' })
  const [drag, setDrag] = useState(null)
  const [status, setStatus] = useState('')

  const load = async (file, name, preset) => {
    const url = URL.createObjectURL(file)
    setImg({ url, name })
    setVec(null); setHandles(null); setStatus('Vectorising…')
    if (preset) setCal({ span: preset.span, height: preset.height })
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
    load(new File([blob], s.file, { type: blob.type }), s.label, s)
  }

  const measurement = useMemo(() => measure(vec, handles, cal), [vec, handles, cal])

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
    setHandles((h) => (drag === 'ground' ? { ...h, ground: p[1] } : { ...h, [drag]: p }))
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
          {measurement && (
            <table className="mini">
              <tbody>
                <tr><td>Scale</td><td>{(1 / measurement.xScale).toFixed(2)} px/m horiz · {(1 / measurement.yScale).toFixed(2)} px/m vert</td></tr>
                <tr><td>Measured sag</td><td><b>{measurement.values.sag.toFixed(2)} m</b></td></tr>
                <tr><td>Attachment height</td><td>{measurement.values.attach_height.toFixed(2)} m</td></tr>
                {measurement.values.phase_gap && <tr><td>Phase spacing</td><td>{measurement.values.phase_gap.toFixed(2)} m</td></tr>}
              </tbody>
            </table>
          )}
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
