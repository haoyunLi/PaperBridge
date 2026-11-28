const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults, createStore } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const root = path.resolve(__dirname, '..');
const sample = path.join(__dirname, 'mac-parity', 'vertical-lab-notes.pdf');
const expected = [
  ['Spectroscopy notebook', '分光測定の記録。', '三回の測定でピーク位置は変化しなかった。', '参照信号は一定であった。'],
  ['Instrument log', '光源を固定した。', '信号を再測定した。', 'The reference measurement was repeated three times.']
];
async function run() {
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'vertical-notes-'));
  const store = createStore(dir);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false,
    sourceLanguage: 'Japanese', targetLanguage: 'English', translationModel: 'translategemma:4b' });
  const fingerprint = createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
  const native = process.env.PAPERBRIDGE_MAC_REFERENCE;
  if (native) {
    const reference = JSON.parse(fs.readFileSync(native, 'utf8')).verticalNotebook;
    assert.equal(reference.sha256, fingerprint);
    assert.deepEqual(reference.pages.map(text => text.split('\n')), expected);
    assert.equal(reference.reader, expected.flat().join(' '));
  }
  const legacyFile = process.env.PAPERBRIDGE_VERTICAL_LEGACY;
  let old, oldReader;
  if (legacyFile) {
    old = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    assert.ok(old.id === fingerprint && old.blocks[0].bookmark && old.blocks[0].notes.length);
    store.savePaper(old);
    store.markPaperOpened(old.id);
    fs.mkdirSync(path.dirname(store.pdfPath(old.id)), { recursive: true });
    fs.copyFileSync(sample, store.pdfPath(old.id));
  }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, sample);
    if (!old) await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(sample), exact: true }).waitFor();
    if (old) {
      await openWorkspaceView(page, 'Original');
      await page.getByText('The saved Reader may show these vertical columns out of order').waitFor();
      await page.getByText('Saved on this PC', { exact: true }).waitFor();
      const legacyNote = old.pdfNotes.find(note => note.body === 'Legacy note in the middle printed column.');
      assert.ok(legacyNote && legacyNote.text === '三回の測定');
      const record = page.locator('.annotation-row').filter({ hasText: legacyNote.body });
      await record.locator('.annotation-navigate').click();
      await page.waitForFunction(text => getSelection().toString() === text, legacyNote.text);
      oldReader = store.paper(old.id).blocks;
      for (const [i, block] of old.blocks.entries()) {
        for (const key of ['text', 'translation', 'bookmark', 'notes', 'highlights']) assert.deepEqual(oldReader[i][key], block[key]);
      }
      await page.getByRole('button', { name: 'Recover PDF text in new copy' }).click();
      await page.getByRole('heading', { name: path.basename(sample) + ' (new extraction)', exact: true }).waitFor();
    }
    await openWorkspaceView(page, 'Reader');
    await page.locator('.save-status.saved').waitFor();
    const id = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    const blocks = store.paper(id).blocks;
    console.log(JSON.stringify({ dir, id, pages: [1, 2].map(p => blocks.filter(b => b.page === p).map(b => b.text)) }));
    if (process.argv.includes('--prepare-legacy')) {
      assert.equal(blocks.length, 3);
      const first = page.locator('.reader-list article').first();
      await first.getByRole('button', { name: 'Bookmark', exact: true }).click();
      await first.locator('.source-text').evaluate(host => {
        const node = document.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode();
        const range = new Range();
        range.setStart(node, 0); range.setEnd(node, 12);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.locator('.inspector textarea').fill('Check the rightmost column against the printed notes.');
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id))?.blocks[0].notes?.length === 1, id);
      await openWorkspaceView(page, 'Original');
      const middle = page.locator('.textLayer[data-page="1"] span').filter({ hasText: '三回の測定' }).last();
      await middle.evaluate(span => {
        const node = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
        const range = new Range(); range.setStart(node, 0); range.setEnd(node, 5);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.locator('.inspector textarea').fill('Legacy note in the middle printed column.');
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id))?.pdfNotes?.length === 1, id);
      console.log(JSON.stringify({ legacyPaper: path.join(dir, 'papers', id + '.json') }));
      return;
    }
    if (process.argv.includes('--observe')) return;
    for (const [index, lines] of expected.entries()) assert.deepEqual(blocks.filter(b => b.page === index + 1).map(b => b.text), lines);
    const measured = page.locator('.reader-list article').filter({ hasText: expected[0][2] });
    await measured.getByRole('button', { name: 'Bookmark', exact: true }).click();
    let translation;
    if (process.argv.includes('--live')) {
      await measured.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const result = measured.locator('.translation-text.done');
      await result.waitFor({ timeout: 150000 });
      translation = await result.innerText();
      assert.match(translation, /three|\b3\b/i);
      assert.match(translation, /peak/i);
      assert.match(translation, /not|unchanged|constant|same|stable|fixed/i);
    }
    await openWorkspaceView(page, 'Original');
    const firstPage = page.locator('.textLayer[data-page="1"]');
    await firstPage.waitFor();
    assert.ok((await firstPage.textContent()).includes('分光測定の記録'));
    const canvas = page.locator('.pdf-sheet canvas').first();
    const bitmap = await canvas.evaluate(node => node.toDataURL('image/png').split(',')[1]);
    fs.writeFileSync(path.join(dir, 'original.png'), Buffer.from(bitmap, 'base64'));
    const quote = '三回の測定';
    const glyphs = firstPage.locator('span').filter({ hasText: quote }).last();
    const endpoints = () => glyphs.evaluate((span, text) => {
      const node = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
      const at = node.textContent.indexOf(text);
      const rect = index => { const range = new Range(); range.setStart(node, index); range.setEnd(node, index + 1); return range.getBoundingClientRect(); };
      const first = rect(at), last = rect(at + text.length - 1);
      return { start: { x: first.x + first.width / 2, y: first.top + 1 }, end: { x: last.x + last.width / 2, y: last.bottom - 1 } };
    }, quote);
    const viewport = page.locator('.pdf-continuous');
    const before = await endpoints();
    await viewport.evaluate((host, y) => { host.scrollTop += y - host.getBoundingClientRect().top - 35; }, before.start.y);
    const { start, end } = await endpoints();
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
    const selected = await page.evaluate(() => getSelection().toString());
    assert.equal(selected, quote, 'Drag from the top to the bottom of the printed phrase');
    await page.locator('.inspector textarea').fill('Check the three measurements in the vertical column.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, quote }) => (await window.paperBridge.loadPaper(id)).pdfNotes?.some(note =>
      note.text === quote && note.body.includes('three measurements')), { id, quote });
    const right = firstPage.locator('span').filter({ hasText: '分光測定の記録' }).last();
    const from = await right.evaluate(span => {
      const text = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
      const range = new Range(); range.setStart(text, 0); range.setEnd(text, 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + 1 };
    });
    const { end: to } = await endpoints();
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 }); await page.mouse.up();
    const crossColumn = await page.evaluate(() => getSelection().toString().replace(/\s/gu, ''));
    console.log(JSON.stringify({ crossColumn }));
    if (process.argv.includes('--observe-cross')) return;
    assert.equal(crossColumn, '分光測定の記録︒' + quote);
    const crossNote = 'The notebook heading continues into the middle column.';
    await page.locator('.inspector textarea').fill(crossNote);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, crossNote }) => (await window.paperBridge.loadPaper(id)).pdfNotes?.some(note => note.body === crossNote), { id, crossNote });
    await openWorkspaceView(page, 'Reader');
    await page.locator('.save-status.saved').waitFor();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const saved = page.locator('.reader-list article').filter({ hasText: expected[0][2] });
    await saved.waitFor();
    assert.equal(await saved.getByRole('button', { name: 'Bookmark', exact: true }).getAttribute('aria-pressed'), 'true');
    if (translation) assert.equal(await saved.locator('.translation-text.done').innerText(), translation);
    await page.locator('.annotation-row').filter({ hasText: crossNote }).locator('.annotation-navigate').click();
    await page.waitForFunction(quote => getSelection().toString().replace(/\s/gu, '') === quote, crossColumn);
    assert.deepEqual(fs.readFileSync(store.pdfPath(id)), fs.readFileSync(sample));
    assert.ok(store.paper(id).pdfNotes.some(note => note.text === quote && note.body.includes('three measurements')));
    if (old) {
      assert.notEqual(id, old.id);
      assert.deepEqual(store.paper(old.id).blocks, oldReader);
      assert.deepEqual(store.paper(old.id).pdfNotes, old.pdfNotes);
      assert.deepEqual(fs.readFileSync(store.pdfPath(old.id)), fs.readFileSync(sample));
    }
    console.log(JSON.stringify({ verifiedColumns: 5, translation, native: Boolean(native), retainedLegacy: Boolean(old) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
