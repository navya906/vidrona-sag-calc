"""
Sag, clearance, phase-ratio and vegetation calculations.
Units: metres, newtons, deg C. Every regulatory value carries its source.
"""
from __future__ import annotations

import math

import numpy as np

from schemas import CalcRequest, Conductor, Requirement

G = 9.80665

# Panther / Zebra / Moose: weight, diameter, UTS, area from TGTRANSCO ACSR spec; alpha from
# published technical particulars. E and the Dog / AAAC rows are typical -> verified=False.
CONDUCTORS: dict[str, Conductor] = {
    "ACSR Dog": Conductor(diameter_mm=14.15, weight_kg_km=394.0, uts_kN=32.41, area_mm2=118.5, E_GPa=77.0, alpha=19.0e-6),
    "ACSR Panther": Conductor(diameter_mm=21.00, weight_kg_km=974.0, uts_kN=89.67, area_mm2=261.5, E_GPa=80.0, alpha=17.8e-6, verified=True),
    "ACSR Zebra": Conductor(diameter_mm=28.62, weight_kg_km=1621.0, uts_kN=130.32, area_mm2=484.5, E_GPa=69.0, alpha=19.3e-6, verified=True),
    "ACSR Moose": Conductor(diameter_mm=31.77, weight_kg_km=1998.0, uts_kN=159.60, area_mm2=597.0, E_GPa=69.0, alpha=19.35e-6, verified=True),
    "AAAC Zebra": Conductor(diameter_mm=28.00, weight_kg_km=1280.5, uts_kN=136.38, area_mm2=465.0, E_GPa=55.0, alpha=23.0e-6),
}

# Voltages in scope for this assignment. 220 kV geometry follows the assignment image;
# 11 / 33 kV values are illustrative starting points to be overwritten.
PRESETS: dict[int, dict[str, float | str]] = {
    11: dict(span=60, attach_height=9, conductor="ACSR Dog", phase_gap=1.0),
    33: dict(span=120, attach_height=11, conductor="ACSR Dog", phase_gap=1.5),
    220: dict(span=350, attach_height=30, conductor="ACSR Zebra", phase_gap=5.5),
}
VOLTAGES = list(PRESETS)

TREE_CLEARANCE = {11: 2.6, 33: 2.8, 220: 4.6}   # MoEF guideline table (published by CEA)
ROW_WIDTH = {11: 7, 33: 15, 220: 35}            # MoEF / CEA right-of-way table

# CEA Regulation 58 - clearance above ground of the lowest conductor (metres)
GROUND_STREET = {"across_street": 6.1, "along_street": 5.8}   # > 650 V up to 33 kV

SOURCES = {
    "ground": "CEA (Measures relating to Safety & Electric Supply) Regulations, Reg. 58: across street 6.1 m, "
              "along street 5.8 m (up to 33 kV); elsewhere 4.6 m bare / 4.0 m insulated up to 11 kV, 5.2 m up to 33 kV; "
              "above 33 kV 5.2 m + 0.3 m per 33 kV or part (6.1 m minimum on streets).",
    "tree": "MoEF guidelines for transmission lines through forest land (published on cea.nic.in).",
    "sag": "S = wL²/8T (level span, parabolic). Catenary shown for comparison.",
    "temp": "Parabolic state-change equation for tension at another temperature.",
    "ratio": "Phase ratio = mid-span distance ÷ tower distance for each pair (B-R, R-Y, B-Y). 1.00 = healthy.",
    "assumption": "Ratio tolerance bands, severity bands and E-modulus values are demo assumptions.",
}

LOCATION_LABEL = {"elsewhere": "open ground", "along_street": "along a street", "across_street": "across a street"}

ARMS = ("A", "B")
PHASE_LEVELS = (("B", 2), ("R", 1), ("Y", 0))   # BRY: B top, R middle, Y bottom
PAIRS = (("B", "R"), ("R", "Y"), ("B", "Y"))
SEVERITY_BANDS = ((1.5, 1, "Healthy"), (1.25, 2, "Monitor"), (1.1, 3, "Plan maintenance"),
                  (1.0, 4, "Urgent - near limit"))


def _table_up(table: dict[int, float], kv: float) -> tuple[float | None, int | None]:
    """Value at the smallest tabulated voltage >= kv (conservative)."""
    level = next((v for v in sorted(table) if kv <= v), None)
    return (table[level], level) if level else (None, None)


