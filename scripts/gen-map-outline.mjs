/**
 * Generate a simplified China outline SVG (data/map-outline.svg) from the
 * national GeoJSON (data/geo_100000.json).
 *
 * Why not simple edge cancellation? DataV province boundaries do not share
 * identical vertices along shared borders, so exact-match cancellation leaves
 * interior edges behind and shatters the outline into many pieces.
 *
 * Robust approach — rasterize the union, then trace the silhouette:
 *   1. Scanline-fill every province polygon onto a 0.1° grid (even-odd rule
 *      over all rings of all provinces -> the national union, holes carved).
 *   2. Flood-fill connected components (mainland / Hainan / Taiwan / islets).
 *   3. Trace each component's boundary as cell-corner polylines.
 *   4. Douglas-Peucker simplify + point decimation -> SVG paths.
 *
 * Output: single SVG with one <path> per kept ring (fill none, stroke accent),
 * usable as <img src="data/map-outline.svg"> in the loading overlay.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = join(root, 'data', 'geo_100000.json');
const OUTPUT = join(root, 'data', 'map-outline.svg');

const CELL = 0.1; // grid resolution in degrees (~11 km)
const MIN_COMPONENT_CELLS = 40; // drop islets smaller than ~0.4 deg² (~4000 km²)
const MAX_POINTS_MAIN = 260; // point cap for the mainland ring
const MAX_POINTS_ISLAND = 40; // point cap for Hainan / Taiwan

/* ------------------------------------------------------------------ */
/* 1. Collect all rings and the bounding box                           */
/* ------------------------------------------------------------------ */

const geo = JSON.parse(readFileSync(INPUT, 'utf8'));

let minLon = Infinity;
let minLat = Infinity;
let maxLon = -Infinity;
let maxLat = -Infinity;

const allEdges = []; // [lon,lat] point pairs, from every ring (outer + holes)
for (const f of geo.features) {
  const geom = f.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        allEdges.push([a, b]);
        for (const p of [a, b]) {
          if (p[0] < minLon) minLon = p[0];
          if (p[0] > maxLon) maxLon = p[0];
          if (p[1] < minLat) minLat = p[1];
          if (p[1] > maxLat) maxLat = p[1];
        }
      }
    }
  }
}

const COLS = Math.ceil((maxLon - minLon) / CELL);
const ROWS = Math.ceil((maxLat - minLat) / CELL);

/* ------------------------------------------------------------------ */
/* 2. Scanline fill the union onto the grid                            */
/* ------------------------------------------------------------------ */

const grid = new Uint8Array(ROWS * COLS); // 1 = covered by the union
const xs = []; // reused x-intersection buffer per row

