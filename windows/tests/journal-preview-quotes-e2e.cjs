// Compare quotes saved by the Windows reader with the original WebKit preview of Tabbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'journal-preview-quotes-'));
  const markdown = fs.readFileSync(path.join(__dirname, 'mac-parity/tabbed/article.md'), 'utf8').replaceAll('\r\n', '\n');
  const samples = require('./mac-parity/tabbed/selection-cases.json');
  const native = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).journalPreviewQuotes;
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown), id = createHash('sha256').update(markdown).digest('hex');
  const file = path.join(dir, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ id, type: 'text', name: 'Tabbed', sourceMode: 'mineru', mineruMarkdown: markdown, mineruBlocks: blocks, blocks,
    inspectorOpen: true, position: { tab: 'Paper', displayMode: 'source', block: 1 } }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const previous = process.env.PAPERBRIDGE_PREVIOUS_EXECUTABLE;
  const launch = (executablePath = exe) => electron.launch({ ...(executablePath && { executablePath }), cwd: root, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch(previous || exe);
  const observed = {};
  const notes = () => {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return [...saved.viewNotes || [], ...saved.blocks.flatMap(b => b.notes || [])].sort((a, b) => a.body.localeCompare(b.body));
  };
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Paper');
    const article = page.locator('.document-preview');
    for (const sample of samples) {
      const copied = await article.evaluate((host, { start, end }) => {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
        const a = nodes.findIndex(n => n.data.includes(start)), b = nodes.findIndex((n,i) => i >= a && n.data.includes(end));
        if (a < 0 || b < 0) throw Error('Missing printed text ' + start + ' / ' + end);
        const range = new Range();
        range.setStart(nodes[a], nodes[a].data.indexOf(start)); range.setEnd(nodes[b], nodes[b].data.indexOf(end) + end.length);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return getSelection().toString();
      }, sample);
      const quote = page.locator('.inspector blockquote').first();
      await quote.filter({ hasText: sample.end }).waitFor();
      const saved = await quote.textContent();
      observed[sample.name] = { copied, saved, expected: native?.[sample.name] };
      await page.getByLabel('Note for selected passage').fill(sample.name);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, body }) => {
        const paper = await window.paperBridge.loadPaper(id);
        return [...paper.viewNotes || [], ...paper.blocks.flatMap(b => b.notes || [])].some(n => n.body === body);
      }, { id, body: sample.name });
    }
    const originals = notes();
    await app.close(); app = await launch(); page = await app.firstWindow();
    for (const sample of samples) {
      await openWorkspaceView(page, 'Reader');
      await page.locator('.annotation-row').filter({ has: page.getByText(sample.name, { exact: true }) }).getByRole('button').first().click();
      await page.waitForFunction(end => getSelection()?.toString().includes(end), sample.end);
      assert.equal(await page.getByLabel('Note for selected passage').inputValue(), sample.name);
      const record = observed[sample.name];
      record.reopened = await page.locator('.inspector blockquote').first().textContent();
    }
    const destination = path.join(dir, 'notes.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    const signature = records => records.map(n => [n.id, n.body, n.createdAt, n.offset, n.displayOffset, n.text]);
    assert.deepEqual(signature(notes()), signature(originals));
    console.log(JSON.stringify({ workspace: dir, observed, upgraded: Boolean(previous) }));
    if (!process.argv.includes('--observe')) {
      assert.ok(native, 'Supply the native macOS journal selections');
      for (const [name, result] of Object.entries(observed)) {
        if (!previous) assert.equal(result.saved, native[name], name + ' saved quote');
        assert.equal(result.reopened, native[name], name + ' reopened quote');
        assert.ok(exported.includes('> ' + native[name].replace(/\r?\n/g, '\n> ')), name + ' exported quote');
      }
    }
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
