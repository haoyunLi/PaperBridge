const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');

const cases = require('./mac-parity/mixed-direction-notes.json');

async function observe(host, sample) {
  await host.waitFor();
  return host.evaluate((node, { text, tokens }) => {
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const pieces = [];
    let part;
    while ((part = walk.nextNode())) pieces.push(part);
    const displayed = pieces.map(piece => piece.textContent).join('');
    if (displayed !== text) throw Error('Different text in the passage: ' + displayed);
    function endpoint(offset, end) {
      for (const piece of pieces) {
        const length = piece.textContent.length;
        if (offset < length || end && offset === length) return [piece, offset];
        offset -= length;
      }
      throw Error('Character outside passage');
    }
    const positions = tokens.map(token => {
      const start = text.indexOf(token);
      const range = new Range();
      range.setStart(...endpoint(start, false));
      range.setEnd(...endpoint(start + token.length, true));
      const box = range.getBoundingClientRect();
      return { token, left: box.left, right: box.right, center: box.left + box.width / 2 };
    });
    const bounds = node.getBoundingClientRect();
    const leftGap = Math.min(...positions.map(item => item.left)) - bounds.left;
    const rightGap = bounds.right - Math.max(...positions.map(item => item.right));
    return { text, alignedEdge: leftGap > rightGap ? 'right' : 'left',
      tokensFromLeft: positions.sort((a, b) => a.center - b.center).map(item => item.token) };
  }, sample);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'writing-direction-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false,
    translationModel: 'translategemma:4b', sourceLanguage: 'Simplified Chinese', targetLanguage: 'English' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1420, height: 850 });
    const area = await openPasteText(page);
    await area.fill(cases.map(sample => sample.text).join('\n\n'));
    const id = await loadPastedText(page, { view: 'Reader' });
    const blocks = await page.evaluate(async id => (await window.paperBridge.loadPaper(id)).blocks, id);
    assert.deepEqual(blocks.map(block => block.text), cases.map(sample => sample.text));
    const results = {};
    for (const view of ['Reader', 'Paper']) {
      await openWorkspaceView(page, view);
      const passage = page.locator(view === 'Reader' ? '.reader-list .source-text' : '.paper-preview-source');
      results[view] = [];
      for (const [index, sample] of cases.entries()) results[view].push(await observe(passage.nth(index), sample));
    }
    console.log(JSON.stringify(results));
    if (process.argv.includes('--observe')) return;
    const nativePath = process.env.PAPERBRIDGE_MAC_REFERENCE;
    const native = nativePath && JSON.parse(fs.readFileSync(nativePath, 'utf8')).writingDirections;
    if (nativePath) assert.equal(native?.length, cases.length, 'The Mac artifact must contain the same writing samples');
    const reference = native ? native.map(({ text, tokensFromLeft, alignedEdge }) => ({ text, tokensFromLeft, alignedEdge }))
      : cases.map(({ text, tokensFromLeft, alignedEdge }) => ({ text, tokensFromLeft, alignedEdge }));
    for (const data of Object.values(results)) assert.deepEqual(data, reference);

    await openWorkspaceView(page, 'Reader');
    let translation;
    if (process.argv.includes('--live')) {
      const row = page.locator('.reader-list article').last();
      await row.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const output = row.locator('.translation-text.done');
      await output.waitFor({ timeout: 150000 });
      translation = await output.innerText();
      assert.match(translation, /532\s*(?:nm|nanomet(?:er|re)s?)/i);
      assert.match(translation, /unchanged|constant|stable|did not change|same/i);
      console.log(JSON.stringify({ translation }));
    }
    const source = page.locator('.main-scroll[aria-busy="false"] .reader-list .source-text').first();
    // Switching back to Reader restores its saved scroll after layout. Measure the
    // glyphs only when the reader is ready and the passage can receive the mouse.
    await source.hover();
    await source.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const quote = 'מדידת האות';
    const drag = await source.evaluate((host, quote) => {
      const node = document.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode();
      const at = node.textContent.indexOf(quote);
      const glyph = i => { const r = new Range(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); };
      const first = glyph(at), last = glyph(at + quote.length - 1);
      return { from: first.right - 0.5, to: last.left + 0.5, y: first.top + first.height / 2 };
    }, quote);
    await page.mouse.move(drag.from, drag.y); await page.mouse.down();
    await page.mouse.move(drag.to, drag.y, { steps: 10 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), quote);
    const note = 'The Hebrew label identifies the signal measurement.';
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, quote }) => (await window.paperBridge.loadPaper(id)).blocks[0].notes.some(n => n.text === quote), { id, quote });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('.annotation-row').filter({ hasText: note }).locator('.annotation-navigate').click();
    await page.waitForFunction(quote => getSelection().toString() === quote, quote);
    if (translation) assert.equal(await page.locator('.reader-list article').last().locator('.translation-text.done').innerText(), translation);
    console.log('Right-to-left drag and navigation back to the saved note matched the same logical text after restart.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

