import { memo } from 'react'

const W = 860, H = 340, PAD = { l: 44, r: 76, t: 24, b: 34 }
const PHASE_CLASS = { 'A-B': 'ph-b', 'A-R': 'ph-r', 'A-Y': 'ph-y' }
const PHASE_LABEL = { 'A-B': 'B', 'A-R': 'R', 'A-Y': 'Y' }
const TONE_CLASS = { Pass: 'good', Warning: 'warn', Fail: 'bad' }

/** Side elevation of the span. Vertical scale is exaggerated so sag stays visible. */
function SpanProfile({ span, profiles, groundReq, groundStatus, treeIn, treeOut, treeStatus, sag }) {
  const top = Math.max(...profiles.flatMap((p) => p.points.map((q) => q.y))) + 3
  const sx = (x) => PAD.l + (x / span) * (W - PAD.l - PAD.r)
  const sy = (y) => H - PAD.b - (y / top) * (H - PAD.t - PAD.b)
  const lowest = profiles.find((p) => p.id === 'A-Y')
  const mid = lowest.points[Math.floor(lowest.points.length / 2)]
  const attachY = lowest.points[0].y
  const towerTop = top - 1

  const tower = (x) => {
    const half = 10
    return (
      <g className="tower">
        <path d={`M${x - half * 1.8},${sy(0)} L${x - half * 0.5},${sy(towerTop)} L${x + half * 0.5},${sy(towerTop)} L${x + half * 1.8},${sy(0)}`} />
        {profiles.map((p) => <line key={p.id} x1={x - 26} x2={x + 26} y1={sy(p.points[0].y)} y2={sy(p.points[0].y)} />)}
      </g>
    )
  }

  return (
    <figure className="chart profile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Span side elevation">
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
          </pattern>
        </defs>
        <rect className="danger-zone" x={PAD.l} width={W - PAD.l - PAD.r} y={sy(groundReq)} height={sy(0) - sy(groundReq)} fill="url(#hatch)" />
        <line className={`req-line ${TONE_CLASS[groundStatus]}`} x1={PAD.l} x2={W - PAD.r} y1={sy(groundReq)} y2={sy(groundReq)} />
        <text className={`lbl ${TONE_CLASS[groundStatus]}`} x={W - PAD.r - 4} y={sy(groundReq) - 5} textAnchor="end">Minimum safe height</text>
        <rect className="earth" x={0} y={sy(0)} width={W} height={PAD.b} />

        {tower(sx(0))}
        {tower(sx(span))}

        <line className="chord" x1={sx(0)} x2={sx(span)} y1={sy(attachY)} y2={sy(attachY)} />
        {profiles.map((p) => (
          <g key={p.id}>
            <polyline className={`conductor ${PHASE_CLASS[p.id]}`} points={p.points.map((q) => `${sx(q.x)},${sy(q.y)}`).join(' ')} />
            <text className={`phase-label ${PHASE_CLASS[p.id]}`} x={W - PAD.r + 7} y={sy(p.points[p.points.length - 1].y) + 4}>{PHASE_LABEL[p.id]}</text>
          </g>
        ))}

        <line className="dim" x1={sx(mid.x)} x2={sx(mid.x)} y1={sy(attachY)} y2={sy(mid.y)} />
        <text className="lbl" x={sx(mid.x) + 6} y={(sy(attachY) + sy(mid.y)) / 2 + 4}>Sag {sag.toFixed(2)} m</text>
        <line className="dim clear" x1={sx(mid.x) - 40} x2={sx(mid.x) - 40} y1={sy(0)} y2={sy(mid.y)} />
        <text className="lbl" x={sx(mid.x) - 46} y={(sy(0) + sy(mid.y)) / 2} textAnchor="end">Clearance {mid.y.toFixed(2)} m</text>

        {treeIn && treeOut && (
          <g className={`tree ${TONE_CLASS[treeStatus]}`}>
            <line className="trunk" x1={sx(treeIn.x)} x2={sx(treeIn.x)} y1={sy(0)} y2={sy(treeIn.height - treeIn.canopy_radius)} />
            <ellipse className="canopy" cx={sx(treeIn.x)} cy={sy(treeIn.height - treeIn.canopy_radius)}
              rx={(treeIn.canopy_radius / span) * (W - PAD.l - PAD.r)} ry={sy(0) - sy(treeIn.canopy_radius)} />
            <line className={`dim tree-gap ${TONE_CLASS[treeStatus]}`} x1={sx(treeIn.x) + 14} x2={sx(treeIn.x) + 14} y1={sy(treeIn.height)} y2={sy(treeOut.conductor_z)} />
            <text className="lbl" x={sx(treeIn.x) + 20} y={sy((treeIn.height + treeOut.conductor_z) / 2) + 4}>
              {treeOut.distance.toFixed(2)} m to canopy
            </text>
          </g>
        )}
        <text className="lbl muted" x={PAD.l} y={14}>T1</text>
        <text className="lbl muted" x={W - PAD.r} y={14} textAnchor="end">T2 · span {span.toFixed(2)} m</text>
      </svg>
      <figcaption className="profile-legend">
        <span><i className="swatch ph-b" />B phase</span><span><i className="swatch ph-r" />R phase</span>
        <span><i className="swatch ph-y" />Y phase</span><span><i className="swatch safe-line" />Minimum safe height</span>
      </figcaption>
      <p className="muted small profile-note">Side view; vertical scale is enlarged. Tree distance includes its offset from the line.</p>
    </figure>
  )
}

export default memo(SpanProfile)
