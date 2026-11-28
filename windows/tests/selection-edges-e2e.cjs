const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const samples = require('./mac-parity/selection-edges.json');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'selection-edges-'));
  const id = 'd'.repeat(64);
  const longQuote = 'A'.repeat(149) + '🧪 followed by a full measurement and its uncertainty.';
  const file = path.join(dir, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ id, type: 'text', sourceMode: 'text', name: 'Benchmark readings',
    blocks: [{ id: 1, text: samples[0].context, translation: samples[1].context, status: 'ok', notes: [] },
      { id: 2, text: longQuote, notes: [] }],
    summary: { source: samples[2].context, target: samples[3].context, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [] },
    inspectorOpen: true, position: { tab: 'Reader', displayMode: 'bilingual', block: 1 } }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE ?
    JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).selectionEdges : samples.map(sample => ({
      scope: sample.scope, side: sample.side, text: sample.quote, offset: sample.context.indexOf(sample.quote), length: sample.quote.length
    }));
  assert.equal(reference?.length, samples.length);
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await page.locator('#block-2 .source-text').evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selected = window.getSelection();
      selected.removeAllRanges();
      selected.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const card = page.getByRole('dialog', { name: 'Quick selection' });
    const heading = card.locator('.quick-selection-head strong');
    assert.equal(await heading.textContent(), longQuote, 'The complete quote remains readable across a supplementary character');
    assert.ok(await heading.evaluate(element => element.clientHeight <= 2 * parseFloat(getComputedStyle(element).lineHeight) + 1));
    await card.getByRole('button', { name: 'Notes & More' }).click();
    for (const [index, sample] of samples.entries()) {
      const reader = sample.scope === 'reader';
      await openWorkspaceView(page, reader ? 'Reader' : 'Overview');
      const host = reader ? page.locator('#block-1 ' + (sample.side === 'original' ? '.source-text' : '.translation-text')) :
        page.locator('[data-view-scope="' + sample.scope + '"] [data-markdown-host]');
      await host.evaluate((surface, quote) => {
        const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const start = node.textContent.indexOf(quote);
          if (start < 0) continue;
          const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + quote.length);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          surface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          return;
        }
        throw Error('The printed sample could not be selected');
      }, sample.quote);
      const expected = reference[index];
      assert.equal(await page.locator('.inspector-quote-text').textContent(), expected.text, sample.scope + ' ' + sample.side);
      const body = sample.scope + ' ' + sample.side;
      await page.locator('.inspector textarea').fill(body);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, body }) => {
        const paper = await window.paperBridge.loadPaper(id);
        return [...paper.blocks[0].notes, ...paper.viewNotes || []].some(note => note.body === body);
      }, { id, body });
      const paper = JSON.parse(fs.readFileSync(file, 'utf8'));
      const note = [...paper.blocks[0].notes, ...paper.viewNotes || []].find(item => item.body === body);
      assert.deepEqual({ scope: note.scope, text: note.text, offset: note.offset, length: note.text.length,
        side: (note.kind || (note.scope === 'summaryTarget' ? 'translation' : 'source')) === 'source' ? 'original' : 'translation' }, expected);
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    for (const sample of samples) {
      const row = page.locator('.annotation-row').filter({ has: page.getByText(sample.scope + ' ' + sample.side, { exact: true }) });
      assert.doesNotMatch(await row.locator('.annotation-label').innerText(), /review needed/);
      await row.locator('.annotation-navigate').click();
      await page.waitForFunction(body => document.querySelector('.inspector textarea')?.value === body, sample.scope + ' ' + sample.side);
      const selected = await page.evaluate(() => ({ text: getSelection().toString(), range: getSelection().getRangeAt(0).toString() }));
      assert.deepEqual(selected, { text: sample.quote, range: sample.quote }, sample.scope + ' ' + sample.side + ' restores a copyable selection');
    }
    const destination = path.join(dir, 'selection-notes.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    for (const sample of samples) assert.ok(exported.includes('> ' + sample.quote + '\n'), sample.scope + ' exported the bounded quote');
    console.log(JSON.stringify({ dir, selections: samples.length, verifiedRestartAndExport: true, native: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
