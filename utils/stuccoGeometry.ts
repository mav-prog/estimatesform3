// Stucco region detection from linework segments and hatch dots (page points).
//
// Every enclosed face of the linework that holds hatch dots at hatch density is stucco; a face
// that leaks through an open boundary is clipped to the hull of its dots. Openings inside a face
// become holes.
//
// Work is limited to the linework around clusters of hatch dots: title blocks, notes and logos
// never get noded. Dots packed far denser than any hatch (stippled logos) are artwork and are
// dropped together with a margin around them. The linework is noded by snap rounding on a fine
// grid, which is robust against the near-degenerate paths found in CAD exports; the noder needs
// its input rounded to that grid, so every coordinate is rounded first.
import 'jsts/org/locationtech/jts/monkey.js';
import { Coordinate, Envelope, GeometryFactory, LineString, Polygon, Geometry, LinearRing, PrecisionModel } from 'jsts/org/locationtech/jts/geom.js';
import { UnaryUnionOp } from 'jsts/org/locationtech/jts/operation/union.js';
import { Polygonizer } from 'jsts/org/locationtech/jts/operation/polygonize.js';
import { DouglasPeuckerSimplifier } from 'jsts/org/locationtech/jts/simplify.js';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree.js';
import GeometryNoder from 'jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js';
import IndexedPointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator.js';
import Location from 'jsts/org/locationtech/jts/geom/Location.js';
import ArrayList from 'jsts/java/util/ArrayList.js';
import concaveman from 'concaveman';

export interface DetectParams {
  width: number; height: number;
  xmax?: number;               // ignore everything right of this (title block)
  minFace: number;             // pt^2
  minHole: number;             // pt^2
  wholeDots: number; wholeDensity: number;   // dots, and dots per 1,000 pt^2, to take a face whole
  partDots: number; partDensity: number;     // a leaked face: clip to its dots
  hullPad: number;             // pt, about half the dot spacing
  simplify: number;            // pt
  gridScale?: number;          // snap-rounding grid: 10 = 0.1 pt
  cell?: number;               // pt, dot-cluster grid cell (default 24)
  maxDensity?: number;         // dots per 1,000 pt^2 above which dots are artwork, not hatch (default 200)
  pad?: number;                // pt of linework kept around each dot cluster (default 240)
  exclude?: [number, number, number, number][];   // [x0, y0, x1, y1] zones to ignore
  debug?: boolean;             // report every picked face in stats.picked
}

export interface DetectedRegion {
  exterior: [number, number][];
  holes: [number, number][][];
  grossArea: number;
  netArea: number;
  clipped: boolean;
}

export interface DetectResult {
  regions: DetectedRegion[];
  stats: {
    segments: number;          // distinct linework segments on the page
    dots: number;              // hatch dots kept
    dotsDropped: number;       // dots dropped as artwork or outside the working area
    clusters: number;          // dot clusters (working boxes)
    faces: number;             // enclosed faces examined
    merged: boolean;           // false when a merge failed and regions are reported unmerged
    ms: number;
    phases: Record<string, number>;
    picked?: { kind: 'whole' | 'part' | 'skip'; area: number; dots: number; dens: number; cx: number; cy: number }[];
  };
}

type Box = [number, number, number, number];
type Seg = [number, number, number, number];

const C = (x: number, y: number) => new Coordinate(x, y);

function ringCoords(ring: LinearRing): [number, number][] {
  return ring.getCoordinates().map((c: Coordinate) => [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10] as [number, number]);
}

