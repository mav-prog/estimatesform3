import * as mupdf from 'mupdf';
import fs from 'fs';
const doc = mupdf.Document.openDocument(fs.readFileSync(process.argv[2]), 'application/pdf');
const page = doc.loadPage(0);
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const dots = [];
const device = new mupdf.Device({
  strokePath(path, stroke, ctm) {
    let pts = [];
    path.walk({ moveTo(x, y) { pts.push(apply(ctm, x, y)); }, lineTo(x, y) { pts.push(apply(ctm, x, y)); }, curveTo(a, b, c, d, x, y) { pts.push(apply(ctm, x, y)); pts.push(null); }, closePath() {} });
    if (pts.length === 2 && pts[1] && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) < 0.05 && pts[0][0] <= 2300) dots.push(pts[0]);
  },
});
page.run(device, mupdf.Matrix.identity); device.close();
const xs = dots.map(p => p[0]), ys = dots.map(p => p[1]);
console.log('dots (x<=2300):', dots.length, 'bbox', [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => Math.round(v)));
