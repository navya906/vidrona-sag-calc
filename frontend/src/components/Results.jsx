import { memo } from 'react'
import LineChart from './LineChart.jsx'
import SpanProfile from './SpanProfile.jsx'

const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d))

function Info({ text }) {
  return <span className="info-tip" title={text} aria-label={text}>ⓘ</span>
}

const statusLabel = (passed, status) => {
  if (passed === false || status === 'Critical') return 'Fail'
  if (status === 'Warning') return 'Warning'
  return 'Pass'
}
const statusTone = (status) => ({ Pass: 'good', Warning: 'warn', Fail: 'bad' })[status]

function Kpi({ label, value, unit, requirement, status }) {
  return (
    <div className={`kpi ${statusTone(status)}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}<small>{unit}</small></span>
      <span className="kpi-sub">Needs {requirement}</span>
      <span className={`status-word ${statusTone(status)}`}>{status}</span>
    </div>
  )
}

function Results({ result, voltage, tree: treeIn, span, sources, showArmB = true }) {
  const { mechanics: m, ground: g, tree: t, ratios } = result
  const displayedRatios = ratios.filter((r) => showArmB || r.arm === 'A')
  const worst = displayedRatios.reduce((a, b) => (b.deviation_pct > a.deviation_pct ? b : a))
  const groundStatus = statusLabel(g.passed)
  const treeStatus = t ? statusLabel(t.passed) : null
  const phaseStatus = statusLabel(null, worst.status)
  const overallStatus = [groundStatus, treeStatus, phaseStatus].includes('Fail')
    ? 'Fail' : [groundStatus, treeStatus, phaseStatus].includes('Warning') ? 'Warning' : 'Pass'
  const groundText = `${groundStatus === 'Pass' ? 'ground clearance' : 'ground clearance too low'} ${fmt(g.actual)} m (needs ${fmt(g.required.value)} m)`
  const treeText = t
    ? `${treeStatus === 'Pass' ? 'tree clearance' : 'tree too close'} ${fmt(t.distance)} m (needs ${fmt(t.required.value)} m)`
    : null
  const phaseText = phaseStatus === 'Pass'
    ? `phases balanced (ratio ${fmt(worst.ratio)})`
    : `phase spacing ${phaseStatus === 'Fail' ? 'out of balance' : 'needs review'} (ratio ${fmt(worst.ratio)})`
  const summaryText = [groundText, treeText, phaseText].filter(Boolean).join(', ')

  return (
    <div className="results-inner">
      <div className={`summary-banner ${statusTone(overallStatus)}`} role="status">
        <strong>{overallStatus === 'Pass' ? 'Safe' : overallStatus === 'Fail' ? 'Action needed' : 'Review needed'}</strong>
        <span>{summaryText}.</span>
      </div>

      <div className="kpis">
        <Kpi label="Ground clearance" value={fmt(g.actual)} unit="m" requirement={`${fmt(g.required.value)} m`} status={groundStatus} />
        {t && <Kpi label="Tree clearance" value={fmt(t.distance)} unit="m" requirement={`${fmt(t.required.value)} m`} status={treeStatus} />}
        <Kpi label={<>Phase ratio <Info text="The mid-span phase spacing divided by the spacing at the tower; 1.00 means spacing is unchanged." /></>}
          value={fmt(worst.ratio)} requirement="1.00 ± 10%" status={phaseStatus} />
      </div>

      <section className="card">
        <h2>Span profile <Info text="Sag is how far the conductor dips below a straight line between its supports." /></h2>
        <SpanProfile span={span} profiles={result.phase_profiles} groundReq={g.required.value} groundStatus={groundStatus}
          treeIn={treeIn} treeOut={t} treeStatus={treeStatus} sag={m.sag_assessed} />
      </section>

      <section className="card">
        <h2>Phase ratios <small>mid-span spacing ÷ tower spacing · B-R-Y</small> <Info text="A phase ratio compares conductor spacing at mid-span with spacing at the tower; 1.00 means no change." /></h2>
        <div className="ratio-grid">
          {(showArmB ? ['A', 'B'] : ['A']).map((arm) => (
            <div key={arm}>
              {displayedRatios.filter((r) => r.arm === arm).map((r) => {
                const status = statusLabel(null, r.status)
                return (
                  <div key={r.pair} className={`ratio ${statusTone(status)}`}>
                    <span>ARM {arm} - {r.pair}</span><b>{fmt(r.ratio)}</b>
                    <small>{fmt(r.tower_gap)} m at tower → {fmt(r.midspan_gap)} m mid-span · target 1.00 ± 10% · {status}</small>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Sag vs conductor temperature <Info text="Sag is how far the conductor dips below a straight line between its supports." /></h2>
          <LineChart xLabel="Conductor temperature (°C)" yLabel="Sag (m)" yMin={0}
            series={[{ name: 'Sag', className: 's1', points: result.temperature_sweep.map((p) => ({ x: p.temp, y: p.sag })) }]}
            markers={[{ x: 75, label: 'typical ACSR max' }]} />
        </section>
        <section className="card">
          <h2>Required clearances <Info text="Clearance is the shortest distance between the conductor and the ground or nearby tree." /></h2>
          <table className="mini compare">
            <thead><tr><th>Voltage</th><th>Ground</th><th>Trees</th></tr></thead>
            <tbody>
              {result.clearance_by_voltage.map((row) => (
                <tr key={row.kv} className={row.kv === voltage ? 'current' : ''}>
                  <td>{fmt(row.kv)} kV</td><td>{fmt(row.ground)} m</td><td>{fmt(row.tree)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Ground values are for the selected line location: {g.required.rule}.</p>
        </section>
      </div>

      <details className="card notes">
        <summary>Notes &amp; sources</summary>
        <div className="notes-content">
          <ul>
            {result.notes.map((n) => <li key={n}>{n}</li>)}
            <li><b>Ground:</b> {g.required.rule}. {g.required.source}</li>
            {t && <li><b>Trees:</b> {t.required.rule}. {t.required.source}</li>}
            {sources && <li><b>Sag:</b> {sources.sag} {sources.temp}</li>}
            {sources && <li><b>Phase ratio:</b> {sources.ratio}</li>}
            {sources && <li><b>Assumptions:</b> {sources.assumption}</li>}
          </ul>
          <h3>Technical details</h3>
          <table className="mini">
            <tbody>
              <tr><td>Conductor weight</td><td>{fmt(m.weight_N_m)} N/m</td></tr>
              <tr><td>Sag formula (parabolic)</td><td>{fmt(m.sag_max_temp)} m</td></tr>
              <tr><td>Catenary <Info text="A catenary is the exact curve formed by a freely hanging flexible cable." /></td><td>{fmt(m.sag_max_temp_catenary)} m ({fmt(m.catenary_diff_pct)}% difference)</td></tr>
              <tr><td>Wind blow-out <Info text="Blow-out is the sideways movement of a conductor caused by wind." /></td><td>{fmt(m.blowout_deg)}° · swing {fmt(m.swing_mid)} m</td></tr>
              <tr><td>Lowest point</td><td>{fmt(m.lowest_point)} m above ground</td></tr>
              <tr><td>Right-of-way width</td><td>{result.row_width ? `${fmt(result.row_width)} m` : 'not tabulated'}</td></tr>
              {t && <tr><td>Maximum safe tree height below line</td><td>{fmt(t.max_safe_height_below)} m</td></tr>}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

export default memo(Results)