function inBox(x: number, y: number, b: Box): boolean {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

/** Distinct, non-degenerate segments inside the working area, rounded to the snap grid. */
function cleanSegments(segs: Float64Array, xmax: number, scale: number): Seg[] {
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    let x0 = Math.round(segs[i] * scale), y0 = Math.round(segs[i + 1] * scale);
    let x1 = Math.round(segs[i + 2] * scale), y1 = Math.round(segs[i + 3] * scale);
    if (x0 / scale > xmax || x1 / scale > xmax) continue;
    if (x0 === x1 && y0 === y1) continue;
    if (x1 < x0 || (x1 === x0 && y1 < y0)) { [x0, y0, x1, y1] = [x1, y1, x0, y0]; }
    const key = `${x0},${y0},${x1},${y1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x0 / scale, y0 / scale, x1 / scale, y1 / scale]);
  }
  return out;
}

/** Groups of dot indices whose grid cells lie within two cells of each other. */
function gridGroups(indices: Iterable<number>, dots: Float64Array, cell: number): number[][] {
  const key = (cx: number, cy: number) => cy * 65536 + cx;
  const cells = new Map<number, number[]>();
  for (const i of indices) {
    const k = key(Math.floor(dots[i] / cell), Math.floor(dots[i + 1] / cell));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const members: number[] = [];
    while (queue.length) {
      const k = queue.pop()!;
      const cx = k % 65536, cy = Math.floor(k / 65536);
      members.push(...cells.get(k)!);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nk = key(cx + dx, cy + dy);
        if (!seen.has(nk) && cells.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    groups.push(members);
  }
  return groups;
}

/** Hatch dots grouped into working boxes, with artwork-density dots dropped. */
function clusterDots(dots: Float64Array, p: { cell: number; maxDensity: number; pad: number; minDots: number; xmax: number; exclude: Box[] }) {
  const cell = p.cell;
  const key = (cx: number, cy: number) => cy * 65536 + cx;
  const cells = new Map<number, number[]>();
  let dropped = 0;
  for (let i = 0; i < dots.length; i += 2) {
    const x = dots[i], y = dots[i + 1];
    if (x > p.xmax || p.exclude.some((z) => inBox(x, y, z))) { dropped++; continue; }
    const k = key(Math.floor(x / cell), Math.floor(y / cell));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  // Artwork: cells far denser than any hatch, plus a two-cell margin around them.
  const maxPerCell = p.maxDensity * cell * cell / 1000;
  const poison = new Set<number>();
  for (const [k, list] of cells) {
    if (list.length <= maxPerCell) continue;
    const cx = k % 65536, cy = Math.floor(k / 65536);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poison.add(key(cx + dx, cy + dy));
  }
  const kept: number[] = [];
  for (const [k, list] of cells) { if (poison.has(k)) dropped += list.length; else kept.push(...list); }
  const clusters: { dots: number[]; box: Box }[] = [];
  for (const members of gridGroups(kept, dots, cell)) {
    if (members.length < p.minDots) { dropped += members.length; continue; }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const i of members) { minx = Math.min(minx, dots[i]); miny = Math.min(miny, dots[i + 1]); maxx = Math.max(maxx, dots[i]); maxy = Math.max(maxy, dots[i + 1]); }
    clusters.push({ dots: members, box: [minx - p.pad, miny - p.pad, maxx + p.pad, maxy + p.pad] });
  }
  // Merge overlapping working boxes so each face is examined once.
  const boxes: { dots: number[]; box: Box }[] = [];
  for (const c of clusters) {
    let cur = c;
    for (;;) {
      const i = boxes.findIndex((b) => b.box[0] <= cur.box[2] && cur.box[0] <= b.box[2] && b.box[1] <= cur.box[3] && cur.box[1] <= b.box[3]);
      if (i < 0) break;
      const [b] = boxes.splice(i, 1);
      cur = { dots: [...b.dots, ...cur.dots], box: [Math.min(b.box[0], cur.box[0]), Math.min(b.box[1], cur.box[1]), Math.max(b.box[2], cur.box[2]), Math.max(b.box[3], cur.box[3])] };
    }
    boxes.push(cur);
  }
  return { boxes, dropped };
}

/** Faces enclosed by the linework in one working box. */
function facesIn(segs: Seg[], box: Box, gf: GeometryFactory, scale: number, minFace: number): Polygon[] {
  const lines = new ArrayList();
  for (const [x0, y0, x1, y1] of segs) {
    if (Math.max(x0, x1) < box[0] || Math.min(x0, x1) > box[2] || Math.max(y0, y1) < box[1] || Math.min(y0, y1) > box[3]) continue;
    lines.add(gf.createLineString([C(x0, y0), C(x1, y1)]));
  }
  if (lines.size() === 0) return [];
  const noded = new GeometryNoder(gf.getPrecisionModel()).node(lines).toArray() as LineString[];
  // Back to the grid (the noder leaves floating-point noise), then distinct segments only.
  const seen = new Set<string>();
  const pieces: LineString[] = [];
  for (const l of noded) {
    const cs = l.getCoordinates();
    for (let i = 1; i < cs.length; i++) {
      let x0 = Math.round(cs[i - 1].x * scale), y0 = Math.round(cs[i - 1].y * scale);
      let x1 = Math.round(cs[i].x * scale), y1 = Math.round(cs[i].y * scale);
      if (x0 === x1 && y0 === y1) continue;
      if (x1 < x0 || (x1 === x0 && y1 < y0)) { [x0, y0, x1, y1] = [x1, y1, x0, y0]; }
      const key = `${x0},${y0},${x1},${y1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push(gf.createLineString([C(x0 / scale, y0 / scale), C(x1 / scale, y1 / scale)]));
    }
  }
  const pz = new Polygonizer();
  pz.add(gf.createMultiLineString(pieces));
  return (pz.getPolygons().toArray() as Polygon[]).filter((f) => f.getArea() >= minFace);
}

