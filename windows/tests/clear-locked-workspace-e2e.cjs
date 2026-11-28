const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { importPdfAsset } = require('../electron/pdf-ingest.cjs');
const { withWindowsReadLock } = require('./windows-read-lock.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'locked-workspace-'));
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 });
  store.saveGlossary([{ source: 'lamp', target: 'calibration lamp' }]);
  const papers = ['rotated-spectrometer.pdf', 'bidi-measurements.pdf'].map(name => {
    const original = path.join(__dirname, 'mac-parity', name), bytes = fs.readFileSync(original);
    const { id } = importPdfAsset(bytes, name, store.pdfPath);
    store.savePaper({ id, type: 'pdf', name, blocks: [{ id: 1, text: 'Calibration lamp', translation: '校准灯', status: 'ok', bookmark: true }], position: { tab: 'Reader' } });
    return { name, id, bytes, original, file: path.join(workspace, 'papers', id + '.json') };
  }).sort((a, b) => a.id.localeCompare(b.id));
  store.markPaperOpened(papers[0].id);
  const attachment = path.join(workspace, 'mineru-results', 'a'.repeat(16), 'calibration.tsv');
  const preview = path.join(workspace, 'pdf-page-cache', 'previous', 'page-001.png');
  for (const file of [attachment, preview]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'Retained sample'); }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const confirmation = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Local Data' }).click();
      await page.getByRole('button', { name: 'Remove all saved PaperBridge data…' }).click();
      return page.getByRole('dialog', { name: 'Remove Saved Data' });
    };
    const dialog = await confirmation();
    const option = dialog.getByRole('checkbox', { name: 'Also remove archived PDF copies from PaperBridge' });
    assert.equal(await option.isChecked(), false);
    await option.check();
    await withWindowsReadLock(papers[1].file, async () => {
      await dialog.getByRole('button', { name: 'Remove saved data', exact: true }).click();
      await page.waitForFunction(() => /Could not clear saved data|Windows could not clear|Close any app using/.test(document.body.innerText));
      const observed = { papers: papers.filter(p => fs.existsSync(p.file)).length,
        attachment: fs.existsSync(attachment), preview: fs.existsSync(preview), errorInDialog: await dialog.getByRole('alert').count() > 0 };
      console.log(JSON.stringify(observed));
      if (process.argv.includes('--observe')) return;
      assert.deepEqual(observed, { papers: 2, attachment: true, preview: true, errorInDialog: true });
      assert.equal(await option.isChecked(), true);
      for (const p of papers) {
        assert.deepEqual(fs.readFileSync(store.pdfPath(p.id)), p.bytes);
        assert.ok(store.paper(p.id).blocks[0].bookmark);
      }
    });
    if (process.argv.includes('--observe')) return;
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.getByRole('heading', { name: papers[0].name, exact: true }).waitFor();
    assert.equal(store.list().length, 2);
    assert.equal(store.glossary()[0].target, 'calibration lamp');
    // A slow disk can deliver a paper selected in Recent Papers after the user has cleared the library.
    await app.evaluate(({ ipcMain }, id) => {
      const load = ipcMain._invokeHandlers.get('paper:load');
      ipcMain.removeHandler('paper:load');
      ipcMain.handle('paper:load', async (event, paperId) => {
        const value = await load(event, paperId);
        if (paperId === id) await new Promise(resolve => { globalThis.__releasePaperRead = resolve; });
        return value;
      });
    }, papers[1].id);
    await page.locator('.recent-papers').getByText(papers[1].name, { exact: true }).click();
    await app.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (!globalThis.__releasePaperRead && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
      if (!globalThis.__releasePaperRead) throw new Error('The second paper was not read before the clear operation');
    });
    const retry = await confirmation();
    assert.equal(await retry.getByRole('checkbox').isChecked(), false);
    await app.evaluate(({ ipcMain }) => {
      const clear = ipcMain._invokeHandlers.get('paper:clear-data');
      const save = ipcMain._invokeHandlers.get('paper:save');
      ipcMain.removeHandler('paper:clear-data');
      ipcMain.removeHandler('paper:save');
      ipcMain.handle('paper:clear-data', async (...args) => {
        const result = await clear(...args);
        await new Promise(resolve => { globalThis.__releaseClear = resolve; });
        return result;
      });
      ipcMain.handle('paper:save', (...args) => {
        if (globalThis.__releaseClear) globalThis.__lateClearSave = true;
        return save(...args);
      });
    });
    await retry.getByRole('button', { name: 'Remove saved data' }).click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] button:disabled'));
    await app.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (!globalThis.__releaseClear && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
      if (!globalThis.__releaseClear) throw new Error('Timed out waiting for the committed clear operation');
    });
    // A resize or native layout pass can emit a final scroll for the outgoing reader.
    await page.locator('.main-scroll').evaluate(async host => {
      host.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 500));
    });
    const wroteAfterClear = await app.evaluate(() => {
      globalThis.__releaseClear();
      return Boolean(globalThis.__lateClearSave);
    });
    await page.locator('.welcome').waitFor();
    assert.equal(wroteAfterClear, false, 'A delayed viewport save cannot recreate a cleared paper');
    await app.evaluate(() => { globalThis.__releasePaperRead(); });
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.welcome').isVisible(), true, 'A previously requested paper cannot reopen after clearing');
    assert.equal(papers.some(p => fs.existsSync(p.file)), false, 'A late read cannot write a cleared paper back to disk');
    assert.deepEqual(store.list(), []);
    assert.equal(fs.existsSync(attachment), false);
    assert.equal(fs.existsSync(preview), false);
    for (const p of papers) {
      assert.deepEqual(fs.readFileSync(store.pdfPath(p.id)), p.bytes);
      assert.deepEqual(fs.readFileSync(p.original), p.bytes);
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    assert.deepEqual(store.list(), []);
    assert.equal(store.lastPaperId(), null);
    assert.equal(papers.some(p => fs.existsSync(p.file)), false);
    console.log('Clearing kept both archived PDFs and both source files; a late read did not restore a cleared paper or bookmark after restart.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
