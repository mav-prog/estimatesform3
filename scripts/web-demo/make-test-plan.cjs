// Generates a synthetic elevation sheet with known dimensions for verifying
// scale calibration and area/linear math headlessly.
// Sheet: 36 x 24 in landscape. Scale 1/4" = 1'-0" => 1 ft = 18 pt.
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2592, 1728]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const FT = 18;
  const ox = 360, oy = 520;
  const black = rgb(0, 0, 0);

  // Border and title block
  page.drawRectangle({ x: 36, y: 36, width: 2592 - 72, height: 1728 - 72, borderColor: black, borderWidth: 3 });
  page.drawRectangle({ x: 2592 - 36 - 560, y: 36, width: 560, height: 140, borderColor: black, borderWidth: 2 });
  page.drawText('STUCCO TEST SHEET', { x: 2592 - 36 - 540, y: 130, size: 26, font: bold });
  page.drawText('A-201  EAST ELEVATION', { x: 2592 - 36 - 540, y: 92, size: 20, font });
  page.drawText('SCALE: 1/4" = 1\'-0"', { x: 2592 - 36 - 540, y: 58, size: 20, font });

  // Wall: 40 ft wide x 10 ft tall (400 sq ft gross)
  page.drawRectangle({ x: ox, y: oy, width: 40 * FT, height: 10 * FT, borderColor: black, borderWidth: 3 });
  // Grade line
  page.drawLine({ start: { x: ox - 60, y: oy }, end: { x: ox + 40 * FT + 60, y: oy }, thickness: 4, color: black });

  // Openings (x, y, w, h in ft from wall origin): two 4x3 windows, one 3x7 door => 45 sq ft
  const openings = [
    { x: 6, y: 4, w: 4, h: 3, label: 'W1' },
    { x: 24, y: 4, w: 4, h: 3, label: 'W2' },
    { x: 16, y: 0, w: 3, h: 7, label: 'D1' },
  ];
  for (const o of openings) {
    page.drawRectangle({ x: ox + o.x * FT, y: oy + o.y * FT, width: o.w * FT, height: o.h * FT, borderColor: black, borderWidth: 2 });
    page.drawText(o.label, { x: ox + o.x * FT + 6, y: oy + o.y * FT + o.h * FT - 22, size: 16, font });
  }

  // Dimension line: overall 40'-0" above the wall
  const dy = oy + 10 * FT + 50;
  page.drawLine({ start: { x: ox, y: dy }, end: { x: ox + 40 * FT, y: dy }, thickness: 1.5, color: black });
  for (const x of [ox, ox + 40 * FT]) page.drawLine({ start: { x, y: dy - 10 }, end: { x, y: dy + 10 }, thickness: 1.5, color: black });
  page.drawText('40\'-0"', { x: ox + 20 * FT - 30, y: dy + 14, size: 18, font });

  // Height dimension: 10'-0" at right
  const dx = ox + 40 * FT + 50;
  page.drawLine({ start: { x: dx, y: oy }, end: { x: dx, y: oy + 10 * FT }, thickness: 1.5, color: black });
  for (const y of [oy, oy + 10 * FT]) page.drawLine({ start: { x: dx - 10, y }, end: { x: dx + 10, y }, thickness: 1.5, color: black });
  page.drawText('10\'-0"', { x: dx + 14, y: oy + 5 * FT - 6, size: 18, font });

  // Graphic scale bar: 20 ft, below the grade line
  const sy = oy - 110;
  page.drawLine({ start: { x: ox, y: sy }, end: { x: ox + 20 * FT, y: sy }, thickness: 3, color: black });
  for (const x of [ox, ox + 10 * FT, ox + 20 * FT]) page.drawLine({ start: { x, y: sy - 12 }, end: { x, y: sy + 12 }, thickness: 2, color: black });
  page.drawText('0', { x: ox - 5, y: sy - 34, size: 14, font });
  page.drawText('10\'', { x: ox + 10 * FT - 10, y: sy - 34, size: 14, font });
  page.drawText('20\'', { x: ox + 20 * FT - 10, y: sy - 34, size: 14, font });
  page.drawText('GRAPHIC SCALE (FEET)', { x: ox, y: sy - 60, size: 14, font });

  page.drawText('EAST ELEVATION', { x: ox, y: oy + 10 * FT + 110, size: 28, font: bold });
  page.drawText('3-COAT STUCCO OVER LATH, TYP.  DEDUCT ALL OPENINGS.', { x: ox, y: oy + 10 * FT + 80, size: 16, font });

  const out = process.argv[2];
  fs.writeFileSync(out, await doc.save());
  console.log('wrote', out, 'expected: gross 400 sq ft, openings 45 sq ft, net 355 sq ft, top edge 40 ft, scale bar 20 ft = 360 pt');
})().catch(e => { console.error(e); process.exit(1); });
