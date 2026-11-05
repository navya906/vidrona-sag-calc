"""
Drone-photo analysis for distribution / transmission lines (oblique or top-down views).

Detects
  - conductors: thin, long ridges, bright (silver ACSR against foliage / ground) or dark
    (wire against a pale sky); sagging wires are followed along their curve
  - poles: tall, narrow, non-vegetation vertical structures (grey concrete / steel or dark wood)
  - vegetation: excess-green index
  - leaf contact: places where foliage covers the detected conductor path

A single 2-D photo has no depth, so foliage *behind* a wire looks the same as foliage
*next to* it. Only foliage drawn *over* the wire (occlusion) is hard evidence of contact.
Metric clearance needs a side view, stereo pair or LiDAR - this module reports pixel /
relative measures and contact evidence, not metres.
"""
from __future__ import annotations

import math

import cv2
import numpy as np
from skimage.filters import sato
from skimage.morphology import skeletonize

MAX_SIDE = 1600
# Below this share of the photo's long, smooth line structure explained by the detected conductors, the
# result is reported as low confidence and no conductor is called "Clear". Demo assumption, set from test
# photos: good results 56-73 %, failures (lattice tower, grey-olive forest) 0-15 %.
MIN_COVERAGE = 0.35


def _load(data: bytes) -> tuple[np.ndarray, float]:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode the image")
    h, w = img.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale < 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return img, scale


def _excess_green(img: np.ndarray) -> np.ndarray:
    b, g, r = (c.astype(np.float32) for c in cv2.split(img))
    return (2 * g - r - b) / (b + g + r + 1e-6)


def _candidates(gray: np.ndarray, hsv: np.ndarray, exg: np.ndarray, dark: bool = False) -> np.ndarray:
    """Thin-ridge pixels that are not vegetation. dark=False: bright wire; dark=True: dark wire on pale sky."""
    ridge = sato(gray / 255.0, sigmas=[1.5, 2.5, 3.5], black_ridges=dark)
    ridge /= max(np.percentile(ridge, 99.7), 1e-6)
    mask = (ridge > 0.35) & (exg < 0.10) & (hsv[..., 1] < 110)
    if dark:   # must be clearly darker than its surroundings (rejects leaf shadows and textured ground)
        local = cv2.GaussianBlur(gray, (0, 0), 6).astype(np.int16)
        mask &= (local - gray.astype(np.int16) > 10) & (local > 120)
    mask = mask.astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= 40
    keep[0] = False
    return keep[lab].astype(np.uint8) * 255