for (let r = 0; r < ROWS; r++) {
  const y = minLat + (r + 0.5) * CELL;
  xs.length = 0;
  for (const [a, b] of allEdges) {
    const yLo = a[1] < b[1] ? a[1] : b[1];
    const yHi = a[1] < b[1] ? b[1] : a[1];
    if (y >= yLo && y < yHi) {
      // half-open interval: a shared vertex is counted once
      xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const c0 = Math.max(0, Math.floor((xs[i] - minLon) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((xs[i + 1] - minLon) / CELL));
    const base = r * COLS;
    for (let c = c0; c <= c1; c++) grid[base + c] = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Connected-component labelling (4-neighbour)                      */
/* ------------------------------------------------------------------ */

const label = new Int32Array(ROWS * COLS).fill(-1);
const sizes = [0]; // label -> cell count (label 0 unused)
let nextLabel = 0;

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (grid[i] !== 1 || label[i] !== -1) continue;
    nextLabel++;
    sizes.push(0);
    const stack = [i];
    label[i] = nextLabel;
    while (stack.length) {
      const j = stack.pop();
      sizes[nextLabel]++;
      const rr = Math.floor(j / COLS);
      const cc = j % COLS;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = rr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        const ni = nr * COLS + nc;
        if (grid[ni] === 1 && label[ni] === -1) {
          label[ni] = nextLabel;
          stack.push(ni);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4. Trace boundary polylines per kept component                      */
/* ------------------------------------------------------------------ */

/**
 * Moore-neighbour boundary tracing.
 * Walks the boundary of the component's filled cells in a clockwise order,
 * which handles diagonal-only pinch points that break naive edge stitching.
 * Returns a closed polyline of CELL CENTERS (grid units).
 */
function traceBoundary(lbl) {
  const isCell = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && label[r * COLS + c] === lbl;
  const isBoundaryCell = (r, c) => {
    if (!isCell(r, c)) return false;
    return !isCell(r - 1, c) || !isCell(r + 1, c) || !isCell(r, c - 1) || !isCell(r, c + 1);
  };

  // Start: first boundary cell in row-major order (its west neighbour is background).
  let start = null;
  for (let r = 0; r < ROWS && !start; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isBoundaryCell(r, c)) {
        start = [r, c];
        break;
      }
    }
  }
  if (!start) return null;

  // Clockwise order: N, NE, E, SE, S, SW, W, NW
  const CLOCK = [
    [-1, 0], [-1, 1], [0, 1], [1, 1],
    [1, 0], [1, -1], [0, -1], [-1, -1]
  ];

  const path = [];
  let cur = start;
  let back = [start[0], start[1] - 1];
  let guard = 0;

  for (;;) {
    path.push([cur[0], cur[1]]);
    if (cur[0] === start[0] && cur[1] === start[1] && path.length > 1) break;
    if (guard++ > 8 * grid.length) {
      console.warn('[gen-map-outline] trace guard exceeded');
      break;
    }
    const bi = CLOCK.findIndex(
      ([dr, dc]) => back[0] - cur[0] === dr && back[1] - cur[1] === dc
    );
    let next = null;
    for (let k = 1; k <= 8; k++) {
      const [dr, dc] = CLOCK[(bi + k) % 8];
      const nr = cur[0] + dr;
      const nc = cur[1] + dc;
      if (isBoundaryCell(nr, nc)) {
        next = [nr, nc];
        break;
      }
    }
    if (!next) break;
    back = cur;
    cur = next;
  }

  return path.length >= 4 ? path : null;
}

const rings = []; // array of [lon, lat][] closed polylines
for (let lbl = 1; lbl <= nextLabel; lbl++) {
  if (sizes[lbl] < MIN_COMPONENT_CELLS) continue;
  const ring = traceBoundary(lbl);
  if (ring) rings.push(ring);
}

if (rings.length === 0) {
  throw new Error('轮廓抽取失败：未追踪到有效环');
}

/* ------------------------------------------------------------------ */
/* 5. Convert to lon/lat, simplify, emit SVG                           */
/* ------------------------------------------------------------------ */

const toLonLat = (ring) =>
  ring.map(([r, c]) => [minLon + (c + 0.5) * CELL, minLat + (r + 0.5) * CELL]);

/** Douglas-Peucker simplification (keeps first/last points). */
function simplify(points, epsilon) {
  if (points.length <= 2) return points;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len;
  };
  const stack = [[0, points.length - 1]];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dist(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const kept = rings
  .map((ring) => ({ points: toLonLat(ring) }))
  .sort((a, b) => b.points.length - a.points.length);

let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const r of kept) {
  for (const [x, y] of r.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const W = maxX - minX;
const H = maxY - minY;
const span = Math.max(W, H);
const eps = span * 0.0016; // ~2 km on the ground, smooths the 0.1° pixel steps

const paths = [];
for (let i = 0; i < kept.length; i++) {
  const cap = i === 0 ? MAX_POINTS_MAIN : MAX_POINTS_ISLAND;
  let pts = simplify(kept[i].points, eps);
  if (pts.length > cap) {
    const step = Math.ceil(pts.length / cap);
    pts = pts.filter((_, k) => k % step === 0);
  }
  // Flip Y (GeoJSON y grows north, SVG y grows down) and rebase to viewBox.
  const d =
    pts
      .map(
        (p, k) =>
          `${k === 0 ? 'M' : 'L'}${(p[0] - minX).toFixed(3)},${(maxY - p[1]).toFixed(3)}`
      )
      .join('') + ' Z';
  paths.push(d);
}

// Stroke width relative to the shape span so it stays ~2.2% of width at any size.
const strokeWidth = (span * 0.022).toFixed(2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}" fill="none" stroke="#4FA3FF" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">
${paths.map((d) => `  <path d="${d}"/>`).join('\n')}
</svg>
`;

writeFileSync(OUTPUT, svg, 'utf8');
console.log(
  `[gen-map-outline] OK: ${paths.length} ring(s), main ring ${kept[0].points.length} -> ${paths[0] ? paths[0].split(' ').length : 0} pts, saved ${OUTPUT}`
);
