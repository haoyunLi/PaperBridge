// Exercise a real parser result when the paper was saved but its library index could not be replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { findPaperMineruMarkdown } = require('../electron/mineru-resources.cjs');
const { openWorkspaceView, revealSidebarSource } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const input = path.resolve(process.argv[2]);
  const bytes = fs.readFileSync(input);
  const id = createHash('sha256').update(bytes).digest('hex');
  const base = path.join(root, 'test-artifacts');
  fs.mkdirSync(base, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(base, 'ocr-recovery-'));
  const index = path.join(workspace, 'library-index.json');
  // A directory with this name makes the real atomic index replacement fail on Windows.
  fs.mkdirSync(index);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults,
    autoCheckUpdates: false, onboardingCompletedVersion: 1, pdfExtractionMode: 'mineruPreferred',
    mineruExecutable: process.env.PAPERBRIDGE_LIVE_MINERU || '' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  const readPaper = () => JSON.parse(fs.readFileSync(path.join(workspace, 'papers', id + '.json'), 'utf8'));
  const confirmOpen = () => app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, input);
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    const parser = await page.evaluate(async () => {
      const { settings } = await window.paperBridge.bootstrap();
      return window.paperBridge.mineruStatus(settings.mineruExecutable, settings.mineruBackend);
    });
    assert.ok(parser.compatible);
    if (process.env.PAPERBRIDGE_LIVE_DIRECTML) assert.equal(parser.runtime.directml, true);
    await confirmOpen(); await revealSidebarSource(page);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor({ timeout: 240000 });
    const saved = readPaper();
    assert.ok(saved.mineruResourceId && saved.mineruBlocks?.length);
    const original = findPaperMineruMarkdown(workspace, saved);
    assert.ok(original);
    const hints = await page.evaluate(id => window.paperBridge.cachedMineruPages(id), id);
    assert.ok(hints.length);
    const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const assets = fs.readdirSync(path.dirname(original), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
    const before = assets.map(fileHash);
    assert.ok(assets.length >= 2);
    // Allow the index to recover before reopening the reader. Both paths belong to this fresh test directory.
    fs.renameSync(index, path.join(workspace, 'index-write-obstruction'));
    await app.evaluate(async ({ BrowserWindow, dialog }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      dialog.showMessageBox = async () => ({ response: 0 });
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Reader recovery timed out')), 20000);
        contents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      });
      contents.forcefullyCrashRenderer();
      await loaded;
    });
    const kept = findPaperMineruMarkdown(workspace, readPaper());
    console.log(JSON.stringify({ workspace, blocks: saved.mineruBlocks.length, pages: [...new Set(hints.map(h => h.page))],
      resources: assets.length, preserved: Boolean(kept), parser: parser.runtime?.description }));
    assert.equal(kept, original, 'Recovering the window discarded files belonging to the saved paper');
    assert.deepEqual(assets.map(fileHash), before);
    assert.equal(fileHash(path.join(workspace, 'pdfs', id + '.pdf')), id);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await confirmOpen(); await revealSidebarSource(page);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id, id);
    await openWorkspaceView(page, 'Reader');
    await page.locator('.reader-list .block').first().waitFor();
    assert.deepEqual(await page.evaluate(id => window.paperBridge.cachedMineruPages(id), id), hints);
    const restored = readPaper();
    assert.equal(restored.mineruResourceId, saved.mineruResourceId);
    assert.equal(restored.mineruMarkdown, saved.mineruMarkdown);
    console.log('Reopened the scanned article with its original PDF, exact resource bytes and OCR page map.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
