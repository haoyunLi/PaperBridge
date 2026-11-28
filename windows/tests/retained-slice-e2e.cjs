const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  const pdf = path.join(__dirname, 'mac-parity', 'emcee-v3.pdf');
  const id = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'retained-slice-'));
  const paperFile = path.join(dir, 'papers', id + '.json');
  const read = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' }));
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).retainedSlice;
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdf);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: 'emcee-v3.pdf', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    const initial = read().blocks.find(block => block.text.includes('the new backends interface'));
    assert.ok(initial);
    const original = initial.text, cropped = original.slice(original.indexOf('For example,'));
    assert.notEqual(original, cropped);
    const quote = 'results';
    const offsets = text => [text.indexOf(quote), text.lastIndexOf(quote)];
    const notes = ['Serialized results', 'In-memory results'];
    assert.ok(offsets(cropped)[0] > 0 && offsets(cropped)[1] > offsets(cropped)[0]);
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      assert.equal(reference.quote, quote);
      assert.deepEqual(reference.croppedOffsets, offsets(cropped), 'Both renderers must identify the same two retained occurrences');
      assert.deepEqual(reference.originalOffsets, offsets(original));
      assert.deepEqual(reference.undoOffsets, reference.originalOffsets);
    }
    const passage = () => page.locator('#block-' + initial.id + ' .source-text');
    const block = () => page.locator('#block-' + initial.id);
    for (const [i, body] of notes.entries()) {
      await passage().evaluate((element, { quote, offset }) => {
        const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let at = 0;
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          if (offset >= at && offset + quote.length <= at + node.length) {
            const range = document.createRange(); range.setStart(node, offset - at); range.setEnd(node, offset - at + quote.length);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return;
          }
          at += node.length;
        }
        throw Error('Missing the selected occurrence');
      }, { quote, offset: offsets(original)[i] });
      await page.locator('.inspector-primary .highlight.' + (i ? 'coral' : 'amber')).click();
      await page.locator('.inspector textarea').fill(body);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, body }) => (await window.paperBridge.loadPaper(id)).blocks.some(b => b.notes?.some(n => n.body === body)), { id, body });
    }
    async function trim() {
      await block().locator('.reader-actions-trigger').click();
      await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
      await page.getByRole('textbox', { name: 'Paragraph source', exact: true }).fill(cropped);
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await savedText(cropped);
    }
    async function savedText(text) {
      await page.waitForFunction(async ({ id, num, text }) => (await window.paperBridge.loadPaper(id)).blocks.find(block => block.id === num)?.text === text,
        { id, num: initial.id, text });
    }
    async function check(text) {
      const saved = read().blocks.find(b => b.id === initial.id);
      for (const [i, body] of notes.entries()) {
        const note = saved.notes.find(item => item.body === body);
        assert.ok(note && !note.needsReview, body + ' stays at its original occurrence within the retained slice');
        assert.equal(note.offset, offsets(text)[i]);
        assert.ok(saved.highlights.some(mark => mark.offset === note.offset && mark.color === (i ? 'coral' : 'amber') && !mark.needsReview));
        await page.locator('.annotation-row').filter({ hasText: body }).locator('.annotation-navigate').click();
        await page.waitForFunction(body => document.querySelector('.inspector textarea')?.value === body, body);
        const location = await passage().evaluate(host => {
          const range = getSelection().getRangeAt(0), prefix = document.createRange();
          prefix.selectNodeContents(host); prefix.setEnd(range.startContainer, range.startOffset);
          return [range.toString(), prefix.toString().length];
        });
        assert.deepEqual(location, [quote, note.offset]);
      }
    }
    await trim(); await check(cropped);
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await savedText(original); await check(original);
    await trim();
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader'); await check(cropped);
    console.log(JSON.stringify({ dir, originalOffsets: offsets(original), croppedOffsets: offsets(cropped), notesAndColors: 2, undoAndRestart: true, native: Boolean(reference) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
