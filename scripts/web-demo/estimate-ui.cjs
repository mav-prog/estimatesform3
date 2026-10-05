// Opens a .takeoff project, prices it on the M3 Estimate tab, and captures the generated PDF.
// usage: NODE_PATH=$(npm root -g) node scripts/web-demo/estimate-ui.cjs <project.takeoff> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const APP = 'http://127.0.0.1:3000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , takeoffPath, outDir] = process.argv;
const waitForCanvas = (page) => page.waitForFunction(() => !!Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 1000 && !c.closest('.konvajs-content')), null, { timeout: 300000 });

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1100 }, acceptDownloads: true })).newPage();
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name), fullPage: true }); console.log('screenshot', name); };
  try {
    await page.goto(APP, { waitUntil: 'load' }); await sleep(1500);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.locator('button:has(svg.lucide-folder-open)').first().click()]);
    await chooser.setFiles(takeoffPath);
    await page.getByRole('button', { name: /^Import Project$/ }).click();
    await page.getByText(/Project imported successfully/).first().waitFor({ timeout: 300000 });
    await waitForCanvas(page); await sleep(1500);

    await page.getByRole('button', { name: /Estimates/ }).click(); await sleep(800);
    await page.getByRole('button', { name: /M3 Estimate/ }).click(); await sleep(1200);

    const fill = async (label, value) => { await page.locator(`label:text-is("${label}") + input, label:text-is("${label}") + textarea`).first().fill(value); };
    await page.getByPlaceholder('Contact name').fill('John Verdier');
    await fill('Company', 'Charvold Homes & Properties');
    await fill('Email', 'john@charvoldhomes.com');
    await fill('Phone', '817-707-1118');
    await fill('Project (job address and description)', "1325 Park St. Exterior stucco per elevations A3-A4 (The Sher'a, Plan No. 3691, David E. Wiggins Architect); game room excluded.");
    await fill('Scope summary', '3-coat cement stucco over metal lath on all exterior stucco surfaces shown on the Front, Right, Left and Rear elevations, net of openings and stone veneer; work above 12 ft included.');
    await fill('Extra exclusions', 'The crossed-out game room is excluded. Courtyard-facing walls shown on the building sections are not included.');
    await page.locator('input[type="date"]').fill('2026-09-21');

    // Interior wall stays unpriced; add the high-work line.
    await page.locator('select[aria-label^="Rate line for Interior"]').selectOption('');
    await page.getByRole('button', { name: /Add a line/ }).click(); await sleep(300);
    const lastRow = page.locator('select[aria-label="Rate line"]').last().locator('xpath=ancestor::tr');
    await lastRow.locator('select').selectOption('HIGH_WORK');
    await lastRow.locator('input[type="number"]').first().fill('1114.4');
    await lastRow.locator('input[type="text"], input:not([type])').first().fill('Wall area above 12 ft from the elevation finish floor lines.');
    await sleep(800);
    const total = (await page.locator('[data-grand-total]').textContent()).trim();
    const estNo = (await page.locator('.font-mono').filter({ hasText: /^M3-/ }).first().textContent()).trim();
    console.log('GRAND TOTAL ON SCREEN:', total, '| estimate', estNo);
    await shot('m3-estimate-panel.png');

    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('[data-generate-estimate]').click()]);
    const out = path.join(outDir, dl.suggestedFilename() || 'estimate.pdf');
    await dl.saveAs(out); console.log('saved', out);
    await page.getByText(/saved/).first().waitFor({ timeout: 10000 }).catch(() => {});
  } catch (e) {
    console.error('FAILED:', e.message);
    try { await page.screenshot({ path: path.join(outDir, 'error.png'), fullPage: true }); } catch {}
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
    await browser.close();
  }
}
main();
