const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults, createStore } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'reviewed-pdf-'));
  const file = path.join(__dirname, 'mac-parity', 'reviewed-calibration.pdf');
  const bytes = fs.readFileSync(file), hash = createHash('sha256').update(bytes).digest('hex');
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' });
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).pdfComments;
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) assert.equal(reference?.sha256, hash);
  const comments = reference?.comments || [
    { type: 'Text', author: 'Instrument team', text: 'Use detector gain 8 for the repeat run.' },
    { type: 'Highlight', author: 'Review A', text: 'Repeat at 77 K before warming the sample.' },
    { type: 'Underline', author: 'Review B', text: 'Independent confirmation used a second detector.' }
  ];
  if (reference) assert.ok(comments.every(comment => comment.page === 1 && comment.hit));
  const kinds = { Text: 'PDF note', Highlight: 'PDF highlight', Underline: 'PDF underline' };
  let app = await launch(), page = await app.firstWindow();
  const sheet = () => page.locator('[data-pdf-page="1"] .pdf-sheet').first();
  const line = text => page.locator('.textLayer[data-page="1"]').getByText(text, { exact: true });
  const control = comment => page.getByRole('button', { name: kinds[comment.type] + ' by ' + comment.author, exact: true });
  async function clickSticky() {
    await line('The detector gain was eight.').scrollIntoViewIfNeeded();
    const box = await sheet().boundingBox();
    await page.mouse.click(box.x + box.width * 328 / 612, box.y + box.height * (792 - 552) / 792);
  }
  async function read(comment, close = 'Escape') {
    const dialog = page.getByRole('dialog', { name: kinds[comment.type], exact: true });
    await dialog.getByText(comment.text, { exact: true }).waitFor({ timeout: 4000 });
    await dialog.getByText('Page 1 · ' + comment.author, { exact: true }).waitFor();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, kinds[comment.type] + ' by ' + comment.author);
  }
  try {
    await page.setViewportSize({ width: 1440, height: 850 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(file), exact: true }).waitFor();
    await openWorkspaceView(page, 'Original');
    const sentence = 'The sample was kept at 77 K.';
    await line(sentence).waitFor();
    if (process.argv.includes('--observe')) {
      await clickSticky();
      await line(sentence).click();
      console.log(JSON.stringify({ sourceControls: await sheet().getByRole('button').count(), dialogs: await page.getByRole('dialog').count() }));
      return;
    }
    await control(comments[0]).waitFor();
    assert.equal(await sheet().locator('.pdf-page-links button').count(), 3);
    await clickSticky(); await read(comments[0]);
    await line(sentence).click(); await read(comments[1], 'button');
    await control(comments[2]).focus(); await control(comments[2]).press('Space'); await read(comments[2]);
    assert.equal((store.paper(hash).pdfNotes || []).length, 0);

    const quote = '77 K';
    const points = await line(sentence).evaluate((span, quote) => {
      const node = span.firstChild, at = node.textContent.indexOf(quote);
      return [at, at + quote.length - 1].map((i, end) => {
        const range = new Range(); range.setStart(node, i); range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        return [end ? box.right - 0.4 : box.left + 0.4, box.top + box.height / 2];
      });
    }, quote);
    await page.mouse.move(...points[0]); await page.mouse.down(); await page.mouse.move(...points[1], { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), quote);
    await page.locator('.inspector textarea').fill('My cryogenic measurement.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id)).pdfNotes.length === 1, hash);
    await openWorkspaceView(page, 'Paper');
    await page.getByLabel('Paper display mode').selectOption('source');
    await control(comments[1]).focus(); await control(comments[1]).press('Enter'); await read(comments[1]);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Original');
    await control(comments[2]).focus(); await control(comments[2]).press('Enter'); await read(comments[2]);
    await page.locator('.annotation-row').filter({ hasText: 'My cryogenic measurement.' }).locator('.annotation-navigate').click();
    await page.waitForFunction(text => getSelection().toString() === text, quote);
    assert.deepEqual(fs.readFileSync(store.pdfPath(hash)), bytes);
    console.log(JSON.stringify({ sourceAuthors: comments.map(x => x.author), personalNotes: store.paper(hash).pdfNotes.length, quote, originalBytes: bytes.length }));
  } catch (error) {
    await page.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
    throw error;
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
