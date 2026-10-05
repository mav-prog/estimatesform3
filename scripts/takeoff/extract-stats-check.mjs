import * as mupdf from 'mupdf';
import fs from 'fs';
const data = fs.readFileSync(process.argv[2]);
const doc = mupdf.Document.openDocument(data, 'application/pdf');
const page = doc.loadPage(0);
const bounds = page.getBounds();
let paths = 0, dots = 0, segs = 0, watermark = 0;
const dotBox = [Infinity, Infinity, -Infinity, -Infinity];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const device = new mupdf.Device({
  strokePath(path, stroke, ctm, cs, color) {
    paths++;
    const gray = color.length === 3 && Math.abs(color[0] - 0.9) < 0.02 && Math.abs(color[1] - 0.9) < 0.02;
    if (gray) watermark++;
    let cur = null, start = null, n = 0, first = null, last = null;
    path.walk({
      moveTo(x, y) { cur = apply(ctm, x, y); start = cur; first = first ?? cur; },
      lineTo(x, y) { const p = apply(ctm, x, y); if (cur) { segs++; n++; last = p; } cur = p; },
      curveTo(x1, y1, x2, y2, x3, y3) { const p = apply(ctm, x3, y3); segs += 6; n++; last = p; cur = p; },
      closePath() { if (cur && start) { segs++; n++; } cur = start; },
    });
    // a dot: one zero-length segment
    if (n === 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) {
      dots++;
      dotBox[0] = Math.min(dotBox[0], first[0]); dotBox[1] = Math.min(dotBox[1], first[1]);
      dotBox[2] = Math.max(dotBox[2], first[0]); dotBox[3] = Math.max(dotBox[3], first[1]);
    }
  },
  fillPath() { paths++; },
});
const t = Date.now();
page.run(device, mupdf.Matrix.identity);
device.close();
console.log(JSON.stringify({ bounds, paths, segs, dots, watermarkStrokes: watermark, dotBoxExcludingTitleBlock: null, ms: Date.now() - t }));
// dots outside the title block (x < 2300) for comparison with the Python pipeline (1649 on A3)
