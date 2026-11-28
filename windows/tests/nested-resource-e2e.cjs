const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { readMineruMarkdown } = require('../electron/mineru-output.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const { observeDeepResource } = require('./mac-parity/observe-deep-resource.cjs');
const { observeResource } = require('./mac-parity/observe-resource.cjs');

async function checkEquations(page, expected, tab) {
  const host = page.locator('.main-scroll');
  await host.locator('caption').filter({ hasText: 'Calibration of' }).first().waitFor();
  const observed = await host.evaluate(async root => {
    const formulas = [...root.querySelectorAll('td .katex, th .katex, caption .katex, figcaption .katex')].map(equation => ({
      tex: equation.querySelector('annotation[encoding="application/x-tex"]').textContent,
      display: Boolean(equation.closest('.katex-display')), in: equation.closest('td,th,caption,figcaption').localName
    }));
    const fonts = await document.fonts.load('16px KaTeX_Main');
    return { formulas, fontLoaded: fonts.some(face => face.status === 'loaded'),
      printed: root.querySelector('figcaption code')?.textContent };
  });
  assert.deepEqual(observed.formulas, expected, tab + ' formula source, display style and table cell');
  assert.equal(observed.fontLoaded, true, 'Offline KaTeX fonts must load from the app');
  assert.equal(observed.printed, '$x_1$', 'Printed source stays literal inside code');
}

async function checkTextEquations(page, expected, tab) {
  const host = page.locator('.main-scroll');
  await host.getByText('Dose response', { exact: true }).first().waitFor();
  const observed = await host.evaluate(root => {
    const start = [...root.querySelectorAll('h1')].find(heading => heading.textContent === 'Dose response');
    return [...root.querySelectorAll('.katex')].filter(math => start?.compareDocumentPosition(math) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map(math => ({ tex: math.querySelector('annotation').textContent.trim(), display: Boolean(math.closest('.katex-display')), in: '' }));
  });
  assert.deepEqual(observed, expected, tab + ' must typeset TeX in ordinary Markdown');
  assert.equal(await host.locator('code').filter({ hasText: '\\(literal\\)' }).first().textContent(), '\\(literal\\)');
}

async function run() {
  const root = path.resolve(__dirname, '..'), fixtures = path.join(__dirname, 'mac-parity');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'nested-resource-'));
  const deep = process.argv.includes('--deep'), equations = process.argv.includes('--equations');
  const tex = process.argv.includes('--tex');
  const source = fs.readFileSync(path.join(fixtures, 'nested-resource.md'), 'utf8')
    + (deep ? '\n' + fs.readFileSync(path.join(fixtures, 'deep-resource.md'), 'utf8') : '')
    + (equations ? '\n' + fs.readFileSync(path.join(fixtures, 'html-equations.md'), 'utf8') : '')
    + (tex ? '\n' + fs.readFileSync(path.join(fixtures, 'tex-delimiters.md'), 'utf8') : '');
  const id = createHash('sha256').update(source).digest('hex');
  const bundle = path.join(workspace, 'mineru', id, 'paper', 'auto');
  fs.mkdirSync(path.join(bundle, 'images'), { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'tabbed', 'images', 'page_2_chart_5.jpg'), path.join(bundle, 'images', 'panel.jpg'));
  const output = path.join(bundle, 'paper.md');
  fs.writeFileSync(output, source);
  const markdown = readMineruMarkdown(output);
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown);
  assert.deepEqual(blocks.map(item => item.markdownKind), ['heading', 'paragraph', 'html', 'paragraph', ...(deep ? ['html', 'paragraph'] : []),
    ...(equations ? ['heading', 'table', 'html'] : []), ...(tex ? ['heading', 'paragraph', 'formula', 'paragraph'] : [])]);
  const paper = { id, name: 'Calibration record', type: 'text', sourceMode: 'mineru', blocks, mineruBlocks: blocks, mineruMarkdown: markdown,
    connectedTranslation: markdown, inspectorOpen: true, position: { tab: 'Paper', displayMode: 'bilingual', block: 1 }, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const native = process.env.PAPERBRIDGE_MAC_REFERENCE
    ? JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')) : null;
  const expected = native ? native.nestedResource : { expanded: true, collapsed: true, summary: 'Calibration measurements', tableCaption: 'Response at room temperature',
      columns: 3, headerSpans: [2, 2], readings: ['Reference', '0.8', '1.2'], figureCaption: 'Reference response R0 and corrected reading.',
      subscript: '0', image: ['Tabbed comparison panel', 530, 418], sameFigure: true };
  assert.ok(expected?.sameFigure);
  const formulas = [{ tex: 'y=ax+b', display: false, in: 'caption' }, { tex: 'i', display: false, in: 'th' },
      { tex: '\\sigma_i^2', display: false, in: 'td' }, { tex: '\\frac{a}{b}', display: true, in: 'td' },
      { tex: 'R_0=\\sqrt{x}', display: true, in: 'figcaption' }];
  if (equations && native) {
    // The Mac preview escapes the inline <code> tag in this caption and typesets
    // the printed example as a sixth formula. Windows keeps that example literal.
    const nativeMath = native.htmlEquations.filter(item => !(item.in === 'figcaption' && item.tex === 'x_1' && !item.display));
    assert.deepEqual(nativeMath, formulas);
  }
  const typeset = [{ tex: 'C_{50}', display: false, in: '' }, { tex: 'x_1*x_2', display: false, in: '' },
    { tex: 'R(t)=\\frac{A}{1+t}', display: true, in: '' }];
  if (tex && native) assert.deepEqual(native.texDelimiters.map(item => ({ ...item, tex: item.tex.trim() })), typeset);
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    for (const tab of ['Paper', 'Reader', 'Full Translation']) {
      await openWorkspaceView(page, tab);
      if (equations) await checkEquations(page, formulas, tab);
      if (tex) await checkTextEquations(page, typeset, tab);
      const host = page.locator('[data-markdown-host]').filter({ has: page.locator('details > summary', { hasText: 'Calibration measurements' }) }).first();
      const result = await host.evaluate(observeResource);
      assert.deepEqual(result, expected, tab + ' must retain the complete calibration panel');
      assert.equal(await host.getByRole('img', { name: 'Tabbed comparison panel' }).isVisible(), false);
      if (deep) {
        if (native?.deepResource) {
          const actual = await page.locator('.main-scroll').evaluate(observeDeepResource);
          assert.deepEqual(actual, { outer: true, inner: true, nested: true, reading: '24 °C', explanation: true, outside: true });
          // WebKit preserves the outer panel and its explanation. The literal closing
          // tag in this sample's HTML comment ends the Mac structural segment early.
          assert.equal(native.deepResource.outer, actual.outer);
          assert.equal(native.deepResource.explanation, actual.explanation);
        }
        const toggle = page.locator('.main-scroll summary').filter({ hasText: /^Detailed measurements$/ }).first();
        const panel = toggle.locator('..');
        await toggle.click();
        await panel.getByText('The calibration applies to both instruments.', { exact: true }).waitFor();
        assert.equal(await panel.getByRole('cell', { name: '24 °C' }).count(), 0);
        await panel.locator('summary').filter({ hasText: /^Temperature series$/ }).click();
        await panel.getByRole('cell', { name: '24 °C' }).waitFor();
        await toggle.click();
        assert.equal(await panel.getByText('The calibration applies to both instruments.').isVisible(), false);
        const visibleProse = await page.locator('.main-scroll').evaluate(scroll => {
          const texts = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
          for (let node = texts.nextNode(); node; node = texts.nextNode()) {
            if (!node.textContent.includes('The final observation agrees with the control.')) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if (range.getBoundingClientRect().height && !node.parentElement.closest('details:not([open])')) return true;
          }
          return false;
        });
        assert.equal(visibleProse, true, tab + ' must show the discussion after the closed panel');
      }
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    const saved = page.locator('[data-view-scope="fullTranslation"]');
    assert.deepEqual(await saved.evaluate(observeResource), expected, 'Restored translation must open its figure offline');
    await saved.locator('summary').filter({ hasText: /^Calibration measurements$/ }).click();
    if (equations) await checkEquations(page, formulas, 'Reopened translation');
    if (tex) await checkTextEquations(page, typeset, 'Reopened translation');
    await saved.locator('details figcaption').evaluate(caption => {
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
    console.log(JSON.stringify({ views: 3, reopened: true, noteRestored: true, image: expected.image, deep, equations, tex, native: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
