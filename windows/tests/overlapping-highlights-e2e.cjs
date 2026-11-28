const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const sample = require('./mac-parity/overlap-highlights.json');

function selectText(host, quote) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let all = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: all.length, end: all.length + node.length });
    all += node.textContent;
  }
  const start = all.indexOf(quote), end = start + quote.length;
  if (start < 0 || start !== all.lastIndexOf(quote)) throw Error('Missing exact range: ' + quote);
  const first = nodes.find(item => item.end > start), last = nodes.find(item => item.end >= end);
  const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

function coloredText(host) {
  const ranges = ['amber', 'teal', 'coral'].flatMap(color => [...CSS.highlights.get('paperbridge-' + color) || []]
    .filter(range => host.contains(range.startContainer)).map(range => ({ range, color })));
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const runs = [];
  let previous;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const mark = node.parentElement.closest('mark');
    for (let i = 0; i < node.length; i++) {
      const colors = ranges.filter(({ range }) => range.isPointInRange(node, i) && range.isPointInRange(node, i + 1)).map(item => item.color);
      if (mark) colors.push(mark.className.replace(/^mark-/, ''));
      const color = colors.join('+');
      if (color && previous === color) runs.at(-1)[1] += node.data[i];
      else if (color) runs.push([color, node.data[i]]);
      previous = color;
    }
  }
  return runs;
}

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'overlapping-marks-'));
  const id = 'e'.repeat(64);
  fs.mkdirSync(path.join(dir, 'papers'));
  fs.writeFileSync(path.join(dir, 'papers', id + '.json'), JSON.stringify({ id, type: 'text', name: 'Ensemble sampling', sourceMode: 'text',
    blocks: [{ id: 1, text: sample.text, notes: [], highlights: [{ id: 'missing-range', text: 'MCMC', color: 'amber' }] }], inspectorOpen: true,
    summary: { source: sample.text.replace('A Python', '**A Python**'), target: '取样工具。', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [] },
    position: { tab: 'Reader', displayMode: 'bilingual', block: 1 } }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  const first = [['amber', 'ensemble '], ['coral', 'sampling '], ['teal', 'toolkit for'], ['coral', ' affine-invariant']];
  const recolored = first.map(([color, text]) => [color === 'amber' ? 'teal' : color, text]);
  const expected = process.env.PAPERBRIDGE_MAC_REFERENCE ?
    JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).overlappingHighlights :
    { initial: first, recolored, removed: [['teal', 'ensemble sampling toolkit for']], reopened: recolored };
  assert.deepEqual(expected.initial, first);
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const surfaces = { Reader: '#block-1 .source-text', Overview: '[data-view-scope="summarySource"] [data-markdown-host]' };
    for (const [tab, selector] of Object.entries(surfaces)) {
      await openWorkspaceView(page, tab);
      const host = page.locator(selector);
      async function pick(i) {
        await host.evaluate(selectText, sample.marks[i].quote);
        assert.equal(await page.locator('.inspector-quote-text').textContent(), sample.marks[i].quote);
      }
      async function colorWith(color) {
        const button = page.locator('.inspector-primary .highlight.' + color);
        await button.click();
        await page.waitForFunction(color => document.querySelector('.inspector-primary .highlight.' + color)?.getAttribute('aria-pressed') === 'true', color);
      }
      for (const [i, mark] of sample.marks.entries()) { await pick(i); await colorWith(mark.color); }
      await page.locator('.inspector textarea').fill(tab + ' overlap note');
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      assert.deepEqual(await host.evaluate(coloredText), expected.initial, tab + ' first three overlaps');
      await page.emulateMedia({ forcedColors: 'active', colorScheme: tab === 'Reader' ? 'light' : 'dark' });
      const controls = page.locator('.inspector .highlight-controls');
      assert.deepEqual(await controls.locator('.highlight').allInnerTexts(), ['Amber', 'Cobalt', 'Coral']);
      const strokes = await host.evaluate(el => ['amber', 'teal', 'coral'].map(color => {
        const mark = el.querySelector('mark.mark-' + color);
        const style = mark ? getComputedStyle(mark) : getComputedStyle(el, '::highlight(paperbridge-' + color + ')');
        return style.textDecorationStyle;
      }));
      assert.deepEqual(strokes, ['solid', 'double', 'dotted'], tab + ' exposes three distinct markings in contrast themes');
      await pick(0); await colorWith('teal');
      assert.deepEqual(await host.evaluate(coloredText), expected.recolored, tab + ' recoloring an earlier mark');
      await pick(1);
      await page.locator('.inspector-primary').getByRole('button', { name: 'Remove Highlight', exact: true }).click();
      await page.locator('.inspector-primary .remove-selection-highlight').waitFor({ state: 'detached' });
      assert.deepEqual(await host.evaluate(coloredText), expected.removed, tab + ' exposing the underlying color');
      await page.getByTitle('Undo last highlight or note change', { exact: true }).click();
      await page.locator('.inspector-primary .highlight.coral[aria-pressed="true"]').waitFor();
      assert.deepEqual(await host.evaluate(coloredText), expected.reopened, tab + ' restores the same painting after Undo');
      await page.emulateMedia({ forcedColors: 'none', colorScheme: null });
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    const compact = process.argv.includes('--compact');
    await page.getByRole('heading', { name: 'Ensemble sampling', exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }, compact) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(compact ? 980 : 1450, compact ? 760 : 895);
      win.webContents.setZoomFactor(compact ? 1.35 : 1.25);
    }, compact);
    if (compact) {
      await page.waitForFunction(() => innerWidth <= 800 && innerHeight > 480);
      await page.reload();
      await page.getByRole('heading', { name: 'Ensemble sampling', exact: true }).waitFor();
      const sidebar = page.locator('#document-sidebar');
      const state = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, sidebar: getComputedStyle(document.querySelector('.sidebar')).display }));
      console.log(JSON.stringify({ restored: state }));
      if (process.argv.includes('--observe')) return;
      assert.equal(await sidebar.isVisible(), false);
      const toggle = page.getByRole('button', { name: 'Show Document Sidebar', exact: true });
      await toggle.click();
      const search = sidebar.getByRole('textbox', { name: 'Search papers or tags', exact: true });
      await search.fill('Ensemble');
      await search.press('Escape');
      await sidebar.waitFor({ state: 'hidden' });
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
      await toggle.click();
      assert.equal(await search.inputValue(), 'Ensemble');
      await sidebar.getByRole('button', { name: 'Close Document Sidebar' }).click();
    }
    for (const [tab, selector] of Object.entries(surfaces)) {
      await openWorkspaceView(page, tab);
      const host = page.locator(selector);
      await host.waitFor();
      assert.deepEqual(await host.evaluate(coloredText), expected.reopened, tab + ' after restart and zoom');
      await page.locator('.annotation-row').filter({ hasText: tab + ' overlap note' }).locator('.annotation-navigate').click();
      await page.waitForFunction(quote => getSelection().toString() === quote, sample.marks[2].quote);
      assert.equal(await page.locator('.inspector textarea').inputValue(), tab + ' overlap note');
    }
    console.log(JSON.stringify({ dir, plainAndFormatted: true, states: Object.keys(expected), zoom: compact ? 1.35 : 1.25, native: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
