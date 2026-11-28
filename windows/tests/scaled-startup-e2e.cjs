const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'scaled-startup-'));
  const name = '多温度下的光谱校准与复测 — Repeated Spectrometer Measurements at 77 K and 298 K.pdf';
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(__dirname, 'mac-parity', 'rotated-spectrometer.pdf'), file);
  const id = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 0,
    autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly', ollamaBaseURL: 'http://127.0.0.1:9' }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const scale = Number(process.env.PAPERBRIDGE_DEVICE_SCALE || 1.75);
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--force-device-scale-factor=' + scale, '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, PAPERBRIDGE_WORKSPACE: dir, NODE_ENV: 'production' } });
  let app = await launch(), page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  async function geometry() {
    return app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0], bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return { bounds, work: display.workArea, scale: display.scaleFactor, minimum: win.getMinimumSize(),
        viewport: win.getContentSize(), displays: screen.getAllDisplays().map(d => ({ scale: d.scaleFactor, work: d.workArea })) };
    });
  }
  function fits({ bounds: b, work: w }) {
    return b.x >= w.x - 1 && b.y >= w.y - 1 && b.x + b.width <= w.x + w.width + 1 && b.y + b.height <= w.y + w.height + 1;
  }
  try {
    const skip = page.getByRole('button', { name: 'Skip setup', exact: true });
    await skip.waitFor();
    const before = await geometry();
    console.log(JSON.stringify({ startup: before, fits: fits(before), devicePixelRatio: await page.evaluate(() => devicePixelRatio) }));
    if (process.argv.includes('--observe')) return;
    assert.ok(fits(before), 'The entire initial window should fit within the working area');
    assert.ok(before.minimum[0] <= before.work.width && before.minimum[1] <= before.work.height);
    await skip.click();
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, file);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id && !document.querySelector('.task-progress'), id, { timeout: 60000 });
    const title = page.getByRole('heading', { name, exact: true });
    await title.waitFor();
    assert.equal(await title.getAttribute('title'), name);
    const visibleTitle = await title.boundingBox();
    assert.ok(visibleTitle.width > 60 && visibleTitle.height >= 20);
    await openWorkspaceView(page, 'Original');
    await page.locator('.textLayer[data-page="1"]').waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByText('Exact original PDF · page 2 of 4', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(dir, 'original-pdf.png') });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await titleAfterRestart();
    assert.ok(fits(await geometry()));
    console.log(JSON.stringify({ title: name, titleWidth: visibleTitle.width, titleHeight: visibleTitle.height, reopenedPage: 2 }));
  } catch (error) {
    console.error(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], dialog: document.querySelector('[role="dialog"] h2')?.textContent,
      page: document.querySelector('.pdf-toolbar > span')?.textContent, heading: document.querySelector('h1')?.textContent,
      overflow: document.documentElement.scrollWidth - innerWidth })).catch(() => null));
    await page.screenshot({ path: path.join(dir, 'failure.png'), timeout: 3500 }).catch(() => {});
    throw error;
  } finally { await app.close(); }
  async function titleAfterRestart() {
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByText('Exact original PDF · page 2 of 4', { exact: true }).waitFor();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
