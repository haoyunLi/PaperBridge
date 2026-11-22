const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { readMineruMarkdown } = require('../electron/mineru-output.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const { observeResource } = require('./mac-parity/observe-resource.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), fixtures = path.join(__dirname, 'mac-parity');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'nested-resource-'));
  const source = fs.readFileSync(path.join(fixtures, 'nested-resource.md'), 'utf8');
  const id = createHash('sha256').update(source).digest('hex');
  const bundle = path.join(workspace, 'mineru', id, 'paper', 'auto');
  fs.mkdirSync(path.join(bundle, 'images'), { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'tabbed', 'images', 'page_2_chart_5.jpg'), path.join(bundle, 'images', 'panel.jpg'));
  const output = path.join(bundle, 'paper.md');
  fs.writeFileSync(output, source);
  const markdown = readMineruMarkdown(output);
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown);
  assert.deepEqual(blocks.map(item => item.markdownKind), ['heading', 'paragraph', 'html', 'paragraph']);
  const paper = { id, name: 'Calibration record', type: 'text', sourceMode: 'mineru', blocks, mineruBlocks: blocks, mineruMarkdown: markdown,
    connectedTranslation: markdown, inspectorOpen: true, position: { tab: 'Paper', displayMode: 'bilingual', block: 1 }, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const expected = process.env.PAPERBRIDGE_MAC_REFERENCE
    ? JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).nestedResource
    : { expanded: true, collapsed: true, summary: 'Calibration measurements', tableCaption: 'Response at room temperature',
      columns: 3, headerSpans: [2, 2], readings: ['Reference', '0.8', '1.2'], figureCaption: 'Reference response R0 and corrected reading.',
      subscript: '0', image: ['Tabbed comparison panel', 530, 418], sameFigure: true };
  assert.ok(expected?.sameFigure);
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    for (const tab of ['Paper', 'Reader', 'Full Translation']) {
      await openWorkspaceView(page, tab);
      const host = page.locator('[data-markdown-host]').filter({ has: page.locator('details > summary', { hasText: 'Calibration measurements' }) }).first();
      const result = await host.evaluate(observeResource);
      assert.deepEqual(result, expected, tab + ' must retain the complete calibration panel');
      assert.equal(await host.getByRole('img', { name: 'Tabbed comparison panel' }).isVisible(), false);
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    const saved = page.locator('[data-view-scope="fullTranslation"]');
    assert.deepEqual(await saved.evaluate(observeResource), expected, 'Restored translation must open its figure offline');
    await saved.locator('summary').click();
    await saved.locator('figcaption').evaluate(caption => {
      const range = document.createRange();
      range.selectNodeContents(caption);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      caption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const note = 'Recheck the caption against the reference measurements.';
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await openWorkspaceView(page, 'Reader');
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: note }).locator('button').first().click();
    const restored = page.locator('[data-view-scope="fullTranslation"]');
    await restored.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-view-scope="fullTranslation"] details')?.open === true, { }, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.getSelection().toString()), expected.figureCaption);
    assert.equal(await page.locator('.inspector textarea').inputValue(), note);
    console.log(JSON.stringify({ views: 3, reopened: true, noteRestored: true, image: expected.image, native: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
