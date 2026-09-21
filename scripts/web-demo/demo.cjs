// Drives the ProTakeoff web build in headless Chromium.
// usage (Playwright must be resolvable, e.g. NODE_PATH=$(npm root -g)): node scripts/web-demo/demo.cjs <pdf> <outDir> <synthetic|survey> [maxPages]
//   synthetic: full measured workflow on the generated test sheet (known answers)
//   survey:    load real plans and screenshot each page
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , pdfPath, outDir, mode = 'survey', maxPagesArg = '12'] = process.argv;
const APP = 'http://127.0.0.1:3000/';
const SHEET = { w: 2592, h: 1728 }; // synthetic sheet size in PDF points
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const log = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') log.push(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name) }); console.log('screenshot', name); };

  try {
    await page.goto(APP, { waitUntil: 'load' });
    await page.getByRole('button', { name: /Upload Plans/ }).click();
    await page.setInputFiles('input[type="file"]', pdfPath);
    await page.getByRole('button', { name: /Start Project/ }).click();
    await page.getByText(/Added \d+ plan/).first().waitFor({ timeout: 240000 });
    await waitForPageImage(page);
    await sleep(2500);
    await shot('01-loaded.png');
    const project = await readProject(page);
    console.log('plan sets:', JSON.stringify((project?.planSetsMeta || []).map((p) => ({ name: p.name, pages: p.pageCount }))));
    console.log('layer:', JSON.stringify(await page.evaluate(() => { const l = window.Konva.stages[0].getChildren()[0]; const big = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content')); return { scale: +l.scaleX().toFixed(4), x: l.x(), y: l.y(), pageCanvas: big && [big.width, big.height] }; })));

    if (mode === 'synthetic') await syntheticFlow(page, shot);
    else await surveyFlow(page, shot, project, parseInt(maxPagesArg, 10));
  } catch (e) {
    console.error('FAILED:', e.message);
    try { await page.screenshot({ path: path.join(outDir, 'error.png') }); } catch {}
    try { console.error('body text head:', (await page.evaluate(() => document.body.innerText)).slice(0, 600)); } catch {}
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
    console.log(`console log entries: ${log.length}`);
    await browser.close();
  }
}

const readProject = (page) => page.evaluate(() => (window.__protakeoffWebState ? window.__protakeoffWebState.project : null));

const waitForPageImage = (page) => page.waitForFunction(() => {
  const big = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content'));
  return !!big;
}, null, { timeout: 240000 });

// PDF point (x from left, y from bottom) -> screen pixel. The page is drawn on a plain
// canvas whose pixel size is a multiple of the PDF size; the Konva layer above it carries
// the zoom/pan transform for that same pixel space.
async function toScreen(page, xPt, yPt) {
  return page.evaluate(([x, y, W, H]) => {
    const stage = window.Konva.stages[0];
    const layer = stage.getChildren()[0];
    const big = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content'));
    const k = big.width / W;
    const abs = layer.getAbsoluteTransform().point({ x: x * k, y: (H - y) * k });
    const r = stage.container().getBoundingClientRect();
    return { x: r.left + abs.x, y: r.top + abs.y, inView: abs.x >= 2 && abs.y >= 2 && abs.x <= r.width - 2 && abs.y <= r.height - 2 };
  }, [xPt, yPt, SHEET.w, SHEET.h]);
}

async function ensureInView(page, points) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const checks = await Promise.all(points.map(([x, y]) => toScreen(page, x, y)));
    if (checks.every((c) => c.inView)) return;
    await page.keyboard.press('-');
    await sleep(400);
  }
  throw new Error('target points never fit in the viewport');
}

async function clickPt(page, xPt, yPt) {
  const p = await toScreen(page, xPt, yPt);
  await page.mouse.move(p.x, p.y);
  await sleep(60);
  await page.mouse.click(p.x, p.y);
  await sleep(150);
}

async function createItem(page, label) {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10000 });
  await dialog.locator('input').first().fill(label);
  await dialog.getByRole('button', { name: /Create Item/ }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await sleep(300);
}

async function polygon(page, pts) {
  for (const [x, y] of pts) await clickPt(page, x, y);
  await page.keyboard.press('Enter');
  await sleep(400);
}

