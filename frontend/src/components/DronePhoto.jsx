import { memo, useEffect, useState } from 'react'
import { analyzePhoto } from '../api.js'
import CameraInfo from './CameraInfo.jsx'

const SAMPLES = [
  { file: 'drone1.jpg', label: 'Drone photo 1 (double pole)' },
  { file: 'drone2.jpg', label: 'Drone photo 2 (roadside pole)' },
]
const TONE = { Contact: 'bad', 'Possible encroachment': 'warn', Clear: 'good' }

/** Oblique drone photo -> conductors, poles, attachment points, vegetation, leaf contact. No sag calculation. */
function DronePhoto({ assets, onAssets }) {
  const [img, setImg] = useState(null)
  const [res, setRes] = useState(null)
  const [status, setStatus] = useState('')

  const load = async (file, name) => {
    setImg({ url: URL.createObjectURL(file), name })
    setRes(null); setStatus('Analysing…')
    try {
      setRes(await analyzePhoto(file)); setStatus('')
    } catch (e) {
      setStatus(e.message)
    }
  }
  const loadSample = async (s) => {
    const blob = await (await fetch(`/samples/${s.file}`)).blob()
    load(new File([blob], s.file, { type: blob.type }), s.label)
  }

  useEffect(() => () => img && URL.revokeObjectURL(img.url), [img])

  const stroke = res ? Math.max(3, res.width / 400) : 3
  const counts = res ? Object.fromEntries(Object.keys(TONE).map((k) => [k, res.conductors.filter((c) => c.status === k).length])) : null

  return (
    <div className="image-input drone">
      <div className="upload-row">
        <label className="upload">
          <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && load(e.target.files[0], e.target.files[0].name)} />
          Upload drone photo
        </label>
        {SAMPLES.map((s) => <button key={s.file} className="ghost small" onClick={() => loadSample(s)}>{s.label}</button>)}
      </div>

      {img && (
        <div className="canvas">
          {res ? (
            <svg viewBox={`0 0 ${res.width} ${res.height}`} role="img" aria-label="Drone photo analysis">
              <image href={img.url} width={res.width} height={res.height} />
              {res.poles.map(([x, y, w, h], i) => (
                <g key={i} className="pole-box">
                  <rect x={x} y={y} width={w} height={h} strokeWidth={stroke} />
                  <text x={x + 6} y={y - 8} fontSize={stroke * 7}>Pole</text>
                </g>
              ))}
              {res.conductors.map((c) => (
                <g key={c.id} className={`drone-wire ${TONE[c.status]}`}>
                  <polyline points={c.points.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={stroke * 1.4} />
                  {c.contact_segments.map((s, i) => <line key={i} className="contact" x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} strokeWidth={stroke * 3} />)}
                  <text x={c.points[Math.floor(c.points.length * 0.7)][0] + 8} y={c.points[Math.floor(c.points.length * 0.7)][1] - 10}
                    fontSize={stroke * 7} fontWeight="700">C{c.id}</text>
                </g>
              ))}
              {res.attachment_points.map(([x, y], i) => <circle key={i} className="attach" cx={x} cy={y} r={stroke * 2.5} strokeWidth={stroke} />)}
            </svg>
          ) : <img src={img.url} alt={img.name} />}
        </div>
      )}
      {status && <p className="muted small">{status}</p>}

      {res && (
        <>
          <div className="mini-kpis">
            <div><b>{res.conductors.length}</b><span>conductors</span></div>
            <div><b>{res.poles.length}</b><span>poles</span></div>
            <div><b>{res.attachment_points.length}</b><span>attachments</span></div>
            <div><b>{res.vegetation_pct}%</b><span>vegetation</span></div>
          </div>
          <p className="legend-row small">
            {Object.entries(TONE).map(([k, t]) => <span key={k}><i className={`swatch ${t}`} />{k}: {counts[k]}</span>)}
          </p>
          <table className="mini">
            <thead><tr><th>ID</th><th>Status</th><th>Vegetation around wire</th><th>Leaf contact</th></tr></thead>
            <tbody>
              {res.conductors.map((c) => (
                <tr key={c.id} className={TONE[c.status]}>
                  <td>C{c.id}</td><td>{c.status}</td><td>{c.corridor_vegetation_pct}%</td><td>{c.contact_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Single photo has no depth: encroachment needs on-site or 3-D verification.</p>
          <CameraInfo camera={res.camera} />
          <div className="grid2">
            <label className="field"><span>From pole ID</span>
              <input value={assets.from} onChange={(e) => onAssets({ ...assets, from: e.target.value })} placeholder="0008" /></label>
            <label className="field"><span>To pole ID</span>
              <input value={assets.to} onChange={(e) => onAssets({ ...assets, to: e.target.value })} placeholder="0009" /></label>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(DronePhoto)
