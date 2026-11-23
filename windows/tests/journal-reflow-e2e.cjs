const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'journal-reflow-'));
  const fixture = require('./mac-parity/good-enough/reader.json');
  const samples = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).journalReflows;
  const targets = samples.filter(s => s.target === 900);
  assert.deepEqual(targets.map(t => t.id), [9, 150]);
  const blocks = fixture.blocks.map(b => ({ ...b, status: b.translation ? 'ok' : 'pending' }));
  for (const target of targets) {
    const block = blocks.find(b => b.id === target.id);
    const quote = target.parts.at(-1).slice(-40);
    const offset = block.text.lastIndexOf(quote);
    assert.ok(offset > 0);
    block.bookmark = true;
    block.notes = [{ id: 'source-' + target.id, scope: 'reader', kind: 'source', text: quote, offset, body: 'The measured passage.' }];
  }
  const id = fixture.sourceSHA256, file = path.join(dir, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(file));
  fs.mkdirSync(path.join(dir, 'pdfs'));
  fs.copyFileSync(path.join(__dirname, 'mac-parity/good-enough/article.pdf'), path.join(dir, 'pdfs', id + '.pdf'));
  fs.writeFileSync(file, JSON.stringify({ id, name: 'Good enough practices in scientific computing', type: 'pdf',
    sourceMode: 'pdf', pageCount: 20, blocks, pdfBlocks: blocks, position: { tab: 'Reader', block: 9 } }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  const persistedCount = async count => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const paper = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (paper.blocks.length === count) return paper;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw Error('Paragraph count did not become ' + count);
  };
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    for (const target of targets) {
      const first = target.id - 1, original = blocks[first], following = blocks[first + 1];
      await page.locator('#block-' + target.id).getByRole('button', { name: 'Paragraph actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Reflow at Full Sentences', exact: true }).click();
      const saved = await persistedCount(blocks.length + target.parts.length - 1);
      const pieces = saved.blocks.slice(first, first + target.parts.length);
      assert.deepEqual(pieces.map(b => b.text), target.parts);
      assert.ok(pieces[0].bookmark);
      const mark = pieces.at(-1).notes.find(n => n.id === original.notes[0].id);
      assert.equal(mark.needsReview, false);
      assert.equal(pieces.at(-1).text.slice(mark.offset, mark.offset + mark.text.length), original.notes[0].text);
      assert.equal(saved.blocks[first + target.parts.length].text, following.text);
      assert.equal(saved.blocks[first + target.parts.length].translation, following.translation);
      await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
      const undone = await persistedCount(blocks.length);
      assert.equal(undone.blocks[first].text, original.text);
      assert.equal(undone.blocks[first].translation, original.translation);
      assert.equal(undone.blocks[first].notes[0].offset, original.notes[0].offset);
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    const reopened = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    for (const { id: number } of targets) {
      const current = reopened.blocks[number - 1];
      assert.ok(current.bookmark);
      assert.equal(current.notes[0].text, blocks[number - 1].notes[0].text);
      assert.equal(current.text, blocks[number - 1].text);
    }
    console.log(JSON.stringify({ samples: samples.length, defaultAction: targets.map(t => t.id), paragraphs: reopened.blocks.length, notes: 2, undo: true, reopened: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
