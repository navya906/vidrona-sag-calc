import { memo } from 'react'
import LineChart from './LineChart.jsx'
import SpanProfile from './SpanProfile.jsx'

const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d))

function Kpi({ label, value, unit, sub, tone }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}<small>{unit}</small></span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

const RATIO_TONE = { OK: 'good', Warning: 'warn', Critical: 'bad' }
const tone = (a) => (a?.passed == null ? '' : a.severity >= 4 ? 'bad' : a.severity === 3 ? 'warn' : 'good')

function Results({ result, voltage, tree: treeIn, span, sources }) {
  const { mechanics: m, ground: g, tree: t, ratios } = result
  const condition = m.assess_at === 'max_temp' ? 'at max conductor temp' : 'as observed / stringing'
  const critical = t && (t.severity ?? 0) > (g.severity ?? 0) ? t : g
  const ry = ratios.find((x) => x.arm === 'A' && x.pair === 'RY')
  const worst = ratios.reduce((a, b) => (b.deviation_pct > a.deviation_pct ? b : a))

  return (
    <div className="results-inner">
      <div className="kpis">
        <Kpi label={`Sag ${condition}`} value={fmt(m.sag_assessed)} unit="m"
          sub={`stringing ${fmt(m.sag_ref)} m · max temp ${fmt(m.sag_max_temp)} m`} />
        <Kpi label="Ground clearance" value={fmt(g.actual)} unit="m" tone={tone(g)}
          sub={`required ${g.required.value} m · ${g.passed ? 'PASS' : 'FAIL'} · margin ${fmt(g.margin)} m`} />
        <Kpi label="Tree / canopy" value={t ? fmt(t.distance) : '-'} unit={t ? 'm' : ''} tone={tone(t)}
          sub={t ? `required ${t.required.value ?? 'n/a'} m · ${t.years_to_violation != null ? `breach in ~${t.years_to_violation} yr` : t.passed ? 'no breach within 50 yr' : 'IN VIOLATION'}` : 'not assessed'} />
        <Kpi label="Severity (Vidrona scale)" value={`${critical.severity}/5`} tone={tone(critical)}
          sub={`${critical.label} · driven by ${critical === g ? 'ground' : 'vegetation'}`} />
        <Kpi label="Tension" value={fmt(m.tension_ref_kN, 1)} unit="kN" sub={`FoS ${fmt(m.factor_of_safety)} · ${fmt(m.tension_max_temp_kN, 1)} kN at max temp`} />
        <Kpi label="R-Y phase ratio (Arm A)" value={fmt(ry.ratio)} tone={RATIO_TONE[ry.status]}
          sub={`${fmt(ry.midspan_gap)} m mid-span vs ${fmt(ry.tower_gap)} m at tower · worst: ${worst.pair} (Arm ${worst.arm}) ${fmt(worst.ratio)}`} />
      </div>

      <section className="card">
        <h2>Span profile</h2>
        <SpanProfile span={span} profiles={result.phase_profiles} groundReq={g.required.value} treeIn={treeIn} treeOut={t} sag={m.sag_assessed} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Phase ratios <small>mid-span distance ÷ tower distance · BRY</small></h2>
          <div className="ratio-grid">
            {['A', 'B'].map((arm) => (
              <div key={arm}>
                {ratios.filter((r) => r.arm === arm).map((r) => (
                  <div key={r.pair} className={`ratio ${r.status.toLowerCase()}`}>
                    <span>ARM {arm} - {r.pair}</span><b>{fmt(r.ratio)}</b>
                    <small>{fmt(r.tower_gap)} → {fmt(r.midspan_gap)} m · {r.deviation_pct}% off · sag ratio {fmt(r.sag_ratio)}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted small">1.00 = healthy: phases keep their tower spacing at mid-span. Below 1 = phases closing in (clash / flashover risk);
            above 1 = spreading apart. Warning at ±10%, critical at ±25% (demo thresholds).</p>
        </section>

        <section className="card">
          <h2>Mechanics</h2>
          <table className="mini">
            <tbody>
              <tr><td>Conductor weight</td><td>{fmt(m.weight_N_m, 3)} N/m</td></tr>
              <tr><td>Sag formula (parabolic)</td><td>S = wL²/8T = {fmt(m.sag_max_temp, 3)} m</td></tr>
              <tr><td>Catenary (exact)</td><td>{fmt(m.sag_max_temp_catenary, 3)} m ({fmt(m.catenary_diff_pct)}% diff)</td></tr>
              <tr><td>Wind blow-out</td><td>{fmt(m.blowout_deg, 1)}° · swing {fmt(m.swing_mid)} m</td></tr>
              <tr><td>Lowest point</td><td>{fmt(m.lowest_point)} m above ground</td></tr>
              <tr><td>Right-of-way width</td><td>{result.row_width ? `${result.row_width} m` : 'not tabulated'}</td></tr>
              {t && <tr><td>Max safe tree height below line</td><td>{fmt(t.max_safe_height_below)} m</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <h2>Sag vs conductor temperature</h2>
          <LineChart xLabel="Conductor temperature (°C)" yLabel="Sag (m)" yMin={0}
            series={[{ name: 'Sag', className: 's1', points: result.temperature_sweep.map((p) => ({ x: p.temp, y: p.sag })) }]}
            markers={[{ x: 75, label: 'typical ACSR max' }]} />
        </section>
        <section className="card">
          <h2>Required clearances <small>CEA ground · MoEF trees</small></h2>
          <table className="mini compare">
            <thead><tr><th>Voltage</th><th>Ground</th><th>Trees</th></tr></thead>
            <tbody>
              {result.clearance_by_voltage.map((row) => (
                <tr key={row.kv} className={row.kv === voltage ? 'current' : ''}>
                  <td>{row.kv} kV</td><td>{row.ground} m</td><td>{row.tree} m</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Ground values are for the selected line location: {g.required.rule}.</p>
        </section>
      </div>

      <section className="card notes">
        <h2>Notes &amp; sources</h2>
        <ul>
          {result.notes.map((n) => <li key={n}>{n}</li>)}
          <li><b>Ground:</b> {g.required.rule}. {g.required.source}</li>
          {t && <li><b>Trees:</b> {t.required.rule}. {t.required.source}</li>}
          {sources && <li><b>Sag:</b> {sources.sag} {sources.temp}</li>}
          {sources && <li><b>Phase ratio:</b> {sources.ratio}</li>}
          {sources && <li><b>Assumptions:</b> {sources.assumption}</li>}
        </ul>
      </section>
    </div>
  )
}

export default memo(Results)
