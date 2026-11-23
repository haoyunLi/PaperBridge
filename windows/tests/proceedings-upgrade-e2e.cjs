// Run against the original ACL PDF and a previous public PaperBridge executable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const [pdf, previous] = process.argv.slice(2).map(file => path.resolve(file));
  const name = path.basename(pdf), sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const id = sha(fs.readFileSync(pdf));
  assert.equal(id, '987545ffb087f1ece898142c403a516baeabeb70ce19089397fac6f7db12c3d4');
  const directory = fs.mkdtempSync(path.join(root, 'test-artifacts', 'saved-proceedings-'));
  const read = key => JSON.parse(fs.readFileSync(path.join(directory, 'papers', key + '.json'), 'utf8'));
  const work = paper => paper.blocks.map(b => [b.id, b.text, b.translation || '', !!b.bookmark, b.notes || [], b.highlights || []]);
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ ...defaults, pdfExtractionMode: 'pdfOnly',
    onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const launch = executablePath => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(directory, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: directory } });
  const picker = app => app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, pdf);
  const openLibraryEntry = async (page, title, key) => {
    await page.getByTitle('Open library', { exact: true }).click();
    await page.locator('.modal-list-row').filter({ has: page.getByText(title, { exact: true }) }).click();
    await page.waitForFunction(key => document.querySelector('.main-scroll')?.dataset.readingPaperId === key, key);
  };
  let app = await launch(previous);
  try {
    let page = await app.firstWindow();
    await picker(app);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByText(/Extracted \d+ blocks from 16 pages/).first().waitFor({ timeout: 60000 });
    const original = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    const split = original.blocks.find(b => b.text.includes('There is mini-'));
    assert.ok(split && split.text.endsWith('mini-'));
    await openWorkspaceView(page, 'Reader');
    const row = page.locator('#block-' + split.id);
    await row.locator('button[title^="Bookmark"]').click();
    await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    await row.locator('.translation-text.done').waitFor({ timeout: 150000 });
    const translation = await row.locator('.translation-text.done').innerText();
    assert.match(translation, /BERT/);
    await app.close();
    const before = read(id);
    const saved = before.blocks.find(b => b.id === split.id);
    assert.ok(saved.bookmark && saved.translation === translation);
    app = await launch(process.env.PAPERBRIDGE_TEST_EXECUTABLE);
    page = await app.firstWindow();
    await page.locator('#block-' + split.id + ' .translation-text.done').getByText(translation, { exact: true }).waitFor();
    await picker(app);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('button', { name: 'Re-extract PDF as New Copy', exact: true }).click();
    await page.waitForFunction(id => {
      const reader = document.querySelector('.main-scroll');
      return reader?.dataset.readingPaperId && reader.dataset.readingPaperId !== id && !document.querySelector('.task-progress');
    }, id, { timeout: 60000 });
    const copyID = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    const copy = await page.evaluate(id => window.paperBridge.loadPaper(id), copyID);
    assert.equal(copy.name, name + ' (new extraction)');
    assert.ok(copy.blocks.some(b => b.text.includes('There is minimal difference between the pre-trained architecture')));
    assert.ok(copy.blocks.some(b => b.text.includes('classification layer weights W ∈ ℝ^{K×H}')));
    assert.ok(copy.blocks.every(b => !b.translation && !b.bookmark));
    assert.deepEqual(work(read(id)), work(before));
    for (const key of [id, copyID]) assert.equal(sha(fs.readFileSync(path.join(directory, 'pdfs', key + '.pdf'))), id);
    await openLibraryEntry(page, name, id);
    assert.equal(await page.locator('#block-' + split.id + ' .translation-text.done').innerText(), translation);
    await app.close(); app = await launch(process.env.PAPERBRIDGE_TEST_EXECUTABLE); page = await app.firstWindow();
    assert.equal(await page.locator('#block-' + split.id + ' .translation-text.done').innerText(), translation);
    assert.deepEqual(work(read(id)), work(before));
    await openLibraryEntry(page, copy.name, copyID);
    assert.ok(read(copyID).blocks.some(b => b.text.includes('classification layer weights W ∈ ℝ^{K×H}')));
    console.log(JSON.stringify({ directory, originalBlocks: before.blocks.length, newBlocks: copy.blocks.length,
      printedPage: split.page, storedBookmark: split.id, originalPdf: id, independentCopy: copyID, restoredTranslation: translation }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
