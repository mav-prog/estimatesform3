// Runs stucco detection in a worker and returns regions in page points.
import type { DetectParams, DetectResult } from './stuccoGeometry';
import type { PageVectors } from './stuccoVectors';

export type { DetectParams, DetectResult, DetectedRegion } from './stuccoGeometry';

/** Default parameters: hatch spacing is a drawing property, so those stay in points;
 *  face and hole thresholds scale with the page's points-per-unit. */
export function defaultDetectParams(v: PageVectors, ppu: number): DetectParams {
  const sq = ppu * ppu;
  return {
    width: v.width, height: v.height,
    minFace: 0.5 * sq,          // half a square unit
    minHole: 1.25 * sq,         // smaller holes are hatch, fixtures or text, not openings
    wholeDots: 4, wholeDensity: 2.0,
    partDots: 8, partDensity: 0.4,
    hullPad: 6, simplify: 1.5,
  };
}

export function detectStuccoRegions(v: PageVectors, params: DetectParams): Promise<DetectResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/stucco.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: DetectResult; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result); else reject(new Error(e.data.error || 'Detection failed'));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Detection worker failed')); };
    worker.postMessage({ segs: v.segs, dots: v.dots, params }, [v.segs.buffer, v.dots.buffer]);
  });
}
