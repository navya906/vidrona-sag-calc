"""
Image -> vector extraction for an overhead-line span.

1. Black-hat (dark strokes) + bright-ridge (silver wire on foliage/sky) masks; short components are dropped.
2. Skeletonise -> candidate pixels.
3. RANSAC fits parabolas y = ax² + bx + c (a < 0 in image coords = sagging) and scores them by
   the longest continuous run of covered columns, so long wires beat towers and labels.
4. Curve ends are trimmed where the wire enters tower lattice; ground = mean tower base.

Returned in ORIGINAL pixels so the UI can overlay, let the user drag corrections, and calibrate.
"""
from __future__ import annotations

import warnings

import cv2
import numpy as np
from skimage.filters import sato
from skimage.morphology import skeletonize

MAX_SIDE = 1400
warnings.simplefilter("ignore", np.exceptions.RankWarning)


def _stroke_mask(img: np.ndarray) -> tuple[float, np.ndarray]:
    """Thin-line mask = dark strokes (drawings) OR bright non-green ridges (real photos of ACSR wire)."""
    h, w = img.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale < 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k = max(7, round(max(img.shape[:2]) / 120) | 1)
    bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    _, dark = cv2.threshold(bh, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = dark if _is_drawing(img) else dark | _bright_ridges(img, gray)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = stats[:, cv2.CC_STAT_WIDTH] >= 0.12 * mask.shape[1]
    keep[0] = False
    return scale, keep[lab]


def _is_drawing(img: np.ndarray) -> bool:
    """Drawings / infographics have large flat areas; photos have texture almost everywhere."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.median(cv2.blur(np.abs(lap), (9, 9)))) < 20


def _bright_ridges(img: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Bright, thin, non-vegetation ridges (same recipe as vision_drone._candidates)."""
    b, g, r = (c.astype(np.float32) for c in cv2.split(img))
    exg = (2 * g - r - b) / (b + g + r + 1e-6)
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[..., 1]
    ridge = sato(gray / 255.0, sigmas=[1.5, 2.5, 3.5], black_ridges=False)
    top = np.percentile(ridge, 99.7)
    if top <= 1e-6:
        return np.zeros_like(gray)
    ridge = ridge / top
    # only meaningful when the ridge response is strong and the pixel is clearly brighter than its surroundings
    local = cv2.GaussianBlur(gray, (0, 0), 6)
    return (((ridge > 0.35) & (exg < 0.10) & (sat < 110) & (gray.astype(np.int16) - local > 15)) * 255).astype(np.uint8)


def _longest_run(xs: np.ndarray, max_gap: float) -> tuple[int, int, int] | None:
    cols = np.unique(np.round(xs).astype(int))
    if cols.size == 0:
        return None
    breaks = np.flatnonzero(np.diff(cols) > max_gap)
    starts, ends = np.r_[0, breaks + 1], np.r_[breaks, cols.size - 1]
    i = int(np.argmax(ends - starts))
    return int(cols[starts[i]]), int(cols[ends[i]]), int(ends[i] - starts[i] + 1)


def _fit(xs: np.ndarray, ys: np.ndarray, W: int, rng: np.random.Generator,
         iters: int = 1500, tol: float = 2.0) -> dict | None:
    if xs.size < 50:
        return None
    sub = rng.choice(xs.size, size=min(xs.size, 9000), replace=False)
    sx, sy = xs[sub].astype(float), ys[sub].astype(float)
    best: tuple[int, np.ndarray] | None = None
    for _ in range(iters):
        i = rng.choice(sx.size, 3, replace=False)
        spread = np.ptp(sx[i])
        if spread < 0.25 * W:
            continue
        coef = np.polyfit(sx[i], sy[i], 2)
        depth = -coef[0] * (spread / 2) ** 2
        if not (max(3.0, 0.015 * spread) <= depth <= 0.25 * spread):
            continue  # flat (text rows, chords, ground) or implausibly deep
        inl = np.abs(np.polyval(coef, sx) - sy) < tol
        run = _longest_run(sx[inl], 0.04 * W) if inl.sum() >= 30 else None
        if run and (best is None or run[2] > best[0]):
            best = (run[2], coef)
    if best is None:
        return None
    coef = best[1]
    for _ in range(2):  # refine on all points of the longest continuous run
        inl = np.abs(np.polyval(coef, xs) - ys) < tol * 1.5
        run = _longest_run(xs[inl], 0.05 * W)
        if run is None:
            return None
        sel = inl & (xs >= run[0]) & (xs <= run[1])
        if sel.sum() < 20:
            return None
        coef = np.polyfit(xs[sel].astype(float), ys[sel].astype(float), 2)
    return {"coef": coef, "x0": float(run[0]), "x1": float(run[1]), "coverage": run[2] / (run[1] - run[0] + 1)}


def _trim_into_towers(mask: np.ndarray, coef: np.ndarray, x0: float, x1: float) -> tuple[float, float]:
    """Pull curve ends inward while the wire is surrounded by tower lattice."""
    H, W = mask.shape

    def clutter(x: float) -> float:
        y, xa, xb = int(np.polyval(coef, x)), max(0, int(x) - 2), min(W, int(x) + 3)
        band = np.r_[mask[max(0, y - 22):max(0, y - 5), xa:xb].ravel(), mask[min(H, y + 5):min(H, y + 22), xa:xb].ravel()]
        return band.mean() if band.size else 0.0

    limit = int((x1 - x0) * 0.2)
    i = next((k for k in range(limit) if clutter(x0 + k) <= 0.08), limit)
    j = next((k for k in range(limit) if clutter(x1 - k) <= 0.08), limit)
    return x0 + i, x1 - j


def _tower_base(mask: np.ndarray, x: float, y: float) -> float | None:
    """Find the tower near (x, y) by vertical pixel density, then walk down to its base."""
    H, W = mask.shape
    y = int(y)
    xa, xb = int(max(0, x - 0.05 * W)), int(min(W, x + 0.05 * W))
    depth = np.convolve(mask[y:y + int(0.25 * H), xa:xb].sum(axis=0), np.ones(9) / 9, mode="same")
    if depth.size == 0 or depth.max() == 0:
        return None
    cx, half = xa + int(np.argmax(depth)), max(5, int(W * 0.015))
    filled = np.flatnonzero(mask[y:, max(0, cx - half):cx + half].mean(axis=1) > 0.04)
    if filled.size == 0:
        return None
    gaps = np.flatnonzero(np.diff(filled) > max(8, int(H * 0.02)))  # stop at the first real gap
    last = y + int(filled[gaps[0]] if gaps.size else filled[-1])
    return float(last) if last > y + 5 else None


def vectorize(data: bytes, max_curves: int = 3) -> dict:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode the image")
    H0, W0 = img.shape[:2]
    scale, mask = _stroke_mask(img)
    ys, xs = np.nonzero(skeletonize(mask))
    rng = np.random.default_rng(7)  # deterministic results for the same image
    inv = 1 / scale

    curves: list[dict] = []
    free = np.ones(xs.size, bool)
    for _ in range(max_curves + 4):
        fit = _fit(xs[free], ys[free], mask.shape[1], rng)
        if fit is None:
            break
        coef = fit["coef"]
        idx = np.flatnonzero(free)
        used = (np.abs(np.polyval(coef, xs[idx]) - ys[idx]) < 6) & (xs[idx] >= fit["x0"] - 5) & (xs[idx] <= fit["x1"] + 5)
        free[idx[used]] = False

        x0, x1 = _trim_into_towers(mask, coef, fit["x0"], fit["x1"])
        y0, y1 = np.polyval(coef, x0), np.polyval(coef, x1)
        xv = float(np.clip(-coef[1] / (2 * coef[0]), x0, x1))
        yv = np.polyval(coef, xv)
        sag = yv - (y0 + (y1 - y0) * (xv - x0) / max(x1 - x0, 1))
        if x1 - x0 < 0.25 * mask.shape[1] or sag < max(3, 0.01 * (x1 - x0)):
            continue
        curves.append({
            "attach_left": (x0 * inv, float(y0) * inv), "attach_right": (x1 * inv, float(y1) * inv),
            "lowest": (xv * inv, float(yv) * inv), "sag_px": float(sag) * inv, "span_px": (x1 - x0) * inv,
            "coverage": round(fit["coverage"], 3),
            "points": [(float(x) * inv, float(np.polyval(coef, x)) * inv) for x in np.linspace(x0, x1, 40)],
        })
        if len(curves) == max_curves:
            break

    curves.sort(key=lambda c: c["lowest"][1])  # top -> bottom
    ground_y, method = float(H0 * 0.9), "fallback (90% of image height) - drag to adjust"
    if curves:
        low = curves[-1]
        bases = [b for p in (low["attach_left"], low["attach_right"])
                 if (b := _tower_base(mask, p[0] * scale, p[1] * scale)) is not None]
        if bases:
            ground_y, method = sum(bases) / len(bases) * inv, "tower base"
    return {"width": W0, "height": H0, "curves": curves, "ground_y": ground_y, "ground_method": method,
            "confidence": round(float(np.mean([c["coverage"] for c in curves])) if curves else 0.0, 2)}
