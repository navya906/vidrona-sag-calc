# Sag & Clearance Analyser

A demo web app (React + FastAPI, no login, no database) that checks an overhead line span for **sag**, **ground clearance**, **vegetation / tree clearance** and **B-R-Y phase ratios**, from either typed values or an uploaded image.

**Scope (confirmed):** 11 kV, 33 kV and 220 kV · phases represented as **BRY** (B top, R middle, Y bottom) · healthy phase ratio = **1**.

## Run it

```bash
# 1. Backend (Python 3.10+)
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Open **http://localhost:8000**. The built React app in `frontend/dist` is served by FastAPI, so this one command is the whole demo.

To work on the frontend with hot reload:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api to :8000)
npm run build        # refresh frontend/dist
```

## Two input modes

| Mode | What you give | What happens |
|---|---|---|
| **Text input** | Voltage (11 / 33 / 220 kV), line location (open ground / along / across a street), conductor, span, attachment height, phase spacing, factor of safety, temperatures, wind, tree details | Sag is calculated from tension (T = UTS ÷ FoS) with `S = wL²/8T` |
| **Image input** | A photo or drawing of a span + one known length (span) and optionally the attachment height | The image is vectorised: the wire is found and fitted, sag is measured in pixels and converted to metres. The implied tension is back-calculated |

### How the image is vectorised (`backend/vision.py`)
1. **Black-hat morphology** isolates thin dark strokes (wires, towers, text).
2. **Short strokes are dropped** (text, dashes), and the rest is **skeletonised**.
3. **RANSAC parabola fitting** finds the sagging wires. Candidates are scored by the longest continuous run of pixels, so long wires beat text and lattice. Up to 3 conductors (phases) are found.
4. Wire ends are **trimmed where they enter the tower lattice**. **Ground** is the average tower base.
5. The UI overlays the result. **Every point can be dragged** to correct it, and the numbers update live.

**Calibration:** the known span sets the horizontal scale. If the attachment height is also given, the vertical scale is set separately. This matters for schematic drawings: the bundled 132 kV diagram labels 5 m of sag but draws it about 2× too tall, and the app detects and flags this mismatch.

## What is calculated

| Output | Method |
|---|---|
| Sag | Parabolic `S = wL²/8T` (as in the brief), with catenary shown for comparison |
| Sag at max temperature | Parabolic state-change equation (temperature sweep 0–90 °C) |
| Wind blow-out | Swing angle `tan θ = (wind pressure × diameter) / weight` |
| Ground clearance required | CEA Reg. 58: across street 6.1 m, along street 5.8 m (up to 33 kV); open ground 4.6 m bare / 4.0 m insulated (11 kV), 5.2 m (33 kV); 220 kV = 5.2 + 0.3 × 6 = 7.0 m |
| Tree clearance required | MoEF / CEA table: 11 kV 2.6 m · 33 kV 2.8 m · 220 kV 4.6 m |
| Tree check | 3-D distance from the (swung) conductor to the canopy, plus years until breach at the given growth rate |
| Phase ratio | Mid-span distance ÷ tower distance for each pair (B-R, **R-Y**, B-Y) on both arms. 1.00 = healthy; below 1 = phases closing in; above 1 = spreading. R-Y is the headline value |
| Severity 1–5 | Clearance ratio bands, matching the Vidrona fault card format |

Use **Simulate phase sag fault** to add extra sag to any phase and watch the ratios and severity react.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Conductors, voltage presets, sources |
| POST | `/api/calculate` | All calculations (`CalcRequest` → `CalcResult`) |
| POST | `/api/vectorize` | Image → detected curves, handles and ground (`VectorizeResult`) |

Interactive docs: http://localhost:8000/docs. All request and response shapes are in `backend/schemas.py`.

## Assumptions to confirm

- **Phase ratio tolerance**: warning at ±10%, critical at ±25% from 1.00 (adjustable via `ratio_warn` / `ratio_crit`).
- **Severity bands**: ratio ≥ 1.5 → 1, ≥ 1.25 → 2, ≥ 1.1 → 3, ≥ 1.0 → 4, below → 5.
- Conductor **E-modulus** values and the ACSR Dog / AAAC rows are typical values. Panther, Zebra and Moose weight, diameter and UTS come from a utility specification.
- Level spans only (equal tower heights). 11 / 33 kV presets (span, height, spacing) are illustrative.

## Sources

- CEA (Measures relating to Safety and Electric Supply) Regulations: ground clearance rule.
- MoEF guidelines for transmission lines through forest land (published by CEA): tree clearance and right-of-way.
- TGTRANSCO technical specification for ACSR Panther / Zebra / Moose: conductor data.
