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
  const workspace = fs.mkdtempSync(path.join(artifacts, 'article-note-review-'));
  const id = 'a'.repeat(64);
  const article = fs.readFileSync(path.join(__dirname, 'mac-parity', 'tabbed', 'article.md'), 'utf8');
  const paragraph = article.split(/\r?\n\r?\n/).find(part => part.startsWith('Given that pandas'));
  const passages = paragraph.match(/.+?(?:\. (?=[A-Z])|\.$)/gu);
  assert.ok(passages.length >= 5);
  const blocks = passages.map((text, i) => ({ id: i + 1, text: text.trim(), notes: [], highlights: [] }));
  const notes = ['Reading speed comparison', 'Test data dimensions'];
  fs.mkdirSync(path.join(workspace, 'papers'));
  const file = path.join(workspace, 'papers', id + '.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ id, name: 'DSV speed comparison', type: 'text', sourceMode: 'text', blocks, inspectorOpen: true,
    position: { tab: 'Paper', displayMode: 'bilingual', block: 1 } }));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Paper');
    const quotes = [];
    for (const [index, note] of notes.entries()) {
      const start = 1 + 2 * index;
      const surface = page.locator('[data-view-scope="paperArticle"]');
      await surface.locator('[data-paper-block-id="1"] p').first().waitFor();
      await surface.evaluate((host, start) => {
        const first = host.querySelector('[data-paper-block-id="' + start + '"] [data-paper-kind="source"] p').firstChild;
        const last = host.querySelector('[data-paper-block-id="' + (start + 1) + '"] [data-paper-kind="source"] p').firstChild;
        const range = document.createRange();
        range.setStart(first, first.length - 16); range.setEnd(last, 16);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }, start);
      const quote = blocks[start - 1].text.slice(-16) + '\n' + blocks[start].text.slice(0, 16);
      assert.equal(await page.locator('.inspector blockquote').textContent(), quote.trim());
      await page.locator('.inspector textarea').fill(note);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, note }) => (await window.paperBridge.loadPaper(id)).viewNotes?.some(n => n.body === note), { id, note });
      quotes.push(quote.trim());
    }
    await app.close(); app = null;
    const saved = read();
    assert.deepEqual(saved.viewNotes.map(note => note.text), quotes);
    saved.blocks[0].text = 'Benchmark results. ' + saved.blocks[0].text;
    saved.blocks[3].text = 'The author removed this description.';
    fs.writeFileSync(file, JSON.stringify(saved));
    app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    const row = note => page.locator('.annotation-row').filter({ has: page.getByText(note, { exact: true }) });
    assert.doesNotMatch(await row(notes[0]).locator('.annotation-label').innerText(), /review needed/);
    assert.match(await row(notes[1]).locator('.annotation-label').innerText(), /review needed/);
    const destination = path.join(workspace, 'analysis.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    for (const note of notes) assert.ok(exported.includes(note));
    assert.equal((exported.match(/source changed, review needed/g) || []).length, 1);
    await row(notes[0]).locator('.annotation-navigate').click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper');
    assert.equal(await page.locator('.inspector blockquote').textContent(), quotes[0]);
    assert.equal(await page.locator('.inspector textarea').inputValue(), notes[0]);
    console.log(JSON.stringify({ workspace, savedCrossParagraphNotes: 2, recovered: 1, reviewBeforeClickAndExport: 1 }));
  } finally { if (app) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
