// Uploads raw sheets, calibrates each page at 1/4" = 1'-0" and runs the in-app stucco detector.
// usage: NODE_PATH=$(npm root -g) node scripts/web-demo/detect-ui.cjs <outDir> <sheet.pdf> [...]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const APP = 'http://127.0.0.1:3000/';
const SHEET = { w: 2592, h: 1728 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , outDir, ...pdfs] = process.argv;
const waitForCanvas = (page) => page.waitForFunction(() => !!Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content')), null, { timeout: 300000 });

async function toScreen(page, xPt, yPt) {
  return page.evaluate(([x, y, W, H]) => {
    const stage = window.Konva.stages[0]; const layer = stage.getChildren()[0];
    const big = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content'));
    const k = big.width / W; const abs = layer.getAbsoluteTransform().point({ x: x * k, y: (H - y) * k });
    const r = stage.container().getBoundingClientRect(); return { x: r.left + abs.x, y: r.top + abs.y };
  }, [xPt, yPt, SHEET.w, SHEET.h]);
}
async function clickPt(page, x, y) { const p = await toScreen(page, x, y); await page.mouse.move(p.x, p.y); await sleep(40); await page.mouse.click(p.x, p.y); await sleep(120); }
async function calibrate(page) {
  await page.locator('button:has(svg.lucide-ruler)').first().click();
  await page.getByRole('menuitem', { name: /Calibrate Scale/ }).click();
  await clickPt(page, 400, 60); await clickPt(page, 760, 60);
  await page.getByPlaceholder(/Length/).fill('20');
  await page.getByRole('button', { name: 'Set Scale' }).click();
  await page.getByText(/Scale calibrated/).first().waitFor({ timeout: 10000 }); await sleep(400);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 } })).newPage();
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(APP, { waitUntil: 'load' });
    await page.getByRole('button', { name: /Upload Plans/ }).click();
    await page.setInputFiles('input[type="file"]', pdfs);
    await page.getByRole('button', { name: /Start Project/ }).click();
    await page.getByText(/Added \d+ plan/).first().waitFor({ timeout: 300000 });
    await waitForCanvas(page); await sleep(2500);
    for (let p = 0; p < pdfs.length; p++) {
      if (p > 0) { await page.keyboard.press('PageDown'); await sleep(2500); await waitForCanvas(page); await sleep(1500); }
      await calibrate(page);
      const t = Date.now();
      await page.locator('button[aria-label="Detect stucco"]').click();
      const toast = page.getByText(/Detected \d+ stucco region|No stucco|detection failed/).first();
      await toast.waitFor({ timeout: 300000 });
      console.log(`page ${p + 1}: ${(await toast.textContent()).trim()}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
      await sleep(1500);
      await page.screenshot({ path: path.join(outDir, `detect-page-${p + 1}.png`) });
    }
    await sleep(2000);
    const project = await page.evaluate(() => window.__protakeoffWebState.project);
    fs.writeFileSync(path.join(outDir, 'items.json'), JSON.stringify(project.items, null, 2));
    for (const it of project.items) console.log(`ITEM ${it.label}: ${it.totalValue.toFixed(1)} ${it.unit} (${it.shapes.filter((s) => !s.deduction).length} regions, ${it.shapes.filter((s) => s.deduction).length} cutouts)`);
  } catch (e) {
    console.error('FAILED:', e.message);
    try { await page.screenshot({ path: path.join(outDir, 'error.png') }); } catch {}
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
    await browser.close();
  }
}
main();