def ground_clearance(kv: float, location: str = "elsewhere", insulated: bool = False) -> Requirement:
    where = LOCATION_LABEL[location]
    if kv <= 33:
        if location in GROUND_STREET:
            value = GROUND_STREET[location]
        elif kv <= 11:
            value = 4.0 if insulated else 4.6
            where += ", insulated" if insulated else ", bare"
        else:
            value = 5.2
        return Requirement(value=value, rule=f"{kv:g} kV, {where}", source=SOURCES["ground"], verified=True)
    steps = math.ceil((kv - 33) / 33 - 1e-9)
    value = round(5.2 + 0.3 * steps, 2)
    if location in GROUND_STREET:
        value = max(value, 6.1)
    return Requirement(value=value, rule=f"5.2 + 0.3 × {steps}, {where}", source=SOURCES["ground"], verified=True)


def tree_clearance(kv: float) -> Requirement:
    val, level = _table_up(TREE_CLEARANCE, kv)
    if val is None:
        return Requirement(value=None, rule="Not tabulated - enter an override", source=SOURCES["tree"])
    return Requirement(value=val, rule=f"Table value at {level} kV", source=SOURCES["tree"], verified=True)


def severity(ratio: float | None) -> tuple[int | None, str]:
    if ratio is None:
        return None, "N/A"
    return next(((s, lbl) for lim, s, lbl in SEVERITY_BANDS if ratio >= lim), (5, "Violation - act now"))


def sag_parabolic(w: float, L: float, T: float) -> float:
    return w * L * L / (8 * T)


def sag_catenary(w: float, L: float, T: float) -> float:
    return T / w * (math.cosh(w * L / (2 * T)) - 1)


def state_change_tension(T1: float, dt: float, w: float, L: float, EA: float, alpha: float) -> float:
    """Solve T2³ + K·T2² − M = 0 for the tension after a temperature change dt."""
    M = w * w * L * L * EA / 24
    K = -T1 + M / (T1 * T1) + alpha * EA * dt
    roots = np.roots((1.0, K, 0.0, -M))
    return float(max(r.real for r in roots if abs(r.imag) < 1e-6 and r.real > 0))


def profile(L: float, H: float, S: float, n: int = 41) -> list[dict[str, float]]:
    return [{"x": round(x, 2), "y": round(H - 4 * S * x * (L - x) / (L * L), 3)}
            for x in (L * i / (n - 1) for i in range(n))]


