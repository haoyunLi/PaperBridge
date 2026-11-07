const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Atomic save or layout in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'reader-toolbar-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  const id = crypto.createHash('sha256').update('Reader toolbar and search position fixture').digest('hex');
  const paperPath = path.join(workspace, 'papers', `${id}.json`);
  const readPaper = () => JSON.parse(fs.readFileSync(paperPath, 'utf8'));
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const document = {
    id, name: 'Reader toolbar layout review', type: 'text', extraction: 'Pasted text',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inspectorOpen: true,
    taskSettings: settings, position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } },
    blocks: Array.from({ length: 30 }, (_, index) => ({
      id: index + 1, status: 'ok',
      text: `Passage ${index + 1}. ${index === 2 ? 'Unique search destination. ' : ''}` +
        'The study compares evidence across independent experiments and explains the limits of the result. '.repeat(7),
      translation: `段落 ${index + 1}。${index === 3 ? '检索目标。' : ''}` + '这项研究比较独立实验的证据，并解释结果的适用范围。'.repeat(8)
    }))
  };
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(paperPath, JSON.stringify(document));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  const launch = async () => {
    const instance = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    await instance.firstWindow();
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    return instance;
  };
  let app;
  let page;
  try {
    app = await launch();
    page = await app.firstWindow();
    await page.locator('#block-1').waitFor({ timeout: 20000 });
    const scroll = () => page.locator('.main-scroll').evaluate(host => host.scrollTop);
    const firstBlock = () => page.evaluate(() => {
      const host = document.querySelector('.main-scroll');
      return document.querySelector('.reader-list') && [...document.querySelectorAll('.reader-list > .block')]
        .find(block => block.getBoundingClientRect().bottom > host.getBoundingClientRect().top + 12)?.id;
    });
    const search = () => page.getByRole('textbox', { name: 'Search original or translation', exact: true });
    const mode = label => page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: label, exact: true });
    const toBlock = async id => {
      await page.evaluate(id => {
        const host = document.querySelector('.main-scroll');
        const block = document.getElementById(`block-${id}`);
        host.scrollTop += block.getBoundingClientRect().top - host.getBoundingClientRect().top + 25;
      }, id);
      await waitFor(async () => (await firstBlock()) === `block-${id}` && readPaper().position.block === id &&
        Math.abs(readPaper().position.scrollByTab.Reader - await scroll()) < 2, 'Reader origin saved');
    };
    const toolbarFits = async () => {
      const metrics = await page.evaluate(() => {
        const toolbar = document.querySelector('.reader-top');
        const box = toolbar.getBoundingClientRect();
        const main = document.querySelector('.main-scroll').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, mainTop: main.top, height: innerHeight,
          overflow: toolbar.scrollWidth - toolbar.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth,
          controls: [...toolbar.querySelectorAll('input, button')].map(node => {
            const r = node.getBoundingClientRect();
            return r.left >= box.left && r.right <= box.right + 1 && r.top >= box.top && r.bottom <= box.bottom + 1;
          }) };
      });
      assert.ok(metrics.top >= 0 && metrics.bottom <= metrics.mainTop + 1 && metrics.bottom < metrics.height, JSON.stringify(metrics));
      assert.ok(metrics.overflow <= 1 && metrics.pageOverflow <= 1 && metrics.controls.every(Boolean), JSON.stringify(metrics));
      return metrics;
    };

    // Controls remain reachable above long text in both inspector arrangements.
    for (const size of [{ width: 1500, height: 900 }, { width: 1320, height: 820 }, { width: 980, height: 620 }]) {
      await page.setViewportSize(size);
      await toBlock(20);
      await toolbarFits();
      const origin = await scroll();
      await page.keyboard.press('Control+f');
      assert.equal(await search().evaluate(node => document.activeElement === node), true);
      assert.ok(Math.abs(await scroll() - origin) < 2, 'Find must not move the long document before capturing its position');
      await search().fill('Unique search destination');
      await page.waitForFunction(() => document.querySelectorAll('.reader-list > .block').length === 1);
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      await waitFor(async () => Math.abs(await scroll() - origin) < 2, 'clear search restores exact original offset');
      assert.equal(await firstBlock(), 'block-20');
      await toolbarFits();
      await page.screenshot({ path: path.join(workspace, `reader-${size.width}.png`) });
    }

    // Native radio keyboard control, target-language search, and Escape behavior.
    await mode('Bilingual').focus();
    await page.keyboard.press('ArrowRight');
    await waitFor(async () => await mode('Original').isChecked(), 'keyboard selects Original');
    await page.keyboard.press('ArrowRight');
    assert.equal(await mode('Translation').isChecked(), true);
    await mode('Bilingual').check();
    await toBlock(20);
    const beforeSearch = await scroll();
    await search().fill('检索目标');
    await page.waitForFunction(() => document.querySelectorAll('.reader-list > .block').length === 1 && document.querySelector('#block-4'));
    await search().press('Escape');
    assert.equal(await search().inputValue(), '');
    assert.equal(await search().evaluate(node => document.activeElement === node), false);
    await waitFor(async () => Math.abs(await scroll() - beforeSearch) < 2, 'Escape restores search origin');

    // Search must retain its paragraph when layout width and display mode change.
    await search().fill('Unique search destination');
    await page.setViewportSize({ width: 1500, height: 900 });
    await mode('Original').check();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await waitFor(async () => (await firstBlock()) === 'block-20', 'search origin survives reflow');
    await toolbarFits();

    // Undo is available without scrolling to the end of the document.
    const undo = page.getByRole('button', { name: 'Undo last change', exact: true });
    assert.equal(await undo.isDisabled(), true);
    await page.locator('#block-20 button[title="Bookmark"]').click();
    await undo.click();
    assert.equal(await page.locator('#block-20 button.bookmarked').count(), 0);
    assert.equal(await undo.isDisabled(), true);

    // A deferred clear must never apply a Reader offset to a newly opened tab.
    await search().fill('Unique search destination');
    await page.evaluate(() => {
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => {
        window.requestAnimationFrame = request;
        window.__releaseReaderRestore = () => request(callback);
        return 0;
      };
    });
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    const overviewOffset = await scroll();
    await page.evaluate(() => window.__releaseReaderRestore());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(Math.abs(await scroll() - overviewOffset) < 2, 'late Reader restoration must not scroll Overview');
    await waitFor(() => readPaper().position.readerSearchOrigin?.block === 20, 'Reader anchor retained off-tab');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await waitFor(async () => (await firstBlock()) === 'block-20', 'Reader remount consumes pending origin');

    // A mode switch during deferred Clear must reschedule restoration after reflow.
    await mode('Bilingual').check();
    await toBlock(20);
    await search().fill('Unique search destination');
    await page.waitForFunction(() => document.querySelectorAll('.reader-list > .block').length === 1);
    await page.evaluate(() => {
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => {
        window.requestAnimationFrame = request;
        window.__releaseReaderRestore = () => request(callback);
        return 0;
      };
    });
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await mode('Original').check();
    await page.evaluate(() => window.__releaseReaderRestore());
    await waitFor(async () => (await firstBlock()) === 'block-20' && !readPaper().position.readerSearchOrigin,
      'mode change completes deferred search-origin restoration');
    assert.equal(await search().inputValue(), '');
    assert.equal(await mode('Original').isChecked(), true);

    // History recorded outside Reader must retain its filtered viewport separately.
    await search().fill('evidence');
    await page.locator('#block-5').evaluate(block => {
      const host = document.querySelector('.main-scroll');
      host.scrollTop += block.getBoundingClientRect().top - host.getBoundingClientRect().top + 25;
    });
    await waitFor(async () => (await firstBlock()) === 'block-5', 'filtered viewport at block five');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Start Reading', exact: true }).click();
    await page.getByRole('button', { name: 'Back to previous reading location', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await waitFor(async () => (await firstBlock()) === 'block-5', 'cross-tab history retains filtered viewport');
    assert.equal(await search().inputValue(), 'evidence');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await waitFor(async () => (await firstBlock()) === 'block-20', 'history retains unfiltered search origin too');

    // Editing or undoing structure while filtered must discard obsolete block anchors.
    await search().fill('Unique search destination');
    await page.locator('#block-3').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    await page.getByRole('textbox', { name: 'Paragraph source', exact: true }).fill('Unique search destination repaired. The study documents corrected source text.');
    await page.getByRole('button', { name: 'Save edit', exact: true }).click();
    await waitFor(async () => await search().inputValue() === '' && (await firstBlock()) === 'block-3', 'source edit clears filter and reveals repaired block');
    await search().fill('Unique search destination');
    await undo.click();
    await waitFor(async () => await search().inputValue() === '' && (await firstBlock()) === 'block-3', 'structural undo clears filter and reveals restored block');
    await waitFor(() => !readPaper().position.readerSearchOrigin, 'obsolete search anchor removed after undo');

    // Filtering and scrolling the results must not replace the durable Reader position.
    await mode('Bilingual').check();
    await toBlock(20);
    const savedOrigin = readPaper().position.scrollByTab.Reader;
    await search().fill('Unique search destination');
    await page.locator('.main-scroll').evaluate(host => { host.scrollTop = 120; });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(readPaper().position.scrollByTab.Reader, savedOrigin);
    await app.close(); app = null;
    app = await launch(); page = await app.firstWindow();
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.locator('#block-20').waitFor({ timeout: 20000 });
    await waitFor(async () => (await firstBlock()) === 'block-20', 'reopen unfiltered Reader location');
    assert.equal(await search().inputValue(), '');

    // Find from another surface waits for the Reader toolbar to mount.
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.keyboard.press('Control+f');
    await waitFor(async () => await search().evaluate(node => document.activeElement === node), 'Find focuses mounted Reader');
    await toolbarFits();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
    await toolbarFits();
    await page.screenshot({ path: path.join(workspace, 'reader-150-percent.png') });
    await page.emulateMedia({ forcedColors: 'active' });
    await mode('Bilingual').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await mode('Original').evaluate(node => node.matches(':focus-visible')), true);
    await toolbarFits();
    console.log(JSON.stringify({ passed: true, workspace, sizes: [1500, 1320, 980], checked: ['fixed toolbar', 'native radio keyboard', 'search clear and Escape', 'reflow origin', 'undo', 'deferred clear across tabs', 'deferred clear across display modes', 'filtered cross-tab history', 'filtered structural edit and undo', 'filtered restart', 'Find across tabs', '150% zoom', 'high contrast focus'] }));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)).catch(() => {});
      await app.close();
    }
    await new Promise(resolve => ollama.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
