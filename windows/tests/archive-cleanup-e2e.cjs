const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { importPdfAsset } = require('../electron/pdf-ingest.cjs');
const { withWindowsReadLock } = require('./windows-read-lock.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'archive-retry-')), store = createStore(dir);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false });
  const archived = ['rotated-spectrometer.pdf', 'vertical-lab-notes.pdf', 'mixed-cid-record.pdf'].map(name => {
    const source = path.join(__dirname, 'mac-parity', name);
    const bytes = fs.readFileSync(source);
    const { id } = importPdfAsset(bytes, name, store.pdfPath);
    store.savePaper({ id, name, type: 'pdf', blocks: [], position: {} });
    return { id, name, source, bytes, archive: store.pdfPath(id) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const [first, second, last] = archived;
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const localData = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Local Data', exact: true }).click();
    };
    await localData();
    await page.getByRole('button', { name: 'Remove all saved PaperBridge data…', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Saved Data' });
    const option = confirm.getByRole('checkbox', { name: 'Also remove archived PDF copies from PaperBridge' });
    assert.equal(await option.isChecked(), false);
    await option.check();
    await withWindowsReadLock(first.archive, () => withWindowsReadLock(second.archive, async () => {
      await confirm.getByRole('button', { name: 'Remove saved data', exact: true }).click();
      await page.locator('.welcome').waitFor();
      assert.deepEqual(store.list(), []);
      console.log(JSON.stringify({ locked: 2, unlockedCopyRemoved: !fs.existsSync(last.archive) }));
      if (process.argv.includes('--observe')) return;
      assert.equal(fs.existsSync(last.archive), false);
      assert.ok(fs.existsSync(first.archive) && fs.existsSync(second.archive));
    }));
    if (process.argv.includes('--observe')) return;
    // Reopen one of the two previously locked sources and create new work before retrying.
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, second.source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: second.name, exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    const bookmark = page.locator('.reader-list article').first().getByRole('button', { name: 'Bookmark', exact: true });
    await bookmark.click();
    await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id)).blocks[0].bookmark, second.id);
    await app.close(); app = await launch(); page = await app.firstWindow();
    const skip = page.getByRole('button', { name: 'Skip setup', exact: true });
    await page.locator('.app').waitFor();
    if (await skip.isVisible()) await skip.click();
    await localData();
    const retry = page.getByRole('button', { name: 'Retry archived PDF cleanup', exact: true });
    await retry.waitFor();
    await retry.click();
    await page.getByText('Removed 1 archived PDF copy. Kept 1 copy used by a saved paper or changed since the cleanup.', { exact: true }).waitFor();
    assert.equal(await retry.count(), 0);
    assert.equal(fs.existsSync(first.archive), false);
    assert.deepEqual(fs.readFileSync(second.archive), second.bytes);
    assert.ok(store.paper(second.id).blocks[0].bookmark);
    for (const item of archived) assert.deepEqual(fs.readFileSync(item.source), item.bytes);
    console.log('Restarted, retried the earlier cleanup without removing the new bookmark or its PDF, and checked all three original files.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