def calculate(r: CalcRequest) -> dict:
    cond = r.custom_conductor or CONDUCTORS.get(r.conductor)
    if cond is None:
        raise KeyError(f"Unknown conductor '{r.conductor}'")
    kv, L, H = r.voltage_kv, r.span, r.attach_height
    w = cond.weight_kg_km * G / 1000
    uts = cond.uts_kN * 1000
    EA = cond.E_GPa * 1e9 * cond.area_mm2 * 1e-6
    notes: list[str] = []

    # Reference condition: measured sag (image) or tension from FoS / direct input
    if r.measured:
        S_ref = r.measured.sag
        T_ref = w * L * L / (8 * S_ref)
        notes.append(f"Sag measured from image → implied tension {T_ref / 1000:.1f} kN ({100 * T_ref / uts:.1f}% of UTS).")
    else:
        T_ref = r.tension_kN * 1000 if r.tension_kN else uts / r.factor_of_safety
        S_ref = sag_parabolic(w, L, T_ref)

    def sag_at(t: float) -> tuple[float, float]:
        T = state_change_tension(T_ref, t - r.ref_temp, w, L, EA, cond.alpha)
        return T, sag_parabolic(w, L, T)

    sweep = [{"temp": t, "tension_kN": round(T / 1000, 2), "sag": round(S, 3)}
             for t in range(0, 91, 5) for T, S in (sag_at(t),)]
    T_max, S_max = sag_at(r.max_temp)

    theta = math.atan2(r.wind_pressure * cond.diameter_mm / 1000, w)   # blow-out angle
    assess_at = r.assess_at or ("reference" if r.measured else "max_temp")
    S_base = S_ref if assess_at == "reference" else S_max
    S_v, swing = S_base * math.cos(theta), S_base * math.sin(theta)
    if theta:
        notes.append(f"Wind {r.wind_pressure:.0f} Pa swings the conductor {math.degrees(theta):.1f}° from vertical.")

    measured_sags = r.measured.phase_sags if r.measured else {}
    phases = []
    for arm in ARMS:
        for name, k in PHASE_LEVELS:
            pid = f"{arm}-{name}"
            s = measured_sags.get(pid, S_v * (1 + r.phase_sag_dev.get(pid, 0) / 100))
            h = H + k * r.phase_gap
            phases.append({"id": pid, "arm": arm, "phase": name, "attach": h, "sag": round(s, 3), "lowest": round(h - s, 3)})
    by_id = {p["id"]: p for p in phases}

    ratios = []
    for arm in ARMS:
        for a, b in PAIRS:
            pa, pb = by_id[f"{arm}-{a}"], by_id[f"{arm}-{b}"]
            tower_gap = abs(pa["attach"] - pb["attach"])
            mid_gap = abs(pa["lowest"] - pb["lowest"])
            ratio = mid_gap / tower_gap
            deviation = abs(ratio - 1)
            status = "Critical" if deviation >= r.ratio_crit else "Warning" if deviation >= r.ratio_warn else "OK"
            ratios.append({"arm": arm, "pair": a + b, "tower_gap": round(tower_gap, 3),
                           "midspan_gap": round(mid_gap, 3), "ratio": round(ratio, 3),
                           "deviation_pct": round(100 * deviation, 1),
                           "sag_ratio": round(pa["sag"] / pb["sag"], 3), "status": status})

    lowest = min(p["lowest"] for p in phases)

    g_req = (Requirement(value=r.ground_clearance_override, rule="User override", source="User")
             if r.ground_clearance_override else ground_clearance(kv, r.location, r.insulated))
    g_ratio = lowest / g_req.value
    sev, label = severity(g_ratio)
    ground = {"required": g_req, "actual": lowest, "margin": round(lowest - g_req.value, 3),
              "ratio": round(g_ratio, 3), "passed": lowest >= g_req.value, "severity": sev, "label": label}

    tree = _tree(r, kv, L, H, S_v, swing) if r.tree else None
    cat = sag_catenary(w, L, T_max)

    return {
        "mechanics": {
            "weight_N_m": round(w, 3), "tension_ref_kN": round(T_ref / 1000, 2),
            "tension_max_temp_kN": round(T_max / 1000, 2), "factor_of_safety": round(uts / T_ref, 2),
            "sag_ref": round(S_ref, 3), "sag_max_temp": round(S_max, 3),
            "sag_max_temp_catenary": round(cat, 3),
            "catenary_diff_pct": round(100 * (cat - S_max) / S_max, 2),
            "blowout_deg": round(math.degrees(theta), 2), "swing_mid": round(swing, 3),
            "sag_assessed": round(S_v, 3), "assess_at": assess_at, "lowest_point": lowest,
        },
        "ground": ground, "tree": tree, "phases": phases, "ratios": ratios,
        "temperature_sweep": sweep,
        "phase_profiles": [{"id": p["id"], "points": profile(L, p["attach"], p["sag"])} for p in phases if p["arm"] == "A"],
        "clearance_by_voltage": [{"kv": v, "ground": ground_clearance(v, r.location, r.insulated).value,
                                  "tree": TREE_CLEARANCE[v]} for v in VOLTAGES],
        "row_width": _table_up(ROW_WIDTH, kv)[0],
        "notes": notes,
    }


def _tree(r: CalcRequest, kv: float, L: float, H: float, S_v: float, swing: float) -> dict:
    t = r.tree
    req = (Requirement(value=t.clearance_override, rule="User override", source="User")
           if t.clearance_override else tree_clearance(kv))
    x = min(t.x, L)
    frac = 4 * x * (L - x) / (L * L)
    cz, cx = H - S_v * frac, r.phase_offset + swing * frac   # lowest phase at the tree, swung towards it

    def gap(years: float) -> float:
        h, rad = t.height + t.growth_rate * years, t.canopy_radius + t.growth_rate * years / 2
        dx = max(0.0, t.offset - rad - cx, cx - (t.offset + rad))
        return math.hypot(dx, max(0.0, cz - h))

    d = gap(0)
    years = None
    if req.value is not None and t.growth_rate > 0 and d >= req.value and gap(50) < req.value:
        lo, hi = 0.0, 50.0                          # gap() shrinks monotonically with years -> bisection
        for _ in range(30):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if gap(mid) >= req.value else (lo, mid)
        years = round(lo, 1)
    sev, label = severity(d / req.value if req.value else None)
    return {"required": req, "distance": round(d, 3), "conductor_x": round(cx, 3), "conductor_z": round(cz, 3),
            "margin": round(d - req.value, 3) if req.value is not None else None,
            "passed": d >= req.value if req.value is not None else None,
            "years_to_violation": years,
            "max_safe_height_below": round(cz - req.value, 3) if req.value is not None else None,
            "severity": sev, "label": label}


META = {"conductors": CONDUCTORS, "presets": PRESETS, "voltages": VOLTAGES, "sources": SOURCES}
