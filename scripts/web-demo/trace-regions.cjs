// Traces stucco regions found by scripts/takeoff/stucco_regions.py into the ProTakeoff web build.
// usage: NODE_PATH=$(npm root -g) node scripts/web-demo/trace-regions.cjs <outDir> <sheet.pdf=regions.json> [...]
// Each sheet is uploaded as one plan set (in the order given). Every page is calibrated by
// clicking two points 360 pt apart on the sheet and entering 20 ft (1/4" = 1'-0"). Regions are
// drawn as AREA shapes on one item per zone, with openings drawn as cutouts.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = 'http://127.0.0.1:3000/';
const SHEET = { w: 2592, h: 1728 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , outDir, ...pairs] = process.argv;
const sheets = pairs.map((p) => { const [pdf, json] = p.split('='); return { pdf, regions: JSON.parse(fs.readFileSync(json, 'utf8')).regions }; });

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true })).newPage();
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name) }); console.log('screenshot', name); };
  try {
    await page.goto(APP, { waitUntil: 'load' });
    await page.getByRole('button', { name: /Upload Plans/ }).click();
    await page.setInputFiles('input[type="file"]', sheets.map((s) => s.pdf));
    await page.getByRole('button', { name: /Start Project/ }).click();
    await page.getByText(/Added \d+ plan/).first().waitFor({ timeout: 300000 });
    await waitForCanvas(page); await sleep(2500);

    const items = new Map();   // zone -> created
    for (let p = 0; p < sheets.length; p++) {
      if (p > 0) { await page.keyboard.press('PageDown'); await sleep(2500); await waitForCanvas(page); await sleep(1500); }
      await calibrate(page);
      const zones = [...new Set(sheets[p].regions.map((r) => r.zone))];
      for (const zone of zones) {
        const regs = sheets[p].regions.filter((r) => r.zone === zone && r.net_sqft >= 1);
        if (!regs.length) continue;
        await page.locator('button:has(svg.lucide-vector-square)').first().click();
        await page.getByRole('menuitem', { name: /^Area/ }).click();
        await createItem(page, `Stucco - ${zone}`);
        for (const r of regs) {
          await polygon(page, thin(r.exterior));
          for (const h of r.holes) { await page.keyboard.press('x'); await sleep(150); await polygon(page, thin(h)); }
        }
        await page.keyboard.press('Escape'); await sleep(300);
      }
      await sleep(1500);
      await shot(`page-${p + 1}-traced.png`);
    }
    await sleep(2500);
    const project = await page.evaluate(() => window.__protakeoffWebState.project);
    fs.writeFileSync(path.join(outDir, 'items.json'), JSON.stringify(project.items, null, 2));
    for (const it of project.items) console.log(`ITEM ${it.label}: ${it.totalValue.toFixed(1)} ${it.unit} (${it.shapes.length} shapes, ${it.shapes.filter((s) => s.deduction).length} cutouts)`);
    await page.getByRole('button', { name: /Estimates/ }).click(); await sleep(1500); await shot('estimates.png');
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Export to Excel/ }).click()]);
      await dl.saveAs(path.join(outDir, 'Project_Estimates.xlsx'));
    } catch (e) { console.log('excel export not captured:', e.message); }
  } catch (e) {
    console.error('FAILED:', e.message);
    try { await page.screenshot({ path: path.join(outDir, 'error.png') }); } catch {}
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
    await browser.close();
  }
}

// Drop the closing duplicate and vertices closer than 6 pt to the previous kept one.
function thin(coords) {
  const pts = coords.slice(0, -1);
  const out = [];
  for (const p of pts) { if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >= 6) out.push(p); }
  return out.map(([x, y]) => [x, SHEET.h - y]);   // regions are top-left origin; the tracer expects y from the bottom
}

const waitForCanvas = (page) => page.waitForFunction(() => !!Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content')), null, { timeout: 300000 });

async function toScreen(page, xPt, yPt) {
  return page.evaluate(([x, y, W, H]) => {
    const stage = window.Konva.stages[0]; const layer = stage.getChildren()[0];
    const big = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content'));
    const k = big.width / W;
    const abs = layer.getAbsoluteTransform().point({ x: x * k, y: (H - y) * k });
    const r = stage.container().getBoundingClientRect();
    return { x: r.left + abs.x, y: r.top + abs.y, inView: abs.x >= 2 && abs.y >= 2 && abs.x <= r.width - 2 && abs.y <= r.height - 2 };
  }, [xPt, yPt, SHEET.w, SHEET.h]);
}

async function clickPt(page, xPt, yPt) {
  const p = await toScreen(page, xPt, yPt);
  if (!p.inView) throw new Error(`point (${xPt}, ${yPt}) is outside the viewport`);
  await page.mouse.move(p.x, p.y); await sleep(40); await page.mouse.click(p.x, p.y); await sleep(110);
}

async function calibrate(page) {
  await page.locator('button:has(svg.lucide-ruler)').first().click();
  await page.getByRole('menuitem', { name: /Calibrate Scale/ }).click();
  await clickPt(page, 400, 60); await clickPt(page, 760, 60);   // 360 pt apart along the bottom margin
  await page.getByPlaceholder(/Length/).fill('20');
  await page.getByRole('button', { name: 'Set Scale' }).click();
  await page.getByText(/Scale calibrated/).first().waitFor({ timeout: 10000 });
  await sleep(500);
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
  if (pts.length < 3) return;
  for (const [x, y] of pts) await clickPt(page, x, y);
  await page.keyboard.press('Enter'); await sleep(350);
}

main();
