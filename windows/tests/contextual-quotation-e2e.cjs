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
  const workspace = fs.mkdtempSync(path.join(artifacts, 'context-notes-'));
  const fixtures = path.join(__dirname, 'mac-parity');
  const article = fs.readFileSync(path.join(fixtures, 'tabbed/article.md'), 'utf8');
  const passage = article.split(/\r?\n/).find(line => line.startsWith('To the best of our knowledge'));
  const quote = 'data section';
  assert.equal(passage.split(quote).length, 3);
  const draft = 'Calibration \\(C_{50}\\). The following passage describes the paper’s parsing criteria.\n\n'
    + passage.replaceAll(quote, 'data **section**');
  const id = 'c'.repeat(64), file = path.join(workspace, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, name: 'Tabbed', type: 'text', sourceMode: 'text', inspectorOpen: true,
    blocks: [{ id: 1, text: passage }], connectedTranslation: draft, position: { tab: 'Full Translation', block: 1 } }));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const launch = executablePath => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  const previous = process.env.PAPERBRIDGE_PREVIOUS_EXECUTABLE, current = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const bodies = ['Note on finding the start of the data', 'Note on reading individual rows'];
  let app = await launch(previous || current);
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Full Translation');
    for (const [index, body] of bodies.entries()) {
      const word = page.locator('[data-view-scope="fullTranslation"] strong').filter({ hasText: /^section$/ }).nth(index);
      await word.evaluate(element => {
        const first = element.previousSibling;
        const range = document.createRange();
        range.setStart(first, first.textContent.length - 'data '.length);
        range.setEnd(element.firstChild, 'section'.length);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      assert.equal(await page.locator('.inspector blockquote').textContent(), quote);
      await page.locator('.inspector textarea').fill(body);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, body }) => (await window.paperBridge.loadPaper(id)).viewNotes?.some(n => n.body === body), { id, body });
    }
    await app.close(); app = null;
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const originalOffsets = stored.viewNotes.map(note => note.renderedAnchor.offset);
    assert.notEqual(originalOffsets[0], originalOffsets[1]);
    if (!previous) {
      stored.connectedTranslation = 'A revised introduction precedes the experiment.\n\n' + stored.connectedTranslation;
      fs.writeFileSync(file, JSON.stringify(stored));
    }
    app = await launch(current);
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    for (const [index, body] of bodies.entries()) {
      const row = page.locator('.annotation-row').filter({ hasText: body });
      assert.doesNotMatch(await row.locator('.annotation-label').innerText(), /review needed/);
      await row.locator('.annotation-navigate').click();
      await page.waitForFunction(() => window.getSelection()?.toString() === 'data section');
      const occurrence = await page.evaluate(() => {
        const host = document.querySelector('[data-view-scope="fullTranslation"]');
        const end = window.getSelection().getRangeAt(0).endContainer;
        return [...host.querySelectorAll('strong')].findIndex(word => word.contains(end));
      });
      assert.equal(occurrence, index);
      assert.equal(await page.locator('.inspector textarea').inputValue(), body);
    }
    console.log(JSON.stringify({ workspace, originalOffsets, oldExecutable: Boolean(previous), recoveredOccurrences: [1, 2] }));
  } finally { if (app) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
