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
    const retry = await confirmation();
    assert.equal(await retry.getByRole('checkbox').isChecked(), false);
    await retry.getByRole('button', { name: 'Remove saved data' }).click();
    await page.locator('.welcome').waitFor();
    assert.deepEqual(store.list(), []);
    assert.equal(fs.existsSync(attachment), false);
    assert.equal(fs.existsSync(preview), false);
    for (const p of papers) {
      assert.deepEqual(fs.readFileSync(store.pdfPath(p.id)), p.bytes);
      assert.deepEqual(fs.readFileSync(p.original), p.bytes);
    }
    console.log('After reopening both workspaces, clearing with the default kept both archived PDFs and both source files.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
