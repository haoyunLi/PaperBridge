const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'pdf-link-reader-'));
  const source = path.join(__dirname, 'mac-parity', 'linked-instrument-handbook.pdf');
  const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' });
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch(), page;
  try {
    page = await app.firstWindow(); await page.setViewportSize({ width: 1420, height: 840 });
    await app.evaluate(({ shell, dialog }, filename) => {
      global.__externalLinks = [];
      shell.openExternal = async url => { global.__externalLinks.push(url); };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(source), exact: true }).waitFor();
    await openWorkspaceView(page, 'Original');
    const toolbar = number => page.getByText('Exact original PDF · page ' + number + ' of 4', { exact: true });
    const glyph = (number, label) => page.locator('.textLayer[data-page="' + number + '"]').getByText(label, { exact: true }).first();
    const link = label => page.locator('.pdf-page-links').getByRole('link', { name: label, exact: true });
    const spectrum = 'Reference spectrum at 532 nm', table = 'Instrument settings table', doi = 'Reference article DOI';
    await toolbar(1).waitFor(); await glyph(1, spectrum).waitFor();
    if (process.argv.includes('--observe')) {
      await glyph(1, spectrum).click(); await glyph(1, doi).click();
      console.log(JSON.stringify({ page: await page.locator('.pdf-toolbar > span').innerText(), firstPageActions: await page.locator('[data-pdf-page="1"] .pdf-page-links a').count(), external: await app.evaluate(() => global.__externalLinks) })); return;
    }
    const observed = [];
    const activate = async (from, label, to, keyboard = false) => {
      await link(label).waitFor({ state: 'attached' });
      if (keyboard) { await link(label).focus(); await link(label).press('Enter'); }
      else await glyph(from, label).click();
      await toolbar(to).waitFor();
      console.log(JSON.stringify({ label, from, to }));
      observed.push({ from, label, page: to, opened: true });
    };
    await activate(1, spectrum, 3);
    const target = glyph(3, 'The reference wavelength was 532 nm.');
    await target.waitFor();
    await page.waitForFunction(() => {
      const host = document.querySelector('.pdf-continuous');
      const text = [...host.querySelectorAll('[data-pdf-page="3"] .textLayer span')].find(s => s.textContent === 'The reference wavelength was 532 nm.');
      if (!text) return false;
      const y = text.getBoundingClientRect().top - host.getBoundingClientRect().top;
      return y >= 0 && y < 110;
    });
    const back = () => page.getByRole('button', { name: 'Back to previous reading location', exact: true });
    const forward = () => page.getByRole('button', { name: 'Forward in reading history', exact: true });
    await back().click(); await toolbar(1).waitFor();
    await forward().click(); await toolbar(3).waitFor();
    await activate(3, 'Back to instrument handbook', 1, true);
    await activate(1, table, 2, true);
    await activate(2, 'Return to contents', 1);
    await glyph(1, doi).click();
    await page.waitForFunction(() => !window.getSelection().toString());
    assert.deepEqual(await app.evaluate(() => global.__externalLinks), ['https://doi.org/10.21105/joss.01864']);
    observed.push({ from: 1, label: doi, url: 'https://doi.org/10.21105/joss.01864' });
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).pdfLinks;
      assert.equal(native.sha256, hash);
      const sorted = items => [...items].sort((a,b) => a.label.localeCompare(b.label));
      assert.deepEqual(sorted(observed), sorted(native.links));
    }
    // A drag on the live link must select the printed phrase without following it.
    const text = glyph(1, spectrum), quote = 'spectrum at 532 nm';
    await text.scrollIntoViewIfNeeded();
    const points = await text.evaluate((span, quote) => {
      const node = span.firstChild, start = node.textContent.indexOf(quote);
      return [start,start + quote.length - 1].map((at,i) => {
        const range = new Range(); range.setStart(node, at); range.setEnd(node, at + 1);
        const box = range.getBoundingClientRect(); return [i ? box.right - 0.4 : box.left + 0.4, box.top + box.height / 2];
      });
    }, quote);
    await page.mouse.move(...points[0]); await page.mouse.down(); await page.mouse.move(...points[1], { steps: 16 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), quote); await toolbar(1).waitFor();
    await page.locator('.inspector textarea').fill('Check the reference spectrum.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async hash => (await window.paperBridge.loadPaper(hash)).pdfNotes.some(n => n.text === 'spectrum at 532 nm'), hash);
    await openWorkspaceView(page, 'Paper');
    await page.getByLabel('Paper display mode').selectOption('source');
    await activate(1, table, 2, true);
    await page.waitForFunction(async hash => (await window.paperBridge.loadPaper(hash)).position.page === 2, hash);
    await app.close(); app = await launch(); page = await app.firstWindow(); await toolbar(2).waitFor();
    await glyph(2, 'Table 1. The detector gain was eight.').waitFor();
    await openWorkspaceView(page, 'Original');
    await page.locator('.annotation-row').filter({ hasText: 'Check the reference spectrum.' }).locator('.annotation-navigate').click();
    await page.waitForFunction(quote => getSelection().toString() === quote, quote);
    assert.deepEqual(fs.readFileSync(store.pdfPath(hash)), fs.readFileSync(source));
    let translation;
    if (process.argv.includes('--live')) {
      await openWorkspaceView(page, 'Paper');
      await page.getByLabel('Paper display mode').selectOption('bilingual');
      await openWorkspaceView(page, 'Reader');
      const row = page.locator('.reader-list article').filter({ hasText: 'The detector gain was eight.' });
      await row.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const translated = row.locator('.translation-text.done');
      await translated.waitFor({ timeout: 150000 }); translation = await translated.innerText();
      assert.match(translation, /增益/); assert.match(translation, /八|8/);
    }
    console.log(JSON.stringify({ actions: observed, history: true, selected: quote, restoredPage: 2, noteRestored: true, translation }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
      console.error(await page.locator('.pdf-toolbar, .pdf-panel .notice, .error').allInnerTexts().catch(() => []));
    }
    throw error;
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