async function syntheticFlow(page, shot) {
  const ox = 360; const oy = 520; const FT = 18; const sy = oy - 110;
  const wall = [[0, 0], [40, 0], [40, 10], [0, 10]].map(([x, y]) => [ox + x * FT, oy + y * FT]);
  await ensureInView(page, [...wall, [ox, sy], [ox + 20 * FT, sy]]);

  // 1. Calibrate on the 20 ft graphic scale bar.
  await page.locator('button:has(svg.lucide-ruler)').first().click();
  await page.getByRole('menuitem', { name: /Calibrate Scale/ }).click();
  await clickPt(page, ox, sy);
  await clickPt(page, ox + 20 * FT, sy);
  await page.getByPlaceholder(/Length/).fill('20');
  await page.getByRole('button', { name: 'Set Scale' }).click();
  await page.getByText(/Scale calibrated/).first().waitFor({ timeout: 10000 });
  await shot('02-calibrated.png');

  // 2. Stucco wall area with three cutouts (two windows, one door).
  await page.locator('button:has(svg.lucide-vector-square)').first().click();
  await page.getByRole('menuitem', { name: /^Area/ }).click();
  await createItem(page, 'Stucco - East Elevation');
  await polygon(page, wall);
  const openings = [[6, 4, 4, 3], [24, 4, 4, 3], [16, 0, 3, 7]];
  for (const [x, y, w, h] of openings) {
    await page.keyboard.press('x'); // cutout mode for the active item
    await sleep(200);
    await polygon(page, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => [ox + a * FT, oy + b * FT]));
  }
  await shot('03-area-with-cutouts.png');

  // 3. Linear item along the 40 ft top edge.
  await page.locator('button:has(svg.lucide-waypoints)').first().click();
  await createItem(page, 'Trim - Top Edge');
  await polygon(page, [[ox, oy + 10 * FT], [ox + 40 * FT, oy + 10 * FT]]);

  // 4. Count item: one click per opening.
  await page.locator('button:has(svg.lucide-hash)').first().click();
  await createItem(page, 'Openings');
  for (const [x, y, w, h] of openings) await clickPt(page, ox + (x + w / 2) * FT, oy + (y + h / 2) * FT);
  await page.keyboard.press('Enter');
  await sleep(2500);
  await shot('04-all-measurements.png');

  const project = await readProject(page);
  const items = (project?.items || []).map((it) => ({
    label: it.label, type: it.type, unit: it.unit, totalValue: +Number(it.totalValue).toFixed(3),
    shapes: it.shapes.length, deductions: it.shapes.filter((s) => s.deduction).length,
    shapeValues: it.shapes.map((s) => (s.deduction ? '-' : '') + Number(s.value).toFixed(2)),
  }));
  console.log('ITEMS ' + JSON.stringify(items, null, 1));
  fs.writeFileSync(path.join(outDir, 'items.json'), JSON.stringify(project?.items || [], null, 2));

  // 5. Estimates view and Excel export.
  await page.getByRole('button', { name: /Estimates/ }).click();
  await sleep(1500);
  await shot('05-estimates.png');
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Export to Excel/ }).click(),
    ]);
    await dl.saveAs(path.join(outDir, 'Project_Estimates.xlsx'));
    console.log('saved Project_Estimates.xlsx');
  } catch (e) { console.log('excel export not captured:', e.message); }

  // 6. Back to the canvas, then the markup PDF export.
  const back = page.getByRole('button', { name: /Back|Canvas|Takeoff/ }).first();
  if (await back.isVisible().catch(() => false)) await back.click();
  else { await page.keyboard.press('F12'); await sleep(800); await page.keyboard.press('F12'); }
  await sleep(1200);
  try {
    await page.getByRole('button', { name: /^Export$/ }).click();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /Export PDF/ }).click(),
    ]);
    await dl.saveAs(path.join(outDir, 'Markup.pdf'));
    console.log('saved Markup.pdf');
  } catch (e) { console.log('markup export not captured:', e.message); }
  await shot('06-final.png');
}

async function surveyFlow(page, shot, project, maxPages) {
  const total = project?.totalPages || 1;
  const n = Math.min(total, maxPages);
  console.log(`survey: ${total} pages, capturing ${n}`);
  for (let i = 0; i < n; i++) {
    if (i > 0) { await page.keyboard.press('PageDown'); await sleep(3000); await waitForPageImage(page); await sleep(1500); }
    await shot(`page-${String(i + 1).padStart(2, '0')}.png`);
  }
}

main();
