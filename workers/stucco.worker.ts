// Stucco region detection, run off the main thread. The geometry lives in utils/stuccoGeometry.ts.
import { detect, DetectParams } from '../utils/stuccoGeometry';

export type { DetectParams, DetectResult, DetectedRegion } from '../utils/stuccoGeometry';

self.onmessage = (e: MessageEvent<{ segs: Float64Array; dots: Float64Array; params: DetectParams }>) => {
  try {
    const { segs, dots, params } = e.data;
    (self as unknown as Worker).postMessage({ ok: true, result: detect(segs, dots, params) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
