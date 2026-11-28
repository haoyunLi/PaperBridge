const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'rich-review-'));
  const article = fs.readFileSync(path.join(__dirname, 'mac-parity', 'tabbed', 'article.md'), 'utf8');
  const table = article.split(/\r?\n\r?\n/).find(part => part.startsWith('| Software |'));
  assert.ok(table);
  const retained = 'Row Equality Only';
  const removed = 'Columns Only';
  const changed = table.replace('Software |', 'Software package name |')
    .replace(removed, '[Selected columns](data.md "Columns Only")');
  const { renderedMarkdownText } = await import('../src/markdownRendering.mjs');
  const { selectionOffsets } = await import('../src/markdownAnchors.mjs');
  const oldText = renderedMarkdownText(table), currentText = renderedMarkdownText(changed);
  function note(id, text, context, offset, extras = {}) {
    assert.equal(context.slice(offset, offset + text.length), text);
    const captured = selectionOffsets({ text, offset, context }, null, table, table);
    return { id, scope: 'reader', kind: 'source', text, offset: null, renderedAnchor: captured.renderedAnchor, body: id, ...extras };
  }
  const notes = [
    note('Moved unique cell', retained, oldText, oldText.indexOf(retained)),
    note('Removed visible cell', removed, oldText, oldText.indexOf(removed)),
    note('Changed repeated sign', '+', oldText, oldText.indexOf('+')),
    note('Exact repeated sign', '+', currentText, currentText.lastIndexOf('+')),
    { id: 'Original offset in hidden title', body: 'Original offset in hidden title', scope: 'reader', kind: 'source',
      text: removed, offset: table.indexOf(removed) },
    { id: 'Missing translated phrase', body: 'Missing translated phrase', scope: 'reader', kind: 'translation',
      text: '旧译文', offset: 0 }
  ];
  const block = { id: 1, text: changed, sourceMarkdown: changed, translation: '新的译文', translationMarkdown: '**新的译文**',
    status: 'ok', notes, highlights: [], translationHighlights: [] };
  const id = 'a'.repeat(64);
  fs.mkdirSync(path.join(dir, 'papers'));
  fs.writeFileSync(path.join(dir, 'papers', id + '.json'), JSON.stringify({ id, type: 'text', name: 'Tabbed comparison',
    sourceMode: 'text', blocks: [block], inspectorOpen: true, selectedParagraphID: 1, position: { tab: 'Reader', displayMode: 'bilingual', block: 1 } }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const expected = [true, false, false, true, false, false];
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
    const reference = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
    assert.deepEqual(reference.richAnnotationRanges, expected);
  }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    const row = body => page.locator('.annotation-row').filter({ has: page.getByText(body, { exact: true }) });
    async function status() {
      const available = [];
      for (const saved of notes) available.push(!(await row(saved.body).locator('.annotation-label').innerText()).includes('review needed'));
      return available;
    }
    assert.deepEqual(await status(), expected, 'Check every label before clicking any saved note');
    for (const index of [0, 3]) {
      await row(notes[index].body).locator('.annotation-navigate').click();
      await page.waitForFunction(text => window.getSelection()?.toString() === text, notes[index].text);
      assert.equal(await page.locator('.inspector textarea').inputValue(), notes[index].body);
    }
    const destination = path.join(dir, 'notes.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    for (const saved of notes) assert.ok(exported.includes(saved.body));
    assert.equal((exported.match(/source changed, review needed/g) || []).length, 4);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    assert.deepEqual(await status(), expected);
    console.log(JSON.stringify({ dir, available: expected, verifiedExportAndRestart: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