export function detect(segs: Float64Array, dots: Float64Array, p: DetectParams): DetectResult {
  const t0 = Date.now();
  let tp = t0;
  const phases: Record<string, number> = {};
  const lap = (name: string) => { const now = Date.now(); phases[name] = (phases[name] ?? 0) + now - tp; tp = now; };

  const xmax = p.xmax ?? p.width;
  const scale = p.gridScale ?? 10;
  const exclude: Box[] = p.exclude ?? [];
  const gf = new GeometryFactory(new PrecisionModel(scale));
  const cleaned = cleanSegments(segs, xmax, scale);
  lap('segments');
  const { boxes, dropped } = clusterDots(dots, { cell: p.cell ?? 24, maxDensity: p.maxDensity ?? 200, pad: p.pad ?? 240, minDots: p.wholeDots, xmax, exclude });
  lap('clusters');
  const excludedZones: Geometry[] = exclude.map(([x0, y0, x1, y1]) => gf.toGeometry(new Envelope(x0, x1, y0, y1)));

  const regions: DetectedRegion[] = [];
  const picked: NonNullable<DetectResult['stats']['picked']> = [];
  const note = (kind: 'whole' | 'part' | 'skip', f: Polygon, n: number, dens: number) => { if (p.debug) { const c = f.getCentroid(); picked.push({ kind, area: f.getArea(), dots: n, dens, cx: Math.round(c.getX()), cy: Math.round(c.getY()) }); } };
  let faceCount = 0, dotCount = 0, merged = true;
  for (const { dots: members, box } of boxes) {
    let faces: Polygon[];
    try {
      faces = facesIn(cleaned, box, gf, scale, p.minFace);
    } catch (e) {
      console.warn('stucco: noding failed in a working box, skipped', box, e);
      continue;
    }
    faceCount += faces.length;
    lap('faces');
    const tree = new STRtree();
    for (const i of members) {
      const pt = gf.createPoint(C(dots[i], dots[i + 1]));
      tree.insert(pt.getEnvelopeInternal(), { i, pt });
    }
    dotCount += members.length;
    const inFace = new Set<number>();

    const whole: Geometry[] = [];
    const partial: Geometry[] = [];
    for (const f of faces) {
      if (excludedZones.some((z) => z.contains(f.getCentroid()))) continue;
      const candidates = tree.query(f.getEnvelopeInternal()).toArray() as { i: number; pt: ReturnType<typeof gf.createPoint> }[];
      if (!candidates.length) continue;
      const locator = new IndexedPointInAreaLocator(f);   // jsts' PreparedPolygon constructor is broken, this is what it uses
      const inside = candidates.filter((d) => locator.locate(d.pt.getCoordinate()) === Location.INTERIOR).map((d) => d.pt);
      for (const d of candidates) if (locator.locate(d.pt.getCoordinate()) !== Location.EXTERIOR) inFace.add(d.i);
      const n = inside.length;
      if (!n) continue;
      const dens = n / (f.getArea() / 1000);
      if (n >= p.wholeDots && dens >= p.wholeDensity) { whole.push(f); note('whole', f, n, dens); continue; }
      if (n < p.partDots || dens < p.partDensity) { if (n >= p.wholeDots) note('skip', f, n, dens); continue; }
      {
        note('part', f, n, dens);
        const hullPts = concaveman(inside.map((pt) => [pt.getX(), pt.getY()]), 2, 0) as [number, number][];
        if (hullPts.length < 4) continue;
        try {
          const hull = gf.createPolygon(gf.createLinearRing(hullPts.map(([x, y]) => C(x, y))), []).buffer(p.hullPad);
          const clipped = hull.intersection(f);
          if (!clipped.isEmpty()) partial.push(clipped);
        } catch (e) {
          console.warn('stucco: hull clip failed, face skipped', e);
        }
      }
    }
    // Hatch that no face encloses (an open outline): take the hull of each dot group.
    const orphans = members.filter((i) => !inFace.has(i));
    if (orphans.length >= p.partDots) {
      for (const group of gridGroups(orphans, dots, p.cell ?? 24)) {
        if (group.length < p.partDots) continue;
        const hullPts = concaveman(group.map((i) => [dots[i], dots[i + 1]]), 2, 0) as [number, number][];
        if (hullPts.length < 4) continue;
        try {
          const hull = gf.createPolygon(gf.createLinearRing(hullPts.map(([x, y]) => C(x, y))), []);
          const dens = group.length / (hull.getArea() / 1000);
          if (hull.getArea() < p.minFace || dens < p.partDensity) continue;
          partial.push(hull.buffer(p.hullPad));
          if (p.debug) { const c = hull.getCentroid(); picked.push({ kind: 'part', area: hull.getArea(), dots: group.length, dens, cx: Math.round(c.getX()), cy: Math.round(c.getY()) }); }
        } catch (e) {
          console.warn('stucco: hull of unenclosed hatch failed, skipped', e);
        }
      }
    }
    lap('pick');

    const chosen = [...whole, ...partial];
    if (!chosen.length) continue;
    let polys: Geometry[] = [];
    try {
      const union = UnaryUnionOp.union(gf.createGeometryCollection(chosen));
      for (let i = 0; i < union.getNumGeometries(); i++) polys.push(union.getGeometryN(i));
    } catch (e) {
      console.warn('stucco: merge failed, regions reported unmerged', e);
      merged = false;
      polys = chosen.flatMap((g) => { const out: Geometry[] = []; for (let i = 0; i < g.getNumGeometries(); i++) out.push(g.getGeometryN(i)); return out; });
    }
    for (const g of polys) {
      if (!(g instanceof Polygon) || g.getArea() < p.minFace) continue;
      let shell: Polygon = g;
      try { const s = DouglasPeuckerSimplifier.simplify(g, p.simplify); if (s instanceof Polygon && !s.isEmpty()) shell = s; } catch { /* keep the unsimplified face */ }
      const gross = gf.createPolygon(shell.getExteriorRing(), []).getArea();
      const holes: [number, number][][] = [];
      let holeArea = 0;
      for (let h = 0; h < shell.getNumInteriorRing(); h++) {
        const ring = shell.getInteriorRingN(h);
        const area = gf.createPolygon(ring, []).getArea();
        if (area >= p.minHole) { holes.push(ringCoords(ring)); holeArea += area; }
      }
      regions.push({
        exterior: ringCoords(shell.getExteriorRing()), holes, grossArea: gross, netArea: gross - holeArea,
        clipped: partial.some((c) => c.intersects(g)) && !whole.some((w) => g.within(w.buffer(0.5))),
      });
    }
    lap('merge');
  }
  regions.sort((a, b) => b.netArea - a.netArea);
  return { regions, stats: { segments: cleaned.length, dots: dotCount, dotsDropped: dropped, clusters: boxes.length, faces: faceCount, merged, ms: Date.now() - t0, phases, picked: p.debug ? picked : undefined } };
}
