/**
 * Plane homography from 4 point pairs (DLT, solved with Gaussian elimination).
 * Maps image pixels of the tower plane onto a metric side view: x along the span (m), y height above ground (m).
 */
function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** src: 4 × [px, py]; dst: 4 × [X, Y]. Returns a function (px, py) → [X, Y], or null if degenerate. */
export function homography(src, dst) {
  const A = [], b = []
  src.forEach(([x, y], i) => {
    const [X, Y] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X)
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y)
  })
  const h = solve(A, b)
  if (!h) return null
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
  }
}

/**
 * Sag of a curve in the metric frame: drop of the lowest point below the chord joining its ends.
 * pts: array of [X, Y] in metres (Y up).
 */
export function metricSag(pts) {
  const [x0, y0] = pts[0], [x1, y1] = pts.at(-1)
  let best = 0
  for (const [x, y] of pts) {
    const chord = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)
    best = Math.max(best, chord - y)
  }
  return best
}
