const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'legacy-paragraph-anchors-'));
  const pdf = path.join(__dirname, 'mac-parity', 'emcee-v3.pdf');
  const id = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  const paperFile = path.join(dir, 'papers', id + '.json');
  const read = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  const settings = { ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const referenceFile = process.env.PAPERBRIDGE_MAC_REFERENCE;
  const reference = referenceFile && JSON.parse(fs.readFileSync(referenceFile, 'utf8')).legacyParagraphAnchors;
  if (referenceFile) assert.ok(reference, 'Expected the native paragraph edit fixture');
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch(), page = await app.firstWindow();
  try {
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ dialog }, pdf) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdf] }); }, pdf);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: 'emcee-v3.pdf', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    await app.close();
    const paper = read(), blocks = paper.blocks;
    const start = blocks.findIndex(block => block.text.includes('the new backends interface'));
    assert.ok(start >= 0);
    const samples = [
      { quote: 'new backends interface', side: 0 }, { quote: 'new moves interface', side: 1 },
      { quote: 'results', side: 0, ambiguous: true }, { quote: 'HDFBackend', side: 0, stale: true }, { quote: 'kernel density proposal', side: 1 }
    ];
    for (const [i, sample] of samples.entries()) {
      const block = blocks[start + sample.side];
      assert.ok(block.text.indexOf(sample.quote) > 0);
      assert.equal(block.text.indexOf(sample.quote) !== block.text.lastIndexOf(sample.quote), Boolean(sample.ambiguous));
      const anchor = { kind: 'source', scope: 'reader', offset: 0, text: sample.quote, createdAt: new Date(1700000000000 + i).toISOString(), needsReview: Boolean(sample.stale) };
      (block.notes ||= []).push({ ...anchor, id: 'old-note-' + i, body: 'Legacy note on ' + sample.quote });
      (block.highlights ||= []).push({ ...anchor, id: 'old-color-' + i, color: 'amber' });
    }
    paper.inspectorOpen = true;
    fs.writeFileSync(paperFile, JSON.stringify(paper));
    app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    async function action(name) {
      await page.locator('#block-' + blocks[start].id).getByRole('button', { name: 'Paragraph actions', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    }
    async function waitCount(count) {
      await page.waitForFunction(async ({ id, count }) => (await window.paperBridge.loadPaper(id)).blocks.length === count, { id, count });
    }
    async function check(stage) {
      const saved = read().blocks, result = [];
      for (const [i, sample] of samples.entries()) {
        const at = saved.findIndex(block => block.notes?.some(note => note.id === 'old-note-' + i));
        assert.ok(at >= 0, sample.quote);
        const block = saved[at], note = block.notes.find(n => n.id === 'old-note-' + i);
        const mark = block.highlights.find(h => h.id === 'old-color-' + i);
        const valid = !sample.ambiguous && !sample.stale;
        const row = page.locator('.annotation-row').filter({ hasText: note.body });
        if (stage !== 'before') {
          assert.equal(!note.needsReview, valid, stage + ': ' + sample.quote);
          assert.equal(!mark.needsReview, valid);
          if (valid) assert.equal(mark.offset, note.offset);
        }
        const offset = valid ? block.text.indexOf(note.text) : -1;
        if (valid) {
          if (stage !== 'before') assert.equal(note.offset, offset);
          await row.locator('.annotation-navigate').click();
          await page.waitForFunction(text => getSelection()?.toString() === text, sample.quote);
          const place = await page.locator('#block-' + block.id + ' .source-text').evaluate(host => {
            const range = getSelection().getRangeAt(0);
            if (!host.contains(range.startContainer)) return -1;
            const prefix = document.createRange(); prefix.selectNodeContents(host); prefix.setEnd(range.startContainer, range.startOffset);
            return prefix.toString().length;
          });
          assert.equal(place, offset);
        }
        result.push({ quote: sample.quote, block: at - start, offset });
      }
      result.sort((a, b) => a.quote < b.quote ? -1 : a.quote > b.quote ? 1 : 0);
      if (reference) assert.deepEqual(result, reference[stage], 'Native range recovery after ' + stage);
      return result;
    }
    const before = await check('before');
    await action('Merge with Next'); await waitCount(blocks.length - 1);
    const merged = await check('merged');
    await action('Reflow at Full Sentences');
    await page.waitForFunction(async ({ id, oldCount }) => (await window.paperBridge.loadPaper(id)).blocks.length > oldCount,
      { id, oldCount: blocks.length - 1 });
    const reflowed = await check('reflowed');
    assert.ok(reflowed.find(item => item.quote === 'kernel density proposal').block > 0, 'The final annotation must move into the new paragraph');
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await waitCount(blocks.length - 1); await check('undo');
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader'); assert.deepEqual(await check('merged'), merged);
    console.log(JSON.stringify({ dir, before, merged, reflowed, undoAndRestart: true, native: Boolean(reference) }));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