def _strands(cand: np.ndarray, diag: float) -> np.ndarray:
    """Long, smooth 1-px strands of a candidate mask: thinned, cut at junctions, short or curly pieces dropped.
    Wires survive as strands even where the detector fails to fit them, so strands measure what *should*
    have been found."""
    sk = skeletonize(cand > 0).astype(np.uint8)
    nb = cv2.filter2D(sk, -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT) - sk
    sk[cv2.dilate(((sk > 0) & (nb > 2)).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0] = 0
    n, lab, stats, _ = cv2.connectedComponentsWithStats(sk, connectivity=8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < max(25, 0.03 * diag):
            continue
        x, y, w, h = stats[i, :4]
        ys, xs = np.nonzero(lab[y:y + h, x:x + w] == i)
        pts = np.c_[xs, ys].astype(np.float64)
        pts -= pts.mean(axis=0)
        sv = np.linalg.svd(pts, compute_uv=False)
        keep[i] = 4 * sv[0] / np.sqrt(len(pts)) >= 0.75 * stats[i, cv2.CC_STAT_AREA] and sv[1] / sv[0] < 0.12
    return keep[lab]


def _assess(cands: dict[int, np.ndarray], conds: list[dict], diag: float) -> dict:
    """How much of the photo's wire-like structure the detected conductors explain."""
    strands = _strands(cands[1], diag) | _strands(cands[-1], diag)
    covered = np.zeros(strands.shape, np.uint8)
    for c in conds:
        cv2.polylines(covered, [c["xy"].astype(np.int32)], False, 1, max(9, int(0.012 * diag)))
    total = int(strands.sum())
    coverage = float((strands & (covered > 0)).sum() / total) if total else 1.0
    reasons = []
    if not conds:
        reasons.append("No conductors were detected. This is not a clear result: the wires may be "
                       "there but not recognised in this kind of photo.")
    elif coverage < MIN_COVERAGE:
        reasons.append(f"The detected conductors explain only {100 * coverage:.0f}% of the wire-like lines in the "
                       f"photo, so wires are probably missed or misplaced (busy background, lattice tower, "
                       f"or a view this detector is not built for).")
    return {"confidence": "low" if reasons else "ok", "coverage_pct": round(100 * coverage, 1), "reasons": reasons}


def _cluster_segments(segs: np.ndarray, ang_tol: float = 3.0, rho_tol: float = 12.0) -> list[list[int]]:
    """Union-find on Hough segments that are collinear (same angle and normal offset)."""
    th = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 180
    phi = np.radians(th + 90)
    mx, my = (segs[:, 0] + segs[:, 2]) / 2, (segs[:, 1] + segs[:, 3]) / 2
    parent = list(range(len(segs)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            d = abs(th[i] - th[j])
            if min(d, 180 - d) > ang_tol:
                continue
            # distance of j's midpoint from i's line and vice versa
            di = abs((mx[j] - mx[i]) * math.cos(phi[i]) + (my[j] - my[i]) * math.sin(phi[i]))
            dj = abs((mx[i] - mx[j]) * math.cos(phi[j]) + (my[i] - my[j]) * math.sin(phi[j]))
            if max(di, dj) < rho_tol:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(segs)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _sample(gray: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    h, w = gray.shape
    xi, yi = np.clip(np.round(x).astype(int), 0, w - 1), np.clip(np.round(y).astype(int), 0, h - 1)
    return gray[yi, xi].astype(np.float32)


def _fit_conductor(cand: np.ndarray, gray: np.ndarray, exg: np.ndarray, segs: np.ndarray, diag: float,
                   polarity: int = 1) -> dict | None:
    """Fit one conductor seeded by a group of collinear Hough segments. The fit is grown iteratively:
    pick the run of candidate pixels near the current curve, re-frame on that run's chord, refit a
    parabola and repeat, so a sagging wire is followed beyond the straight piece Hough found."""
    pts = np.vstack([segs[:, :2], segs[:, 2:]]).astype(np.float64)
    weights = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    vec = np.array([np.sum((segs[:, 2] - segs[:, 0]) * np.sign(segs[:, 2] - segs[:, 0] + 1e-9)),
                    np.sum((segs[:, 3] - segs[:, 1]) * np.sign(segs[:, 2] - segs[:, 0] + 1e-9))])
    d = vec / (np.linalg.norm(vec) + 1e-9)
    n = np.array([-d[1], d[0]])
    c0 = np.average(pts, axis=0, weights=np.r_[weights, weights])
    ys, xs = np.nonzero(cand)
    P = np.c_[xs, ys].astype(np.float64)
    coef, seed, length = np.zeros(3), None, 0.0

    for it in range(8):
        rel = P - c0
        u_all, v_all = rel @ d, rel @ n
        near = np.abs(v_all - np.polyval(coef, u_all)) < 5
        if near.sum() < 60:
            return None
        run = _run(u_all[near], v_all[near], seed, diag, exg, c0, d, n)
        if run is None:
            return None
        u, v = run
        if u[-1] - u[0] < 0.18 * diag:
            return None if it == 0 else _finish(prev, gray, polarity)
        prev = (c0, d, n, np.polyfit(u, v, 2), u, v)
        if it and u[-1] - u[0] - length < 2:          # stopped growing
            break
        length = u[-1] - u[0]
        # re-frame on the chord of the current run; seed = its middle
        xy = c0 + np.outer(u, d) + np.outer(v, n)
        a, b = xy[0], xy[-1]
        d = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-d[1], d[0]])
        c0 = (a + b) / 2
        rel = xy - c0
        coef, seed = np.polyfit(rel @ d, rel @ n, 2), 0.0
    return _finish(prev, gray, polarity)


def _run(u: np.ndarray, v: np.ndarray, seed: float | None, diag: float, exg: np.ndarray,
         c0: np.ndarray, d: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Continuous run of points along u (gap <= 45 px): the longest one, or the one nearest `seed`."""
    order = np.argsort(u)
    u, v = u[order], v[order]
    breaks = np.flatnonzero(np.diff(u) > 45)
    starts, ends = np.r_[0, breaks + 1], np.r_[breaks, u.size - 1]
    if seed is None:
        k = int(np.argmax(u[ends] - u[starts]))
    else:
        k = int(np.argmin(np.maximum(0, np.maximum(u[starts] - seed, seed - u[ends]))))
    # Bridge longer gaps to collinear pieces on either side. Foliage drawn over the wire hides it, so
    # the worst encroachment splits the wire; without bridging, _contact never samples that stretch.
    # A gap is bridged only if foliage covers most of it: a gap at a pole, insulator or crossarm is
    # where the wire really ends, and must not be joined to the next span.
    bridge, min_piece = 0.12 * diag, 0.04 * diag

    def leafy(i: int, j: int) -> bool:          # gap between the end of piece i and the start of piece j
        uu = np.linspace(u[ends[i]], u[starts[j]], 25)[1:-1]
        vv = np.interp(uu, [u[ends[i]], u[starts[j]]], [v[ends[i]], v[starts[j]]])
        q = c0 + np.outer(uu, d) + np.outer(vv, n)
        return float(np.mean(_sample(exg, q[:, 0], q[:, 1]) > 0.12)) >= 0.8

    def joinable(i: int, j: int) -> bool:
        far = j if j != k else i
        return (u[starts[j]] - u[ends[i]] <= bridge and u[ends[far]] - u[starts[far]] >= min_piece and leafy(i, j))

    lo = hi = k
    while lo > 0 and joinable(lo - 1, lo):
        lo -= 1
    while hi < len(starts) - 1 and joinable(hi, hi + 1):
        hi += 1
    return u[starts[lo]:ends[hi] + 1], v[starts[lo]:ends[hi] + 1]


def _finish(fit: tuple, gray: np.ndarray, polarity: int) -> dict | None:
    c0, d, n, coef, u, v = fit
    uu = np.linspace(u[0], u[-1], 60)
    vv = np.polyval(coef, uu)
    xy = c0 + np.outer(uu, d) + np.outer(vv, n)

    # contrast test: wire brighter (polarity +1) or darker (-1) than both sides - rejects pole / roof edges.
    # Normals are taken from the local tangent so the test also holds along a curved wire.
    us = np.linspace(u[0], u[-1], 120)
    vs = np.polyval(coef, us)
    base = c0 + np.outer(us, d) + np.outer(vs, n)
    tang = np.outer(np.ones_like(us), d) + np.outer(np.polyval(np.polyder(coef), us), n)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    nrm = np.c_[-tang[:, 1], tang[:, 0]]
    sample = lambda o: _sample(gray, base[:, 0] + nrm[:, 0] * o, base[:, 1] + nrm[:, 1] * o)
    centre, side_a, side_b = sample(0), sample(9), sample(-9)
    if np.mean((polarity * (centre - side_a) > 12) & (polarity * (centre - side_b) > 12)) < 0.45:
        return None

    stack = [sample(o) for o in range(-3, 4)]
    ridge_br = np.max(stack, axis=0) if polarity > 0 else np.min(stack, axis=0)

    # apparent width (FWHM of perpendicular profile), median over the wire
    widths = []
    for p, q in zip(base[::6], nrm[::6]):
        offs = np.arange(-12, 13)
        prof = polarity * _sample(gray, p[0] + q[0] * offs, p[1] + q[1] * offs)
        half = (prof.max() + np.median(prof)) / 2
        widths.append(int(np.sum(prof > half)))
    return {"xy": xy, "d": d, "n": n, "c0": c0, "coef": coef, "u0": float(u[0]), "u1": float(u[-1]),
            "width_px": float(np.median(widths)), "length_px": float(u[-1] - u[0]),
            "brightness": float(np.median(ridge_br)), "polarity": polarity}


def _contact(img_exg: np.ndarray, gray: np.ndarray, c: dict) -> tuple[float, list[list[float]], float]:
    """Foliage drawn over the wire path = contact; also vegetation share of a corridor around it."""
    us = np.arange(c["u0"], c["u1"], 3.0)
    vs = np.polyval(c["coef"], us)
    p = c["c0"] + np.outer(us, c["d"]) + np.outer(vs, c["n"])
    occluded = np.ones(len(p), bool)
    for o in range(-2, 3):
        q = p + c["n"] * o
        occluded &= (_sample(img_exg, q[:, 0], q[:, 1]) > 0.12) & (_sample(gray, q[:, 0], q[:, 1]) < 170)
    # ignore the ends (fit is least reliable where the wire meets insulators / frame edge)
    edge = max(3, len(p) // 20)
    occluded[:edge] = occluded[-edge:] = False
    runs, start = [], None
    for i, o in enumerate(np.r_[occluded, False]):
        if o and start is None:
            start = i
        elif not o and start is not None:
            if i - start >= 3:                  # >= ~9 px of foliage across the wire
                runs.append([*p[start].tolist(), *p[i - 1].tolist()])
            start = None
    band = max(12.0, 5 * c["width_px"])
    veg_hits = total = 0
    for off in np.linspace(-band, band, 9):
        q = p + c["n"] * off
        veg_hits += int(np.sum(_sample(img_exg, q[:, 0], q[:, 1]) > 0.06))
        total += len(q)
    return float(occluded.mean()), runs, veg_hits / max(total, 1)


def _poles(gray: np.ndarray, exg: np.ndarray, attach: list[tuple[float, float]], dark: bool = False) -> list[list[int]]:
    """Pole = tall, narrow, non-vegetation region (concrete / steel), near a conductor attachment.
    Two masks are tried: a strict one (smooth texture) and a loose one (any non-green, lit pixels)."""
    H, W = gray.shape
    g = gray.astype(np.float32)
    mu = cv2.blur(g, (9, 9))
    sd = np.sqrt(np.maximum(cv2.blur(g * g, (9, 9)) - mu * mu, 0))
    masks = [((exg < 0.05) & (sd < 18) & (g > 70)), ((exg < 0.08) & (g > 60))]
    if dark:      # wooden / dark poles against a pale sky
        masks.append((exg < 0.08) & (g < 0.6 * float(np.median(g))))
    boxes = []
    # kernels scale with the frame (7x25 / 19x55 px at the 1600x900 working size) so small images keep their poles
    close_k = (max(3, round(W / 230)), max(9, round(H / 36)))
    open_k = (max(5, round(W / 85)), max(15, round(H / 16)))
    for m in masks:
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, close_k))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, open_k))
        _, _, stats, _ = cv2.connectedComponentsWithStats(m)
        for x, y, w, h, area in stats[1:]:
            if (h > 0.2 * H and h / max(w, 1) >= 2.8 and w <= 0.08 * W and area / (w * h) >= 0.5
                    and x > 2 and x + w < W - 2):
                boxes.append([float(x), float(y), float(x + w), float(y + h)])
    merged: list[list[float]] = []
    for bx in sorted(boxes, key=lambda b: -(b[3] - b[1])):
        for m in merged:
            overlap = min(bx[2], m[2]) - max(bx[0], m[0])
            if overlap > 0.5 * min(bx[2] - bx[0], m[2] - m[0]):     # same column -> same pole
                m[:] = [min(m[0], bx[0]), min(m[1], bx[1]), max(m[2], bx[2]), max(m[3], bx[3])]
                break
        else:
            merged.append(list(bx))
    out = []
    for x0, y0, x1, y1 in merged:
        reach = (x1 - x0) + 60
        if any(x0 - reach <= ax <= x1 + reach and y0 - reach <= ay <= y1 for ax, ay in attach):
            out.append([int(x0), int(y0), int(x1 - x0), int(y1 - y0)])
    return out


def analyze(data: bytes) -> dict:
    img, scale = _load(data)
    H, W = img.shape[:2]
    diag = math.hypot(W, H)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    exg = _excess_green(img)
    conds: list[dict] = []
    cands: dict[int, np.ndarray] = {}
    for polarity in (1, -1):              # bright wires first, then dark wires against a pale sky
        cand = cands[polarity] = _candidates(gray, hsv, exg, dark=polarity < 0)
        lines = cv2.HoughLinesP(cand, 1, np.pi / 360, threshold=70, minLineLength=int(0.08 * diag), maxLineGap=20)
        if lines is None:
            continue
        segs = lines.reshape(-1, 4).astype(np.float64)
        if len(segs) > 400:               # keep the longest segments: clustering is O(n²)
            segs = segs[np.argsort(-np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]))[:400]]
        for grp in _cluster_segments(segs):
            c = _fit_conductor(cand, gray, exg, segs[grp], diag, polarity)
            if c:
                conds.append(c)
    # drop duplicates (two edges of one thick wire, or the same wire found twice)
    conds.sort(key=lambda c: -c["length_px"])
    unique: list[dict] = []
    for c in conds:
        dup = False
        for u in unique:
            a = abs(math.degrees(math.atan2(c["d"][1], c["d"][0]) - math.atan2(u["d"][1], u["d"][0]))) % 180
            if min(a, 180 - a) < 4:
                dist = np.min(np.hypot(*(c["xy"][:, None, :] - u["xy"][None, :, :]).transpose(2, 0, 1)), axis=1)
                if np.median(dist) < max(10, 2.5 * u["width_px"]):
                    dup = True
                    break
        if not dup:
            unique.append(c)

    bright = [c for c in unique if c["polarity"] > 0]
    if bright:    # drops dull steel crossarms; the floor is relative to the photo so dim frames keep their wires
        best = max(c["brightness"] for c in bright)
        floor = min(160.0, float(np.percentile(gray, 90)))
        unique = [c for c in unique if c["polarity"] < 0 or c["brightness"] >= max(floor, 0.75 * best)]

    margin = 15
    attach = []
    for c in unique:
        for x, y in (c["xy"][0], c["xy"][-1]):
            if margin < x < W - margin and margin < y < H - margin:
                attach.append((float(x), float(y)))
    poles = _poles(gray, exg, attach, dark=any(c["polarity"] < 0 for c in unique))
    # a true attachment (insulator) sits near a pole; wire ends that merely fade out are not counted
    attach = [(ax, ay) for ax, ay in attach
              if any(x - 2 * w - 60 <= ax <= x + 3 * w + 60 and y - 2 * w - 60 <= ay <= y + h for x, y, w, h in poles)]
    assessment = _assess(cands, unique, diag)
    inv = 1 / scale
    conductors = []
    for i, c in enumerate(unique):
        occ, runs, corridor = _contact(exg, gray, c)
        # Contact = foliage drawn over the wire (hard evidence). Dense vegetation around the wire is only
        # "possible" encroachment, because a single photo cannot tell whether it is beside or far behind.
        status = ("Contact" if runs or occ >= 0.03 else
                  "Possible encroachment" if corridor >= 0.5 else "Clear")
        if assessment["confidence"] == "low":
            status = "Unverified"           # never report Clear (or a contact) from a result we do not trust
        conductors.append({
            "id": i + 1,
            "points": [[round(x * inv, 1), round(y * inv, 1)] for x, y in c["xy"]],
            "length_px": round(c["length_px"] * inv, 1),
            "width_px": round(c["width_px"] * inv, 1),
            "contact_pct": round(100 * occ, 1),
            "contact_segments": [[round(v * inv, 1) for v in r] for r in runs],
            "corridor_vegetation_pct": round(100 * corridor, 1),
            "status": status,
        })
    return {
        "width": round(W * inv), "height": round(H * inv),
        "conductors": conductors,
        "poles": [[round(v * inv) for v in p] for p in poles],
        "attachment_points": [[round(x * inv, 1), round(y * inv, 1)] for x, y in attach],
        "vegetation_pct": round(100 * float(np.mean(exg > 0.06)), 1),
        "assessment": assessment,
    }
