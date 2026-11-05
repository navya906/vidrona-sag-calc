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

## Three input modes

| Mode | What you give | What happens |
|---|---|---|
| **Text** | Voltage (11 / 33 / 220 kV), line location, conductor, span, attachment height, phase spacing, tree details; advanced: factor of safety, temperatures, wind, phase-fault simulation | Sag from tension (T = UTS ÷ FoS) with `S = wL²/8T`, carried to the maximum temperature |
| **Side-view image** | A side-on photo or drawing of a span + known span (m) and attachment height (m); optionally 4 tower points for perspective correction and the conductor temperature at photo time | The wire is found and fitted (dark strokes on drawings, bright ridges on photos), sag is measured in pixels, converted to metres, corrected for viewing angle, and the implied tension is back-calculated. The sag-vs-temperature curve then starts from the photo temperature |
| **Drone photo** | An oblique drone frame of a pole or span | Conductors, poles, attachment points and vegetation are detected; each conductor is marked Contact / Possible encroachment / Clear. No sag calculation: a single photo has no depth |

Camera metadata (GPS, altitude, gimbal pitch, focal length, DJI XMP fields) is read from original files and shown under the image. WhatsApp and most chat apps strip it, so send the original drone files. Optional "From / To pole ID" fields label the span (e.g. 0008 → 0009) in the summary and the JSON export.

### How the side-view image is vectorised (`backend/vision.py`)
1. Two thin-line masks: **black-hat morphology** for dark strokes (drawings) and a **ridge filter with excess-green rejection** for bright silver wire on foliage or sky (photos). Drawings are told apart from photos by texture.
2. **Short strokes are dropped** (text, dashes) and the rest is **skeletonised**.
3. **RANSAC parabola fitting** finds the sagging wires, scored by the longest continuous run of pixels. Up to 3 conductors.
4. Wire ends are **trimmed where they enter the tower lattice**. **Ground** is the average tower base.
5. The UI overlays the result. **Every point can be dragged** to correct it.

**Calibration:** known span sets the horizontal scale; known attachment height sets the vertical scale. **Perspective correction:** mark T1 top, T1 base, T2 top, T2 base; a homography maps the tower plane to metres and the sag is re-measured in that frame. The viewing angle is estimated from how much the far tower is foreshortened.

### How the drone photo is analysed (`backend/vision_drone.py`)
1. **Ridge filter** finds thin bright lines; **excess-green** and low saturation reject foliage.
2. **Hough segments** are clustered into collinear groups and each group is fitted with a slightly curved line; a **brightness contrast test** keeps silver conductors and rejects dark steel crossarms.
3. **Poles** are tall, narrow, non-vegetation regions near a conductor end (attachment point).
4. **Leaf contact** = foliage drawn over the wire path (hard evidence). Dense foliage around the wire is only *possible* encroachment, because one photo cannot tell beside from behind.

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
| POST | `/api/vectorize` | Side-view image → detected curves, ground, camera metadata (`VectorizeResult`) |
| POST | `/api/analyze-photo` | Drone photo → conductors, poles, attachment points, vegetation, contact flags (`PhotoResult`) |

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

## Roadmap

Next: a trained wire/pole segmentation model (e.g. U-Net on the TTPLA dataset) for busy backgrounds, and stereo or photogrammetry across overlapping drone frames so vegetation clearance becomes a true 3-D distance instead of a flag.
