const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Layout or a paper save may be settling. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'sidebar-layout-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  let generationRequests = 0;
  const ollama = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  const id = crypto.createHash('sha256').update('Scrolling sidebar layout fixture').digest('hex');
  const blocks = Array.from({ length: 28 }, (_, index) => [
    { id: index * 2 + 1, text: `${index + 1} Evidence and Reproducible Interpretation Across Independent Experiments`,
      heading: true, status: 'ok', translation: `章节 ${index + 1}`, bookmark: index === 1 },
    { id: index * 2 + 2, text: `Passage ${index + 1}. ` + 'This saved text supplies a stable destination for document navigation. '.repeat(4),
      heading: false, status: 'ok', translation: '这段已保存的文字用于检验文档导航。'.repeat(4) }
  ]).flat();
  const paper = { id, name: 'Scrolling sidebar review', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    blocks, taskSettings: settings, inspectorOpen: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } } };
  let app, page, cdp, failure;
  let minimumWidthBrand;
  let phase = 'launch';
  const samples = [];
  const rendererErrors = [];
  const fail = (error, label) => {
    failure ||= error;
    console.error(`[sidebar-layout] ${label}: ${error.stack || error}`);
  };
  const diagnostics = async filename => {
    const state = { phase, pid: app?.process()?.pid, rendererErrors };
    state.windows = app ? await bounded('window diagnostics', app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map(window => ({ bounds: window.getBounds(), visible: window.isVisible(),
        focused: window.isFocused(), zoom: window.webContents.getZoomFactor() }))), 3000).catch(error => ({ error: error.message })) : [];
    state.renderer = page && !page.isClosed() ? await bounded('renderer diagnostics', page.evaluate(() => ({
      width: innerWidth, height: innerHeight, visibility: document.visibilityState,
      sidebarScroll: document.querySelector('.sidebar-scroll')?.scrollTop,
      outlineRows: document.querySelectorAll('.document-outline .outline-row').length,
      dialog: document.querySelector('[role="dialog"] h2')?.textContent,
      activeElement: document.activeElement?.outerHTML.slice(0, 500)
    })), 3000).catch(error => ({ error: error.message })) : { closed: true };
    console.error(`[sidebar-layout] Diagnostics: ${JSON.stringify(state)}`);
    try { fs.writeFileSync(path.join(workspace, filename), JSON.stringify(state, null, 2)); }
    catch (error) { console.error(`[sidebar-layout] Cannot save diagnostics: ${error.message}`); }
  };
  try {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    page.on('pageerror', error => { rendererErrors.push(error.message); console.error(`Sidebar renderer error: ${error.stack || error}`); });
    page.setDefaultTimeout(15000);
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
      const hardware = { adapters: [], cudaDriver: null, cudaVersion: null, totalMemoryGB: 16 };
      const mineru = { installed: false, compatible: false, reason: 'No parser is needed for this text fixture.', runtime: { cuda: false } };
      for (const [channel, value] of Object.entries({ 'hardware:status': hardware, 'mineru:runtime': mineru,
        'mineru:status': mineru, 'setup:status': { hardware, mineru, ollama: { installed: true, running: true, models: [] },
          plan: { ollama: false, models: [], mineru: false, gpu: { reason: 'This layout fixture uses no GPU acceleration.' } }, busy: false } })) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => value);
      }
      globalThis.__sidebarLayoutInstalls = 0;
      ipcMain.removeHandler('setup:install');
      ipcMain.handle('setup:install', () => { globalThis.__sidebarLayoutInstalls++; throw new Error('No installation is allowed in a layout test.'); });
    });
    await page.setViewportSize({ width: 980, height: 620 });
    await page.reload();
    phase = 'empty-state order';
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    const sidebar = page.locator('#document-sidebar');
    const scroll = sidebar.locator('.sidebar-scroll');
    const library = sidebar.getByRole('button', { name: 'Paper Library', exact: true });
    const emptyOrder = await sidebar.evaluate(host => {
      const library = host.querySelector('.sidebar-library-button');
      const source = host.querySelector('.side-primary');
      return Boolean(source && (library.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(emptyOrder, true, 'The empty sidebar must show Paper Library before Source, like macOS');
    await library.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

    // Add a saved document after checking the real empty state; bootstrap restores it on reload.
    fs.writeFileSync(path.join(workspace, 'papers', `${id}.json`), JSON.stringify(paper));
    fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
    await page.reload();
    phase = 'saved outline';
    await page.locator('#block-1').waitFor({ timeout: 20000 });
    assert.equal(await sidebar.locator('.document-outline .outline-row').count(), 28,
      'The fixture must expose every numbered chapter through the actual text-heading detector');
    const visibleWithinSidebar = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const host = node.closest('.sidebar-scroll').getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          hostLeft: host.left, hostRight: host.right, hostTop: host.top, hostBottom: host.bottom,
          width: innerWidth, height: innerHeight };
      });
      assert.ok(bounds.left >= Math.max(0, bounds.hostLeft) - 1 && bounds.right <= Math.min(bounds.width, bounds.hostRight) + 1 &&
        bounds.top >= Math.max(0, bounds.hostTop) - 1 && bounds.bottom <= Math.min(bounds.height, bounds.hostBottom) + 1, JSON.stringify(bounds));
    };
    const noOverflow = async () => {
      const metrics = await sidebar.evaluate(host => {
        const scroll = host.querySelector('.sidebar-scroll');
        return { sidebar: host.scrollWidth - host.clientWidth, scroll: scroll.scrollWidth - scroll.clientWidth,
          page: document.documentElement.scrollWidth - innerWidth };
      });
      assert.ok(metrics.sidebar <= 1 && metrics.scroll <= 1 && metrics.page <= 1, JSON.stringify(metrics));
      return metrics;
    };
    phase = 'minimum sidebar width and complete brand text';
    const sidebarSplitter = page.getByRole('separator', { name: 'Resize Document Sidebar', exact: true });
    await sidebarSplitter.focus();
    await sidebarSplitter.press('Home');
    await waitFor(async () => await sidebarSplitter.getAttribute('aria-valuenow') === '240', 'keyboard Home selects the minimum sidebar width');
    await scroll.evaluate(host => { host.scrollTop = 0; });
    minimumWidthBrand = await sidebar.evaluate(host => {
      const scroll = host.querySelector('.sidebar-scroll');
      const brand = host.querySelector('.brand');
      const sidebarRect = host.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const left = Math.max(sidebarRect.left, scrollRect.left + scroll.clientLeft);
      const right = Math.min(sidebarRect.right, scrollRect.left + scroll.clientLeft + scroll.clientWidth);
      const top = Math.max(sidebarRect.top, scrollRect.top + scroll.clientTop);
      const bottom = Math.min(sidebarRect.bottom, scrollRect.top + scroll.clientTop + scroll.clientHeight);
      // Element bounds hide overflowing glyphs when a flex child shrinks; measure each rendered text fragment.
      const walker = document.createTreeWalker(brand, NodeFilter.SHOW_TEXT);
      const fragments = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) fragments.push({ text: node.textContent.trim(),
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
      return { width: sidebarRect.width, left, right, top, bottom, fragments };
    });
    fs.writeFileSync(path.join(workspace, 'minimum-sidebar-brand.json'), JSON.stringify(minimumWidthBrand, null, 2));
    assert.ok(Math.abs(minimumWidthBrand.width - 240) <= 1, JSON.stringify(minimumWidthBrand));
    assert.ok(minimumWidthBrand.fragments.some(fragment => fragment.text === 'PaperBridge'), 'Measure the actual brand title text');
    assert.ok(minimumWidthBrand.fragments.every(fragment => fragment.left >= minimumWidthBrand.left - 1 &&
      fragment.right <= minimumWidthBrand.right + 1 && fragment.top >= minimumWidthBrand.top - 1 &&
      fragment.bottom <= minimumWidthBrand.bottom + 1), `All brand text must remain visible at 240px: ${JSON.stringify(minimumWidthBrand)}`);
    await noOverflow();
    // Restore the ordinary 264px width using the same accessible control before the existing zoom cases.
    for (let step = 0; step < 3; step++) await sidebarSplitter.press('ArrowRight');
    await waitFor(async () => await sidebarSplitter.getAttribute('aria-valuenow') === '264', 'keyboard restores the standard sidebar width');
    for (const zoom of [1, 2]) {
      phase = `sidebar ${zoom * 100}% zoom`;
      console.log(`Checking sidebar at 980x620 with ${zoom * 100}% zoom`);
      if (zoom === 2) {
        // Clear Playwright emulation so this is a genuine 980x620 Electron client at 200% page zoom.
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setContentSize(980, 620);
          window.webContents.setZoomFactor(2);
        });
        await page.waitForFunction(() => innerWidth >= 489 && innerWidth <= 491 && innerHeight >= 309 && innerHeight <= 311);
      }
      await scroll.evaluate(host => { host.scrollTop = 0; });
      const top = await sidebar.locator('.brand').boundingBox();
      await visibleWithinSidebar(library);
      const details = sidebar.locator('.document-details');
      const summary = details.locator(':scope > summary');
      await summary.click();
      assert.notEqual(await details.getAttribute('open'), null, 'Document & Import remains operable');
      const openPdf = details.getByRole('button', { name: 'Open PDF', exact: true });
      await visibleWithinSidebar(openPdf);
      const language = details.getByRole('combobox', { name: 'Sidebar to language', exact: true });
      await visibleWithinSidebar(language);
      assert.equal(await language.inputValue(), 'Simplified Chinese');
      await noOverflow();
      await summary.click();

      const destination = sidebar.locator('.document-outline .outline-row[data-paragraph-id="55"]');
      await visibleWithinSidebar(destination);
      await destination.click();
      await waitFor(async () => await destination.getAttribute('aria-current') === 'location', 'outline destination becomes current');
      await sidebar.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 100000);
      await waitFor(async () => await scroll.evaluate(host => host.scrollTop > 100 && host.scrollHeight - host.clientHeight - host.scrollTop <= 2), 'sidebar reaches its bottom');
      const bottom = await sidebar.locator('.brand').boundingBox();
      assert.ok(top.y - bottom.y > 100, 'The brand must scroll away instead of reserving a fixed header');
      assert.equal(await sidebar.locator('.brand').evaluate(node => node.parentElement.classList.contains('sidebar-scroll')), true);
      assert.equal(await sidebar.locator('.sidebar-footer').evaluate(node => node.parentElement.classList.contains('sidebar-scroll')), true);
      for (const name of ['Local AI setup', 'Settings', 'Saved Terminology']) {
        phase = `${zoom * 100}% zoom: ${name}`;
        const button = sidebar.locator('.sidebar-footer').getByRole('button', { name, exact: true });
        await visibleWithinSidebar(button);
        await button.click();
        await page.getByRole('dialog', { name, exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      }

      const search = sidebar.getByRole('textbox', { name: 'Search papers or tags', exact: true });
      phase = `${zoom * 100}% zoom: search and overflow`;
      await visibleWithinSidebar(search);
      await search.fill('no matching sidebar document');
      assert.equal(await sidebar.locator('.recent-papers .library-row').count(), 0);
      const inputStyle = await search.evaluate(node => {
        const css = getComputedStyle(node);
        return { border: css.borderTopWidth, style: css.borderTopStyle, radius: css.borderTopLeftRadius,
          focus: document.activeElement === node, shadow: css.boxShadow };
      });
      // Chromium quantizes a 1 CSS px border to device pixels (e.g. 0.8px at Windows 125% DPI).
      assert.ok(parseFloat(inputStyle.border) > 0 && parseFloat(inputStyle.border) <= 1.01, JSON.stringify(inputStyle));
      assert.deepEqual({ style: inputStyle.style, radius: inputStyle.radius, focus: inputStyle.focus },
        { style: 'solid', radius: '7px', focus: true });
      assert.notEqual(inputStyle.shadow, 'none', 'Sidebar search has an explicit visible focus treatment');
      await search.fill('');
      assert.equal(await sidebar.locator('.recent-papers .library-row').count(), 1);
      const overflow = await noOverflow();
      const native = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return { contentSize: window.getContentSize(), zoom: window.webContents.getZoomFactor() };
      });
      assert.equal(native.zoom, zoom);
      if (zoom === 2) assert.ok(Math.abs(native.contentSize[0] - 980) <= 1 && Math.abs(native.contentSize[1] - 620) <= 1);
      samples.push({ zoom, overflow, native, brandScroll: top.y - bottom.y });
      await bounded('sidebar screenshot', page.screenshot({ path: path.join(workspace, `sidebar-980x620-zoom${zoom * 100}.png`), timeout: 10000 }), 12000);
    }
    assert.equal(generationRequests, 0);
    assert.deepEqual(rendererErrors, []);
    assert.equal(await app.evaluate(() => globalThis.__sidebarLayoutInstalls), 0);
  } catch (error) {
    fail(error, phase); // Print the original error before any screenshot or diagnostic call can stall.
    await diagnostics('failure-diagnostics.json');
    if (page && !page.isClosed()) await bounded('failure screenshot', page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 5000 }), 6000)
      .catch(cause => console.error(`[sidebar-layout] Screenshot failed: ${cause.message}`));
  } finally {
    if (cdp) await bounded('CDP detach', cdp.detach(), 3000).catch(error => fail(error, 'cleanup'));
    if (app) {
      const child = app.process();
      await bounded('reset page zoom', app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)), 3000)
        .catch(error => fail(error, 'cleanup'));
      try {
        await bounded('Electron close', app.close(), 15000);
      } catch (error) {
        fail(error, 'cleanup'); // A forced close is always a failure, even if all assertions passed.
        await diagnostics('close-diagnostics.json');
        if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
          console.error(`[sidebar-layout] Terminating only owned Electron process tree ${child.pid}`);
          try {
            if (process.platform === 'win32') await bounded('owned Electron termination', new Promise((resolve, reject) => {
              execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 },
                cause => cause ? reject(cause) : resolve());
            }), 12000);
            else child.kill('SIGKILL');
          } catch (cause) { fail(cause, 'owned process cleanup'); }
        }
      }
    }
    ollama.closeAllConnections();
    await bounded('mock server close', new Promise(resolve => ollama.close(resolve)), 3000).catch(error => fail(error, 'cleanup'));
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ minimumWidthBrand, samples }, null, 2));
  console.log(`Sidebar layout passed: shared scroll, empty-state order, outline/import controls, footer dialogs, search, 980x620 and 200% zoom. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
