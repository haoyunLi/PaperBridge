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
  const overlayChecks = [];
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
  const captureNative = async name => {
    const png = await bounded(`${phase}: native client screenshot`, app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')), 10000);
    fs.writeFileSync(path.join(workspace, name), Buffer.from(png, 'base64'));
  };
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.on('pageerror', error => { rendererErrors.push(error.message); console.error(`Sidebar renderer error: ${error.stack || error}`); });
    page.setDefaultTimeout(15000);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1,
      'the isolated Chromium profile starts at 100% zoom');
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
    const closeSidebar = sidebar.getByRole('button', { name: 'Close Document Sidebar', exact: true });
    const showSidebar = page.getByRole('button', { name: 'Show Document Sidebar', exact: true });
    const nativeZoom = async zoom => {
      cdp ||= await page.context().newCDPSession(page);
      await bounded('clear viewport emulation', cdp.send('Emulation.clearDeviceMetricsOverride'), 3000);
      await bounded('resize native client and set zoom', app.evaluate(({ BrowserWindow }, zoom) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(980, 620); window.webContents.setZoomFactor(zoom);
      }, zoom), 3000);
      await page.waitForFunction(zoom => Math.abs(innerWidth - 980 / zoom) <= 1 &&
        Math.abs(innerHeight - 620 / zoom) <= 1, zoom);
    };
    const mouseCenter = async (button, label) => {
      await button.waitFor({ state: 'visible' });
      assert.equal(await button.isEnabled(), true, `${label} is enabled`);
      const box = await button.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `${label} has a visible hit target`);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = await bounded('mouse target hit test', page.evaluate(point => ({ width: innerWidth, height: innerHeight,
        label: document.elementFromPoint(point.x, point.y)?.closest('button')?.getAttribute('aria-label') }), point), 3000);
      assert.ok(point.x >= 0 && point.x < hit.width && point.y >= 0 && point.y < hit.height, JSON.stringify({ box, hit }));
      assert.equal(hit.label, label, `${label} must receive a real mouse click at its center`);
      await bounded(`${label}: mouse click`, page.mouse.click(point.x, point.y), 5000);
    };
    const sidebarState = () => bounded('sidebar and reading state', page.evaluate(() => ({
      draft: document.querySelector('.sidebar-paste textarea')?.value,
      sidebarScroll: document.querySelector('.sidebar-scroll').scrollTop,
      paperId: document.querySelector('.main-scroll')?.dataset.readingPaperId || '',
      readerScroll: document.querySelector('.main-scroll')?.scrollTop || 0,
      selected: document.querySelector('.document-outline [aria-current="location"]')?.dataset.paragraphId || null
    })), 3000);
    const assertPreserved = async before => {
      const after = await sidebarState();
      assert.equal(after.draft, before.draft, 'closing or focusing never clears the paste draft');
      assert.equal(after.paperId, before.paperId, 'the selected document remains open');
      assert.equal(after.selected, before.selected, 'the selected outline paragraph remains current');
      assert.ok(Math.abs(after.sidebarScroll - before.sidebarScroll) <= 1, `sidebar scroll is retained: ${JSON.stringify({ before, after })}`);
      assert.ok(Math.abs(after.readerScroll - before.readerScroll) <= 1, `reading scroll is retained: ${JSON.stringify({ before, after })}`);
      return after;
    };
    const closeWithMouse = async () => {
      const fixed = await closeSidebar.evaluate(button => {
        const box = button.getBoundingClientRect(), host = document.querySelector('.sidebar-scroll').getBoundingClientRect();
        return { outsideScroll: !button.closest('.sidebar-scroll'), top: box.top, bottom: box.bottom,
          scrollTop: host.top, scrollBottom: host.bottom, viewportHeight: innerHeight };
      });
      assert.equal(fixed.outsideScroll, true, 'the close control stays outside the scrolling sidebar content');
      assert.ok(fixed.top >= 0 && fixed.bottom <= fixed.scrollTop + 1 && fixed.scrollBottom <= fixed.viewportHeight + 1, JSON.stringify(fixed));
      await mouseCenter(closeSidebar, 'Close Document Sidebar');
      await sidebar.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Show Document Sidebar');
    };
    const closeAndReopen = async label => {
      const before = await sidebarState();
      await closeWithMouse();
      await mouseCenter(showSidebar, 'Show Document Sidebar');
      await sidebar.waitFor({ state: 'visible' });
      overlayChecks.push({ label, before, after: await assertPreserved(before) });
    };
    const emptyOrder = await sidebar.evaluate(host => {
      const library = host.querySelector('.sidebar-library-button');
      const source = host.querySelector('.side-primary');
      return Boolean(source && (library.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(emptyOrder, true, 'The empty sidebar must show Paper Library before Source, like macOS');
    assert.equal(await closeSidebar.isVisible(), false, 'wide windows use the ordinary header sidebar switch');
    phase = 'empty welcome at native 980x620 and 200% zoom';
    await nativeZoom(2);
    await sidebar.locator('.sidebar-paste > summary').click();
    const emptyDraft = 'An unimported welcome draft survives closing the sidebar.';
    await sidebar.getByRole('textbox', { name: 'Paste text', exact: true }).fill(emptyDraft);
    await sidebar.locator('.sidebar-footer').getByRole('button', { name: 'Saved Terminology', exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await scroll.evaluate(host => host.scrollTop > 0), 'the empty sidebar is scrolled down before closing');
    await closeAndReopen('empty welcome after scrolling to footer');
    assert.equal(await page.locator('.welcome').isVisible(), true);
    await captureNative('sidebar-welcome-overlay-zoom200.png');
    await nativeZoom(1);
    assert.equal(await closeSidebar.isVisible(), false);
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
    const loadedDraft = 'An unimported draft stays with the workspace while reading the saved document.';
    await sidebar.locator('.document-details > summary').click();
    await sidebar.locator('.sidebar-paste > summary').click();
    await sidebar.getByRole('textbox', { name: 'Paste text', exact: true }).fill(loadedDraft);
    await sidebar.locator('.document-details > summary').click();
    for (const zoom of [1, 2]) {
      phase = `sidebar ${zoom * 100}% zoom`;
      console.log(`Checking sidebar at 980x620 with ${zoom * 100}% zoom`);
      // Use the real native client for both samples, with no Playwright viewport emulation.
      await nativeZoom(zoom);
      assert.equal(await closeSidebar.isVisible(), zoom === 2, 'the in-sidebar close button is limited to overlay widths');
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
      if (zoom === 2) {
        phase = 'loaded overlay after reaching footer';
        const before = await sidebarState();
        assert.equal(before.paperId, id); assert.equal(before.selected, '55'); assert.equal(before.draft, loadedDraft);
        assert.ok(before.sidebarScroll > 100);
        await closeAndReopen('loaded document after scrolling to footer');
        phase = 'overlay close and Focus Reading transitions';
        await closeWithMouse();
        await mouseCenter(page.getByRole('button', { name: 'Focus Reading', exact: true }), 'Focus Reading');
        await page.locator('.app.focus').waitFor();
        assert.equal(await sidebar.isVisible(), false);
        await mouseCenter(page.getByRole('button', { name: 'Exit Focus Reading', exact: true }), 'Exit Focus Reading');
        await page.locator('.app.focus').waitFor({ state: 'detached' });
        assert.equal(await sidebar.isVisible(), false, 'normal focus exit respects the previously closed sidebar');
        await mouseCenter(showSidebar, 'Show Document Sidebar');
        await sidebar.waitFor({ state: 'visible' });
        await assertPreserved(before);
        // The header's Show action also exits Focus and reopens the same overlay.
        await closeWithMouse();
        await mouseCenter(page.getByRole('button', { name: 'Focus Reading', exact: true }), 'Focus Reading');
        await page.locator('.app.focus').waitFor();
        await mouseCenter(showSidebar, 'Show Document Sidebar');
        await page.locator('.app.focus').waitFor({ state: 'detached' });
        await sidebar.waitFor({ state: 'visible' });
        await assertPreserved(before);
        await closeAndReopen('loaded document after leaving Focus through Show Sidebar');
        await captureNative('sidebar-loaded-overlay-zoom200.png');
      }
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
      await captureNative(`sidebar-980x620-zoom${zoom * 100}.png`);
    }
    assert.equal(generationRequests, 0);
    assert.deepEqual(rendererErrors, []);
    assert.equal(await app.evaluate(() => globalThis.__sidebarLayoutInstalls), 0);
  } catch (error) {
    fail(error, phase); // Print the original error before any screenshot or diagnostic call can stall.
    await diagnostics('failure-diagnostics.json');
    if (page && !page.isClosed()) await captureNative('failure.png')
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
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ minimumWidthBrand, samples, overlayChecks }, null, 2));
  console.log(`Sidebar layout passed: shared scroll, empty-state order, outline/import controls, footer dialogs, search, native 980x620 at 200% zoom, mouse close/reopen, focus restoration and retained drafts/reading positions. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
