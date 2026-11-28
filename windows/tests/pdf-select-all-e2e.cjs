const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'pdf-select-all-'));
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly', inspectorOpen: true, quickLookupModel: 'translategemma:4b', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' });
  const file = process.argv.includes('--short') ? 'rotated-spectrometer.pdf' : 'good-enough/article.pdf';
  const source = path.join(__dirname, 'mac-parity', file), id = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).pdfSelectAll?.find(item => item.file === file);
  const count = file.startsWith('rotated') ? 4 : 20;
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch(), page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const host = () => page.locator('.pdf-continuous');
  try {
    await page.setViewportSize({ width: 1440, height: 840 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(file), exact: true }).waitFor({ timeout: 45000 });
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id && !document.querySelector('.task-progress'), id, { timeout: 60000 });
    await openWorkspaceView(page, 'Original');
    await page.locator('.textLayer[data-page="1"]').waitFor();
    await host().focus();
    if (count === 20 && !process.argv.includes('--observe')) {
      await page.evaluate(() => {
        window.__earlyCopy = null;
        if (!window.navigator.clipboard) throw Error('Missing clipboard support');
        Object.defineProperty(window.navigator.clipboard, 'write', { configurable: true, value: async items => {
          window.__earlyCopy = await (await items[0].getType('text/plain')).text();
        } });
        document.addEventListener('copy', event => {
          window.__earlyCopy = event.clipboardData.getData('text/plain'); event.preventDefault();
        }, { once: true });
      });
      await host().press('Control+a'); await host().press('Escape');
      await page.waitForFunction(() => document.querySelector('.pdf-continuous').getAttribute('aria-busy') === 'false');
      assert.ok(await page.evaluate(() => getSelection().isCollapsed));
    }
    await host().press('Control+a');
    if (count === 20 && !process.argv.includes('--observe')) await host().press('Control+c');
    if (process.argv.includes('--observe')) {
      console.log(await page.evaluate(() => {
        const host = document.querySelector('.pdf-continuous'), selection = getSelection();
        return { textLength: selection.toString().length, contained: host.contains(selection.anchorNode) && host.contains(selection.focusNode),
          selectedPages: [...host.querySelectorAll('.textLayer[data-page]')].filter(layer => selection.containsNode(layer, true)).length,
          includesSidebar: selection.containsNode(document.querySelector('.sidebar'), true) };
      })); return;
    }
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      assert.equal(reference?.sha256, id);
      assert.equal(reference.pages.length, count);
      assert.ok(reference.copied?.trim());
    }
    await page.waitForFunction(count => {
      const host = document.querySelector('.pdf-continuous'), selection = getSelection();
      return host?.getAttribute('aria-busy') === 'false' && host.contains(selection.anchorNode) && host.contains(selection.focusNode) &&
        Number(selection.focusNode.parentElement?.closest('[data-pdf-page]')?.dataset.pdfPage) === count;
    }, count, { timeout: 60000 });
    if (count === 20) await page.waitForFunction(() => window.__earlyCopy?.length > 30000, null, { timeout: 6000 });
    console.log('Selected PDF pages', count);
    const canvases = await host().locator('canvas').evaluateAll(nodes => nodes.filter(n => n.width > 1 && n.height > 1).length);
    assert.ok(canvases <= 5, 'Offscreen pages should not allocate full bitmap canvases');
    // Inspect the data supplied by a real Ctrl+C without replacing the local user's clipboard.
    await page.evaluate(() => document.addEventListener('copy', event => {
      window.__pdfCopy = event.clipboardData.getData('text/plain'); event.preventDefault();
    }, { once: true }));
    await host().press('Control+c');
    await page.waitForFunction(() => typeof window.__pdfCopy === 'string');
    const copied = await page.evaluate(() => window.__pdfCopy);
    fs.writeFileSync(path.join(workspace, 'copied-text.txt'), copied);
    assert.ok(copied.length > (count === 4 ? 350 : 30000));
    if (count === 20) {
      assert.equal(await page.evaluate(() => window.__earlyCopy), copied);
      assert.match(copied, /20\s*\/\s*20/);
      await page.evaluate(() => { delete window.navigator.clipboard.write; });
    }
    assert.doesNotMatch(copied, /Research Inspector|Hide Document Sidebar|Exact original PDF · page/);
    if (count === 4 && reference) {
      assert.equal(copied.replace(/\r\n/g, '\n'), reference.copied.replace(/\r\n/g, '\n'));
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      await host().press('Control+c');
      const data = await app.evaluate(({ clipboard }) => clipboard.readText());
      assert.equal(data.replace(/\r\n/g, '\n'), copied);
    }
    console.log('Copied characters', copied.length);
    if (process.argv.includes('--live')) {
      const inspector = page.locator('.inspector');
      await inspector.getByRole('button', { name: 'Translate', exact: true }).click();
      await inspector.getByText('Selection translated.', { exact: true }).waitFor({ timeout: 180000 });
      const translation = await inspector.locator('.inspector-result.translate p').innerText();
      assert.match(translation, /633/); assert.match(translation, /298/); assert.match(translation, /77/);
      assert.match(translation, /12|十二/); assert.match(translation, /[\u3400-\u9fff]/);
      const models = await (await fetch('http://127.0.0.1:11434/api/ps')).json();
      const model = models.models.find(item => item.name === 'translategemma:4b');
      assert.ok(model?.size_vram > 0);
      console.log(JSON.stringify({ translation, sizeVram: model.size_vram }));
      const line = page.locator('.textLayer[data-page="1"]').getByText('The initial signal was 12 counts.', { exact: true });
      await line.evaluate(node => {
        const text = node.firstChild, start = text.textContent.indexOf('counts');
        const range = new Range(); range.setStart(text, start); range.setEnd(text, start + 6);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await inspector.getByPlaceholder('Approved translation').fill('计数');
      await inspector.getByRole('button', { name: 'Save term', exact: true }).click();
      await page.getByText('Term saved for future translations.', { exact: true }).waitFor();
      await host().focus(); await host().press('Control+a');
      await inspector.locator('blockquote').filter({ hasText: 'Red laser measurement' }).waitFor();
      await inspector.getByRole('button', { name: 'Translate', exact: true }).click();
      await inspector.getByText('Selection translated.', { exact: true }).waitFor({ timeout: 180000 });
      const withGlossary = await inspector.locator('.inspector-result.translate p').innerText();
      assert.match(withGlossary, /计数/); assert.match(withGlossary, /633/);
      console.log(JSON.stringify({ withGlossary }));
    }
    await page.locator('.inspector textarea').fill('Whole document reviewed.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, count }) => (await window.paperBridge.loadPaper(id)).pdfNotes.some(note => note.anchors?.length === count), { id, count });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Original');
    await page.locator('.annotation-row').filter({ hasText: 'Whole document reviewed.' }).locator('.annotation-navigate').click();
    await page.waitForFunction(count => {
      const selection = getSelection();
      return Number(selection.focusNode?.parentElement?.closest('[data-pdf-page]')?.dataset.pdfPage) === count;
    }, count, { timeout: 60000 });
    if (count === 4) {
      await openWorkspaceView(page, 'Paper');
      await page.getByLabel('Paper display mode').selectOption('source');
      await host().focus(); await host().press('Control+a');
      await page.waitForFunction(() => document.querySelector('.pdf-continuous')?.contains(getSelection().focusNode) &&
        getSelection().focusNode?.parentElement?.closest('[data-pdf-page]')?.dataset.pdfPage === '4');
      const editor = page.locator('.inspector textarea');
      await editor.fill('Reviewer draft'); await editor.press('Control+a');
      assert.deepEqual(await editor.evaluate(node => [node.selectionStart, node.selectionEnd]), [0,14]);
    }
    assert.deepEqual(fs.readFileSync(store.pdfPath(id)), fs.readFileSync(source));
    console.log(JSON.stringify({ count, copiedCharacters: copied.length, canvases, savedPages: store.paper(id).pdfNotes[0].anchors.length }));
  } catch (error) {
    console.error(await page.evaluate(() => {
      const host = document.querySelector('.pdf-continuous'), selection = getSelection();
      return { busy: host?.getAttribute('aria-busy'), layers: host?.querySelectorAll('.textLayer[data-page]').length,
        length: selection.toString().length, inspector: document.querySelector('.inspector')?.innerText.slice(0, 220),
        focus: document.activeElement?.className, copied: window.__pdfCopy?.length };
    }).catch(() => null));
    await page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 3500 }).catch(() => {});
    throw error;
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
