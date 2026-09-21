// Opens a .takeoff project in the ProTakeoff web build and records what the app shows.
// usage: NODE_PATH=$(npm root -g) node scripts/web-demo/open-takeoff.cjs <project.takeoff> <outDir>
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
  const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 }, acceptDownloads: true })).newPage();
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name) }); console.log('screenshot', name); };
  try {
    await page.goto(APP, { waitUntil: 'load' });
    await sleep(1500);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      page.locator('button:has(svg.lucide-folder-open)').first().click(),
    ]);
    await chooser.setFiles(takeoffPath);
    await page.getByRole('button', { name: /^Import Project$/ }).click();
    await page.getByText(/Project imported successfully/).first().waitFor({ timeout: 300000 });
    await waitForCanvas(page);
    await sleep(3000);
    const project = await page.evaluate(() => window.__protakeoffWebState.project);
    const pages = project.totalPages;
    for (let p = 0; p < pages; p++) {
      if (p > 0) { await page.keyboard.press('PageDown'); await sleep(2500); await waitForCanvas(page); await sleep(2000); }
      await shot(`page-${p + 1}.png`);
    }
    fs.writeFileSync(path.join(outDir, 'items.json'), JSON.stringify(project.items, null, 2));
    for (const it of project.items) console.log(`ITEM ${it.label}: ${it.totalValue.toFixed(2)} ${it.unit} (${it.shapes.length} shapes, ${it.shapes.filter((s) => s.deduction).length} cutouts)`);
    await page.getByRole('button', { name: /Estimates/ }).click(); await sleep(1500); await shot('estimates.png');
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Export to Excel/ }).click()]);
      await dl.saveAs(path.join(outDir, 'Project_Estimates.xlsx')); console.log('saved Project_Estimates.xlsx');
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
main();
