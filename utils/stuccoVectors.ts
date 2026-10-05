// Vector extraction for stucco detection: linework segments and hatch dots from a page,
// read through MuPDF's device callbacks. Coordinates are page display points (rotation
// applied, origin top-left), the same space ProTakeoff stores shapes in.
import * as mupdf from 'mupdf';

export interface PageVectors {
  segs: Float64Array;   // x0, y0, x1, y1, ...
  dots: Float64Array;   // x, y, ...
  width: number;
  height: number;
}

type Pt = [number, number];
const apply = (m: number[], x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
              u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}

/** Walk every stroked path on the page, keeping linework and the zero-length dot strokes. */
export function extractPageVectors(page: { run(device: unknown, matrix: number[]): void; getBounds(): number[] }, minSize = 2.5): PageVectors {
  const segs: number[] = [];
  const dots: number[] = [];
  const bounds = page.getBounds();
  const collect = (path: { walk(w: Record<string, unknown>): void }, ctm: number[], color: number[] | undefined) => {
    if (color && color.length === 3 && Math.abs(color[0] - 0.9) < 0.02 && Math.abs(color[1] - 0.9) < 0.02 && Math.abs(color[2] - 0.9) < 0.02) return; // watermark outlines
    const pts: Pt[] = [];          // polyline in page space, null breaks not needed: moveTo starts a new run
    const runs: Pt[][] = [];
    let cur: Pt | null = null;
    let start: Pt | null = null;
    let run: Pt[] = [];
    const flush = () => { if (run.length > 1) runs.push(run); run = []; };
    path.walk({
      moveTo(x: number, y: number) { flush(); cur = apply(ctm, x, y); start = cur; run = [cur]; pts.push(cur); },
      lineTo(x: number, y: number) { const p = apply(ctm, x, y); if (!cur) { cur = p; start = p; run = [p]; } else { run.push(p); cur = p; } pts.push(p); },
      curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
        const c1 = apply(ctm, x1, y1), c2 = apply(ctm, x2, y2), p3 = apply(ctm, x3, y3);
        if (!cur) { cur = p3; start = p3; run = [p3]; pts.push(p3); return; }
        for (const p of bezier(cur, c1, c2, p3)) { run.push(p); pts.push(p); }
        cur = p3;
      },
      closePath() { if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) { run.push(start); pts.push(start); } cur = start; },
    });
    flush();
    if (pts.length === 0) return;
    // A dot: a single move + line of zero length.
    if (pts.length === 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) < 0.05) { dots.push(pts[0][0], pts[0][1]); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    if (Math.max(maxX - minX, maxY - minY) < minSize) return;   // glyph strokes and hatch fragments
    for (const r of runs) for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      if (a[0] !== b[0] || a[1] !== b[1]) segs.push(a[0], a[1], b[0], b[1]);
    }
  };
  const device = new mupdf.Device({
    strokePath(path: unknown, _stroke: unknown, ctm: number[], _cs: unknown, color: number[]) { collect(path as { walk(w: Record<string, unknown>): void }, ctm, color); },
    fillPath(path: unknown, _evenOdd: boolean, ctm: number[], _cs: unknown, color: number[]) { collect(path as { walk(w: Record<string, unknown>): void }, ctm, color); },
  } as unknown as ConstructorParameters<typeof mupdf.Device>[0]);
  try {
    page.run(device, mupdf.Matrix.identity as unknown as number[]);
  } finally {
    (device as unknown as { close(): void }).close();
  }
  return { segs: Float64Array.from(segs), dots: Float64Array.from(dots), width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] };
}
