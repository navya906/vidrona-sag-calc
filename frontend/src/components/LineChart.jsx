import { memo } from 'react'

const W = 520, H = 240, PAD = { l: 48, r: 16, t: 14, b: 38 }

function ticks(min, max, n = 5) {
  const step = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= step)
  const out = []
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) out.push(+v.toFixed(6))
  return out
}

/** series: [{ name, points: [{x, y}], className }], markers: [{ x, label }] */
function LineChart({ series, markers = [], xLabel, yLabel, yMin }) {
  const all = series.flatMap((s) => s.points)
  const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x))
  const ys = all.map((p) => p.y)
  const y0 = yMin ?? Math.min(...ys), y1 = Math.max(...ys) * 1.08 || 1
  const sx = (x) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r)
  const sy = (y) => H - PAD.b - ((y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b)
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join('')

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} vs ${xLabel}`}>
        {ticks(y0, y1).map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} />
            <text className="tick" x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {ticks(x0, x1, 6).map((t) => <text key={t} className="tick" x={sx(t)} y={H - PAD.b + 16} textAnchor="middle">{t}</text>)}
        <text className="axis" x={(W + PAD.l) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
        <text className="axis" transform={`translate(12 ${(H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        {markers.map((m) => (
          <g key={m.label}>
            <line className="marker" x1={sx(m.x)} x2={sx(m.x)} y1={PAD.t} y2={H - PAD.b} />
            <text className="marker-label" x={sx(m.x) + (sx(m.x) > W * 0.7 ? -4 : 4)} y={PAD.t + 10}
              textAnchor={sx(m.x) > W * 0.7 ? 'end' : 'start'}>{m.label}</text>
          </g>
        ))}
        {series.map((s) => <path key={s.name} className={`series ${s.className}`} d={path(s.points)} />)}
      </svg>
      <figcaption>{series.map((s) => <span key={s.name}><i className={`swatch ${s.className}`} />{s.name}</span>)}</figcaption>
    </figure>
  )
}

export default memo(LineChart)
