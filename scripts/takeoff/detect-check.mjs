// Runs the in-app stucco detector in Node on a PDF page, for checks against the Python pipeline.
// usage: npm run bundle:stucco && node scripts/takeoff/detect-check.mjs <sheet.pdf> [page=1] [xmax] [ppu=18]
import fs from 'fs';
import * as mupdf from 'mupdf';
import { extractPageVectors } from '../../.bundles/stuccoVectors.mjs';
import { detect } from '../../.bundles/stuccoGeometry.mjs';

const [, , pdf, pageArg = '1', xmaxArg, ppuArg = '18', padArg] = process.argv;
const doc = mupdf.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
const page = doc.loadPage(Number(pageArg) - 1);
const t0 = Date.now();
const v = extractPageVectors(page);
const tExtract = Date.now() - t0;
const ppu = Number(ppuArg); const sq = ppu * ppu;
const params = { width: v.width, height: v.height, xmax: xmaxArg ? Number(xmaxArg) : undefined, minFace: 0.5 * sq, minHole: 1.25 * sq, wholeDots: 4, wholeDensity: 2.0, partDots: 8, partDensity: 0.4, hullPad: 6, simplify: 1.5, pad: padArg ? Number(padArg) : undefined, debug: !!process.env.DEBUG_FACES };
const r = detect(v.segs, v.dots, params);
const total = r.regions.reduce((s, x) => s + x.netArea, 0) / sq;
console.log(`${pdf} p.${pageArg}: extract ${tExtract} ms (${v.segs.length / 4} segs, ${v.dots.length / 2} dots); detect ${r.stats.ms} ms ${JSON.stringify(r.stats.phases)}; ${r.stats.segments} clean segs, ${r.stats.dots} dots kept (${r.stats.dotsDropped} dropped), ${r.stats.clusters} clusters, ${r.stats.faces} faces, merged=${r.stats.merged}`);
console.log(`regions: ${r.regions.length}, net total ${total.toFixed(1)} sq units`);
if (r.stats.picked) for (const f of r.stats.picked) console.log(`   face ${f.kind} ${(f.area / sq).toFixed(1)} sq, ${f.dots} dots, ${f.dens.toFixed(2)}/1000 at ${f.cx},${f.cy}`);
for (const x of r.regions.slice(0, 12)) console.log(`   ${(x.netArea / sq).toFixed(1)} net (gross ${(x.grossArea / sq).toFixed(1)}, ${x.holes.length} holes${x.clipped ? ', clipped' : ''}) at ~${Math.round(x.exterior[0][0])},${Math.round(x.exterior[0][1])}`);

if (process.env.DETECT_JSON) fs.writeFileSync(process.env.DETECT_JSON, JSON.stringify({ width: v.width, height: v.height, regions: r.regions, segs: Array.from(v.segs), dots: Array.from(v.dots) }));
