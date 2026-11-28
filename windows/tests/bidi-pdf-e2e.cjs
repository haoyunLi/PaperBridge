const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const sentences = [
  'כיול המכשיר', 'אורך הגל שנמדד היה 532 nm.', 'מיקום השיא לא השתנה בשלוש מדידות.',
  'معايرة الجهاز', 'بقيت درجة الحرارة ثابتة عند 298 K.',
  'The label כיול המכשיר was recorded at 532 nm.'
];

async function dragWords(page, first, last, rtl) {
  const layer = page.locator('.textLayer[data-page="1"]');
  const word = text => layer.getByText(text, { exact: true }).first();
  await word(first).scrollIntoViewIfNeeded();
  async function edge(text, end) {
    return word(text).evaluate((span, { end, rtl }) => {
      const node = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
      const at = end ? node.length - 1 : 0;
      const range = new Range(); range.setStart(node, at); range.setEnd(node, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rtl !== end ? rect.right - 0.6 : rect.left + 0.6, y: rect.top + rect.height / 2 };
    }, { end, rtl });
  }
  const a = await edge(first, false), b = await edge(last, true);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 16 }); await page.mouse.up();
  return page.evaluate(() => getSelection().toString());
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(__dirname, 'mac-parity', 'bidi-measurements.pdf');
  const bytes = fs.readFileSync(fixture), hash = createHash('sha256').update(bytes).digest('hex');
  const artifacts = path.join(root, 'test-artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'bidi-measurements-'));
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1, pdfExtractionMode: 'pdfOnly' });
  const legacy = process.env.PAPERBRIDGE_BIDI_LEGACY;
  const old = legacy && JSON.parse(fs.readFileSync(legacy, 'utf8'));
  if (old) {
    assert.equal(old.id, hash);
    store.savePaper(old); store.markPaperOpened(old.id);
    fs.mkdirSync(path.dirname(store.pdfPath(hash)), { recursive: true });
    fs.copyFileSync(fixture, store.pdfPath(hash));
  }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow(); await page.setViewportSize({ width: 1420, height: 840 });
    if (!old) {
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    }
    await page.getByRole('heading', { name: path.basename(fixture), exact: true }).waitFor();
    const previousNote = 'Wavelength as recorded in the previous edition.';
    if (old) {
      await openWorkspaceView(page, 'Original');
      await page.locator('.annotation-row').filter({ hasText: previousNote }).locator('.annotation-navigate').click();
      await page.waitForFunction(() => getSelection().toString() === '532 nm');
      await page.getByText('The saved Reader may show right-to-left words out of order').waitFor();
      await page.getByRole('button', { name: 'Recover PDF text in new copy' }).click();
      await page.getByRole('heading', { name: path.basename(fixture) + ' (new extraction)', exact: true }).waitFor();
    }
    await openWorkspaceView(page, 'Reader');
    await page.locator('.save-status.saved').waitFor();
    const id = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    const text = store.paper(id).blocks.map(block => block.text).join(' ');
    console.log(JSON.stringify({ text }));
    const prepare = process.argv.includes('--prepare-legacy');
    if (!prepare) {
      assert.equal(text, sentences.join(' '));
      const reference = process.env.PAPERBRIDGE_MAC_REFERENCE;
      if (reference) {
        const native = JSON.parse(fs.readFileSync(reference, 'utf8')).bidiMeasurements;
        assert.equal(native.sha256, hash);
        // PDFKit returns the numeric unit pairs in reverse. The explicit tagged LTR runs preserve the printed values.
        const correctUnits = text => text.replace('nm 532', '532 nm').replace('K 298', '298 K');
        assert.deepEqual(native.pages[0].split('\n').map(correctUnits), sentences);
      }
    }
    const english = page.locator('.reader-list article').filter({ hasText: 'The label' });
    await english.getByRole('button', { name: 'Bookmark', exact: true }).click();
    await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id)).blocks.some(block => block.bookmark), id);
    let translation;
    if (process.argv.includes('--live')) {
      await english.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const translated = english.locator('.translation-text.done');
      await translated.waitFor({ timeout: 150000 }); translation = await translated.innerText();
      assert.match(translation, /532\s*(?:纳米|nm)/i);
      assert.match(translation, /[\u3400-\u9fff]/u);
    }
    await openWorkspaceView(page, 'Original');
    const negation = await dragWords(page, 'לא', 'השתנה', true);
    console.log(JSON.stringify({ selectedNegation: negation }));
    const note = prepare ? previousNote : 'The peak position did not change.';
    const quote = prepare ? await dragWords(page, '532 nm', '532 nm', false) : negation;
    assert.equal(quote, prepare ? '532 nm' : 'לא השתנה');
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, quote }) => (await window.paperBridge.loadPaper(id)).pdfNotes.some(n => n.text === quote), { id, quote });
    if (prepare) { console.log(JSON.stringify({ legacy: path.join(workspace, 'papers', id + '.json') })); return; }
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('.annotation-row').filter({ hasText: note }).locator('.annotation-navigate').click();
    await page.waitForFunction(quote => getSelection().toString() === quote, quote);
    const destination = path.join(workspace, 'Original calibration readings.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Original Markdown', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    assert.equal(fs.readFileSync(destination, 'utf8').replace(/\s+/gu, ' ').trim(), sentences.join(' '));
    assert.deepEqual(fs.readFileSync(store.pdfPath(id)), bytes);
    if (old) {
      assert.notEqual(id, hash);
      assert.deepEqual(store.paper(hash).pdfNotes, old.pdfNotes);
      const savedBlocks = blocks => blocks.map(({ translationLanguage = null, ...block }) => ({ ...block, translationLanguage }));
      assert.deepEqual(savedBlocks(store.paper(hash).blocks), savedBlocks(old.blocks));
    }
    if (translation) assert.ok(store.paper(id).blocks.some(b => b.bookmark && b.translation === translation));
    console.log(JSON.stringify({ quote, translation, restart: true, retainedLegacy: Boolean(old) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
