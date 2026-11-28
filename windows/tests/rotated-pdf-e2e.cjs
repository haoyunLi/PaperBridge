const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const expected = [
  ['Lamp calibration', 'The detector warmed up for ten minutes.', 'The initial signal was 12 counts.'],
  ['Red laser measurement', 'At 298 K the red line appeared at 633 nm.', 'The reference intensity remained constant.'],
  ['Cold measurement', 'The detector settled after 30 seconds.', 'At 77 K the peak shifted by 2 nm.'],
  ['Repeat measurement', 'Three independent runs used the same lamp.', 'The final signal was 12 counts.']
];
async function selectOnSecondPage(page, from, to = from) {
  const layer = page.locator('.textLayer[data-page="2"][data-main-rotation="90"]');
  const point = async (text, end) => layer.locator('span').filter({ hasText: text }).last().evaluate((span, { text, end }) => {
    const leaf = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
    const at = leaf.textContent.indexOf(text) + (end ? text.length - 1 : 0);
    const range = new Range(); range.setStart(leaf, at); range.setEnd(leaf, at + 1);
    const box = range.getBoundingClientRect();
    return { x: end ? box.right - 0.5 : box.left + 0.5, y: box.top + box.height / 2 };
  }, { text, end });
  const start = await point(from, false);
  await page.locator('.pdf-continuous').evaluate((host, y) => {
    host.scrollTop += y - host.getBoundingClientRect().top - 65;
  }, start.y);
  const a = await point(from, false), b = await point(to, true);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 14 }); await page.mouse.up();
  return page.evaluate(() => getSelection().toString());
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(__dirname, 'mac-parity', 'rotated-spectrometer.pdf');
  const bytes = fs.readFileSync(fixture);
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'rotated-record-'));
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' });
  const legacy = process.env.PAPERBRIDGE_ROTATED_LEGACY;
  const old = legacy && JSON.parse(fs.readFileSync(legacy, 'utf8'));
  if (old) {
    assert.equal(old.id, fingerprint);
    assert.ok(old.blocks.some(block => block.bookmark));
    store.savePaper(old); store.markPaperOpened(old.id);
    fs.mkdirSync(path.dirname(store.pdfPath(old.id)), { recursive: true });
    fs.copyFileSync(fixture, store.pdfPath(old.id));
  }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1420, height: 840 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
    if (!old) await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(fixture), exact: true }).waitFor();
    if (old) {
      await openWorkspaceView(page, 'Original');
      await page.locator('.annotation-row').filter({ hasText: 'Earlier edition wavelength note.' }).locator('.annotation-navigate').click();
      await page.waitForFunction(() => getSelection().toString() === '633 nm');
      await page.getByText('The saved Reader may show this rotated page out of order').waitFor();
      await page.getByRole('button', { name: 'Recover PDF text in new copy', exact: true }).click();
      await page.getByRole('heading', { name: path.basename(fixture) + ' (new extraction)', exact: true }).waitFor();
    }
    await openWorkspaceView(page, 'Reader');
    await page.locator('.save-status.saved').waitFor();
    const id = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    const blocks = store.paper(id).blocks;
    const pages = expected.map((_, index) => blocks.filter(block => block.page === index + 1).map(block => block.text));
    console.log(JSON.stringify({ pages }));
    if (process.argv.includes('--prepare-legacy')) {
      await page.locator('.reader-list article').first().getByRole('button', { name: 'Bookmark', exact: true }).click();
      await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id)).blocks[0].bookmark, id);
      await page.getByRole('button', { name: 'Open original PDF page 2', exact: true }).first().click();
      const crossLine = await selectOnSecondPage(page, 'At 298 K', 'The reference intensity');
      console.log(JSON.stringify({ crossLine }));
      assert.equal(await selectOnSecondPage(page, '633 nm'), '633 nm');
      await page.locator('.inspector textarea').fill('Earlier edition wavelength note.');
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id)).pdfNotes?.length === 1, id);
      console.log(JSON.stringify({ legacyPaper: path.join(workspace, 'papers', id + '.json') }));
      return;
    }
    const native = process.env.PAPERBRIDGE_MAC_REFERENCE;
    if (native) {
      const reference = JSON.parse(fs.readFileSync(native, 'utf8')).rotatedSpectrometer;
      assert.equal(reference.sha256, fingerprint);
      assert.deepEqual(reference.pages.map(text => text.split('\n')), expected);
    }
    assert.deepEqual(pages.map(lines => lines.join(' ')), expected.map(lines => lines.join(' ')));
    const row = page.locator('.reader-list article').filter({ hasText: expected[1][1] });
    await row.getByRole('button', { name: 'Bookmark', exact: true }).click();
    let translation;
    if (process.argv.includes('--live')) {
      await row.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const translated = row.locator('.translation-text.done');
      await translated.waitFor({ timeout: 150000 });
      translation = await translated.innerText();
      assert.match(translation, /298/); assert.match(translation, /633/); assert.match(translation, /[\p{Script=Han}]/u);
    }
    await row.getByRole('button', { name: 'Open original PDF page 2', exact: true }).click();
    const crossLine = await selectOnSecondPage(page, 'At 298 K', 'The reference intensity');
    console.log(JSON.stringify({ crossLine }));
    assert.equal(crossLine.replace(/\s+/gu, ' ').trim(), expected[1][1] + ' The reference intensity');
    const crossNote = 'Compare both printed measurement lines.';
    await page.locator('.inspector textarea').fill(crossNote);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, crossNote }) => (await window.paperBridge.loadPaper(id)).pdfNotes.some(n => n.body === crossNote), { id, crossNote });
    const quote = '633 nm';
    assert.equal(await selectOnSecondPage(page, quote), quote);
    const note = 'Wavelength of the red line on the rotated instrument sheet.';
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, quote }) => (await window.paperBridge.loadPaper(id)).pdfNotes.some(n => n.text === quote && n.page === 2), { id, quote });
    await openWorkspaceView(page, 'Reader');
    await page.locator('.save-status.saved').waitFor();
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('.annotation-row').filter({ hasText: note }).locator('.annotation-navigate').click();
    await page.waitForFunction(quote => getSelection().toString() === quote, quote);
    await page.locator('.annotation-row').filter({ hasText: crossNote }).locator('.annotation-navigate').click();
    await page.waitForFunction(text => getSelection().toString().replace(/\s+/gu, ' ').trim() === text, expected[1][1] + ' The reference intensity');
    assert.deepEqual(fs.readFileSync(store.pdfPath(id)), bytes);
    if (translation) assert.ok(store.paper(id).blocks.some(block => block.translation === translation && block.bookmark));
    if (old) {
      assert.notEqual(id, old.id);
      assert.deepEqual(store.paper(old.id).pdfNotes, old.pdfNotes);
      assert.deepEqual(store.paper(old.id).blocks.map(b => [b.text,b.translation,b.bookmark]), old.blocks.map(b => [b.text,b.translation,b.bookmark]));
    }
    console.log(JSON.stringify({ rotations: [0,90,180,270], note: quote, translation, retainedLegacy: Boolean(old) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

