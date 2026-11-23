// Opt-in integration check with the public arXiv PDF, version 7 of 1706.03762.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'attention-note-'));
  const bytes = fs.readFileSync(process.env.PAPERBRIDGE_ATTENTION_PDF || path.join(artifacts, 'attention-is-all-you-need.pdf'));
  const id = createHash('sha256').update(bytes).digest('hex');
  assert.equal(id, 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, pdfExtractionMode: 'pdfOnly',
    onboardingCompletedVersion: 1, autoCheckUpdates: false, aiProvider: 'ollama', translationModel: 'translategemma:4b' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await page.evaluate(encoded => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'Attention Is All You Need.pdf', { type: 'application/pdf' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, bytes.toString('base64'));
    await page.getByText(/Extracted \d+ blocks from 15 pages/).first().waitFor({ timeout: 60000 });
    const getPaper = () => page.evaluate(id => window.paperBridge.loadPaper(id), id);
    const paper = await getPaper();
    const main = paper.blocks.find(b => b.text.includes('yielding dv-dimensional'));
    assert.equal(main.page, 4);
    assert.equal(main.endPage, 5, 'The prose above footnote 4 must continue at the start of page 5');
    assert.match(main.text, /yielding dv-dimensional output values\. These are concatenated/);
    const note = paper.blocks.find(b => b.page === 4 && b.pdfFootnoteMarker === '4');
    assert.ok(note?.text.startsWith('4To illustrate why the dot products get large'));
    assert.ok(!main.text.includes('To illustrate why') && !note.text.includes('output values'));
    const formula = '∑_{i=1}^{d_{k}} q_{i} k_{i}';
    assert.ok(note.text.includes(formula));
    assert.equal(paper.blocks.filter(b => b.page === 4 && /^P$/.test(b.text)).length, 0);
    assert.ok(paper.blocks.some(b => b.page === 8 && b.pdfFootnoteMarker === '5'));
    await openWorkspaceView(page, 'Reader');
    const row = page.locator('#block-' + note.id);
    await row.locator('.source-text').scrollIntoViewIfNeeded();
    assert.ok((await row.locator('.source-text').innerText()).includes(formula));
    await row.getByRole('button', { name: /Bookmark/ }).click();
    const report = { pages: [main.page, main.endPage], footnote: note.id, formula, workspace: dir };
    if (process.argv.includes('--figures')) {
      assert.ok(paper.blocks.some(b => b.page === 13 && b.text === 'Attention Visualizations'));
      assert.ok(paper.blocks.every(b => !b.text.includes('Input-Input Layer5')));
      const axes = paper.blocks.filter(b => b.page >= 13 && b.text.includes('<EOS>'));
      assert.deepEqual([13, 14, 15].map(n => axes.filter(b => b.page === n).length), [2, 4, 4]);
      for (const axis of axes) {
        const phrase = axis.page === 13 ? 'It is in this spirit that a majority' : 'The Law will never be perfect';
        assert.ok(axis.text.startsWith(phrase) && axis.text.endsWith('<pad>'));
        assert.ok(axis.text.includes(axis.page === 13 ? 'registration or voting process more difficult' : 'what we are missing'));
      }
      const captions = [13, 14, 15].map(n => paper.blocks.find(b => b.page === n && b.text.startsWith('Figure ' + (n - 10) + ':')));
      assert.ok(captions.every(Boolean));
      assert.ok(captions[1].text.includes('Top: Full attentions for head 5. Bottom:') && captions[1].text.endsWith('sharp for this word.'));
      const caption = page.locator('#block-' + captions[1].id);
      if (process.argv.includes('--live')) {
        await caption.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
        const translated = caption.locator('.translation-text.done');
        await translated.waitFor({ timeout: 120000 });
        report.captionTranslation = await translated.innerText();
        assert.match(report.captionTranslation, /\p{Script=Han}/u);
      }
      report.figureAxes = axes.length;
      report.captions = captions.map(b => b.id);
    }
    if (process.argv.includes('--live')) {
      await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
      const translated = row.locator('.translation-text.done');
      await translated.waitFor({ timeout: 120000 });
      report.translation = await translated.innerText();
      assert.ok(/^4/.test(report.translation) && /\p{Script=Han}/u.test(report.translation));
      assert.ok(report.translation.includes(formula), 'The translated footnote changed the mathematical terms: ' + report.translation);
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    const saved = await getPaper();
    const persisted = saved.blocks.find(b => b.id === note.id);
    assert.ok(persisted.bookmark && persisted.text === note.text);
    if (report.translation) assert.ok(persisted.translation.includes(formula));
    if (report.captionTranslation) assert.equal(saved.blocks.find(b => b.id === report.captions[1]).translation, report.captionTranslation);
    assert.equal(saved.blocks.find(b => b.id === main.id).endPage, 5);
    const original = Buffer.from(await page.evaluate(id => window.paperBridge.readPdf(id), id));
    assert.ok(bytes.equals(original));
    console.log(JSON.stringify({ ...report, originalUnchanged: true, reopened: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
