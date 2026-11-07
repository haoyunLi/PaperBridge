const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout = 10000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; }
    catch { /* Atomic saving and layout restoration may be settling. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'short-workspace-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  let generationRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end('{"models":[]}');
  });
  await bounded('fixture service', new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${server.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const id = crypto.createHash('sha256').update('Short workspace and inspector accessibility').digest('hex');
  const title = 'A Longitudinal Study of Reproducible Scientific Evidence Across Languages and Independent Experiments';
  const blocks = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, heading: false, status: 'ok',
    text: `Passage ${index + 1}. ${index === 3 ? 'Unique short viewport destination. ' : ''}` +
      'The study compares independent experiments and preserves their limitations for careful interpretation. '.repeat(7),
    translation: `段落 ${index + 1}。` + '这项研究比较独立实验，并保留相关局限以供认真核对。'.repeat(8),
    notes: [], highlights: [], translationHighlights: [] }));
  blocks[11].notes.push({ id: 'wide-saved-note', text: 'Passage 12.', offset: 0, kind: 'source', scope: 'reader',
    body: 'Wide viewport annotation retained for inspection.', createdAt: new Date().toISOString() });
  const paper = { id, name: title, type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    taskSettings: settings, inspectorOpen: true, blocks, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } } };
  const paperFile = path.join(workspace, 'papers', `${id}.json`);
  const readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(paperFile, JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  let app, page, failure, phase = 'launch';
  const rendererErrors = [], metrics = [], screenshots = [];
  const fail = (error, label) => { failure ||= error; console.error(`[short-workspace] ${label}: ${error.stack || error}`); };
  const stage = label => { phase = label; console.log(`[short-workspace] ${label}`); };
  const evaluate = (fn, argument) => bounded(phase, page.evaluate(fn, argument));
  const screenshot = async name => {
    // Playwright's clip coordinates can crop Electron pages after native zoom.
    // Capture Chromium's complete native view without supplying a CSS-pixel clip.
    const capture = await bounded('native screenshot', app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const image = await window.webContents.capturePage();
      return { dataURL: image.toDataURL(), imageSize: image.getSize(), contentSize: window.getContentSize(),
        zoom: window.webContents.getZoomFactor() };
    }), 10000);
    const prefix = 'data:image/png;base64,';
    assert.ok(capture.dataURL.startsWith(prefix), 'Native window capture must be PNG');
    fs.writeFileSync(path.join(workspace, name), Buffer.from(capture.dataURL.slice(prefix.length), 'base64'));
    screenshots.push({ file: name, imageSize: capture.imageSize, contentSize: capture.contentSize, zoom: capture.zoom });
  };
  const nativeSize = (width, height, zoom) => bounded('native window resize', app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    // A 500 CSS px viewport is also reachable through desktop/page zoom; allow that recovery case explicitly.
    window.setMinimumSize(0, 0);
    window.webContents.setZoomFactor(size.zoom);
    window.setContentSize(size.width, size.height);
  }, { width, height, zoom }));
  const state = () => evaluate(() => {
    const box = selector => {
      const node = document.querySelector(selector), rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, position: style.position,
        display: style.display, overflow: node.scrollWidth - node.clientWidth, overflowY: style.overflowY,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, main: box('.main-scroll'), header: box('.header'),
      toolbar: box('.reader-top'), inspector: box('#research-inspector'), inspectorBody: box('.inspector-body'),
      pageOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  const diagnose = async name => {
    const value = { phase, rendererErrors, state: page && !page.isClosed() ? await bounded('failure state', state(), 3000).catch(error => ({ error: error.message })) : null };
    console.error(`[short-workspace] ${JSON.stringify(value)}`);
    fs.writeFileSync(path.join(workspace, name), JSON.stringify(value, null, 2));
  };
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => { rendererErrors.push(error.message); console.error(error); });
    await nativeSize(980, 620, 1);
    await page.locator('#block-1').waitFor({ timeout: 20000 });
    const inspector = page.locator('#research-inspector');
    const closeInspector = () => inspector.getByRole('button', { name: /^(Close inspector drawer|Hide inspector)$/ });
    const mode = name => page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name, exact: true });
    const search = page.getByRole('textbox', { name: 'Search original or translation', exact: true });
    const checkShortReadingSpace = async label => {
      const value = await state(); metrics.push({ label, ...value });
      assert.ok(value.main.height >= 90, `${label}: Reader needs usable space: ${JSON.stringify(value)}`);
      assert.ok(value.main.top >= value.toolbar.bottom - 1 && value.main.bottom <= value.viewport.height + 1, JSON.stringify(value));
      assert.ok(value.pageOverflow <= 1 && value.toolbar.overflow <= 1, JSON.stringify(value));
      return value;
    };
    stage('normal 620px drawer');
    let current = await state();
    assert.equal(current.inspector.position, 'static');
    assert.equal(current.inspectorBody.display, 'grid');
    assert.ok(current.inspector.top >= current.main.bottom - 1);
    await closeInspector().click();
    await page.keyboard.press('Control+Alt+s');
    await page.waitForFunction(() => document.querySelector('.app').classList.contains('no-sidebar'));

    stage('real 980x620 window at 200% zoom');
    await nativeSize(980, 620, 2);
    await page.waitForFunction(() => Math.abs(innerWidth - 490) <= 1 && Math.abs(innerHeight - 310) <= 2);
    const native = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { size: window.getContentSize(), zoom: window.webContents.getZoomFactor() };
    });
    assert.equal(native.zoom, 2);
    assert.ok(Math.abs(native.size[0] - 980) <= 2 && Math.abs(native.size[1] - 620) <= 2, JSON.stringify(native));
    await checkShortReadingSpace('490x310 inspector closed');
    assert.equal(await page.locator('.title-row h1').getAttribute('title'), title, 'The complete article title remains available');
    assert.equal(await page.locator('.title-row h1').textContent(), title);
    assert.match(await page.locator('.title-row > .title-wrap > p').textContent(), /English → Simplified Chinese · Pasted text · 12 blocks/);
    assert.equal(await page.locator('.title-row h1').evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');

    stage('short toolbar keyboard, search and visible prose');
    await mode('Bilingual').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await mode('Original').isChecked(), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await mode('Translation').isChecked(), true);
    await mode('Bilingual').check();
    const controls = await page.locator('.reader-top').evaluate(host => [...host.querySelectorAll('label, input.search, button')].map(node => {
      const r = node.getBoundingClientRect();
      return { name: node.textContent || node.getAttribute('aria-label'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
    }));
    assert.ok(controls.every(r => r.left >= -1 && r.right <= r.width + 1 && r.top >= 0 && r.bottom <= r.height + 1), JSON.stringify(controls));
    await page.keyboard.press('Control+f');
    // Find defers focus until Reader has rendered; the key event completing is
    // not evidence that its scheduled focus callback has already executed.
    await waitFor(() => search.evaluate(node => document.activeElement === node), 'Ctrl+F focuses the short-viewport search');
    await search.fill('Unique short viewport destination');
    await waitFor(async () => await page.locator('.reader-list > .block').count() === 1, 'short viewport search filtering');
    assert.equal(await page.locator('#block-4').count(), 1);
    await search.press('Escape');
    await waitFor(async () => await page.locator('.reader-list > .block').count() === 12, 'clear short viewport search');
    await page.waitForFunction(() => document.querySelector('.main-scroll').getAttribute('aria-busy') === 'false');
    await evaluate(() => {
      const host = document.querySelector('.main-scroll'), source = document.querySelector('#block-1 .source-text');
      host.scrollTop += source.getBoundingClientRect().top - host.getBoundingClientRect().top - 12;
    });
    const visibleProse = await evaluate(() => {
      const host = document.querySelector('.main-scroll').getBoundingClientRect();
      const walker = document.createTreeWalker(document.querySelector('#block-1 .source-text'), NodeFilter.SHOW_TEXT);
      const node = walker.nextNode(), range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, Math.min(10, node.length));
      const rect = range.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, hostTop: host.top, hostBottom: host.bottom };
    });
    assert.ok(visibleProse.top >= visibleProse.hostTop - 1 && visibleProse.bottom <= visibleProse.hostBottom + 1, JSON.stringify(visibleProse));
    await screenshot('short-reader-prose.png');

    stage('overlay inspector note, independent scroll and fixed close');
    await page.locator('#block-1 .source-text').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Notes & More', exact: true }).click();
    const note = page.getByRole('textbox', { name: 'Note for selected passage', exact: true });
    await note.waitFor();
    current = await checkShortReadingSpace('490x310 inspector open');
    assert.equal(current.inspector.position, 'fixed');
    assert.equal(current.inspectorBody.display, 'block');
    assert.ok(current.inspector.left >= 0 && current.inspector.right <= current.viewport.width + 1 &&
      current.inspector.top >= 0 && current.inspector.bottom <= current.viewport.height + 1, JSON.stringify(current));
    const noteBody = 'Preserve this note while the Windows inspector covers the short reading viewport.\n'.repeat(6);
    await note.fill(noteBody);
    await waitFor(() => readPaper().blocks[0].notes.some(item => item.body === noteBody), 'overlay note autosave');
    const mainScroll = await page.locator('.main-scroll').evaluate(node => node.scrollTop);
    await page.locator('.inspector-body').evaluate(node => { node.scrollTop = 0; });
    await page.locator('.inspector-body').hover();
    await page.mouse.wheel(0, 10000);
    await waitFor(async () => await page.locator('.inspector-body').evaluate(node => node.scrollTop > 100), 'overlay content scroll');
    assert.ok(Math.abs(await page.locator('.main-scroll').evaluate(node => node.scrollTop) - mainScroll) < 2);
    const closeBounds = await closeInspector().boundingBox();
    assert.ok(closeBounds.y >= 0 && closeBounds.y + closeBounds.height < current.viewport.height, JSON.stringify(closeBounds));
    await screenshot('short-inspector-note.png');
    await closeInspector().click();
    await inspector.waitFor({ state: 'hidden' });
    if (await page.getByRole('button', { name: 'Close quick lookup', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close quick lookup', exact: true }).click();
    await checkShortReadingSpace('490x310 after inspector close');
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await waitFor(() => readPaper().blocks[0].notes.length === 0, 'Reader undo reverses the note');

    stage('wide 1600x440 overlay, saved annotation and Focus Reading');
    await nativeSize(1600, 440, 1);
    await page.waitForFunction(() => Math.abs(innerWidth - 1600) <= 2 && Math.abs(innerHeight - 440) <= 2);
    await page.getByRole('button', { name: 'Show Research Inspector', exact: true }).click();
    await inspector.locator('.inspector-body').waitFor();
    assert.equal(await inspector.evaluate(node => node.classList.contains('inspector-sidebar')), true,
      'The wide-window Inspector variant must also adapt to a short viewport');
    await page.locator('#block-1 .source-text').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector-quote-text').waitFor();
    current = await checkShortReadingSpace('1600x440 wide inspector open');
    assert.equal(current.inspector.position, 'fixed');
    assert.equal(current.inspector.display, 'flex');
    assert.equal(current.inspector.paddingTop, '0px');
    assert.equal(current.inspector.paddingBottom, '0px');
    assert.equal(current.inspectorBody.display, 'block');
    assert.equal(current.inspectorBody.overflowY, 'auto');
    assert.ok(current.inspectorBody.clientHeight > 100 && current.inspectorBody.scrollHeight > current.inspectorBody.clientHeight, JSON.stringify(current));
    assert.ok(current.inspector.left >= 0 && current.inspector.right <= current.viewport.width + 1 &&
      current.inspector.top >= 0 && current.inspector.bottom <= current.viewport.height + 1, JSON.stringify(current));
    const savedNote = inspector.locator('.saved-annotations .annotation-row > button').filter({ hasText: 'Wide viewport annotation retained' });
    await savedNote.scrollIntoViewIfNeeded();
    await savedNote.click();
    await waitFor(async () => await note.inputValue() === 'Wide viewport annotation retained for inspection.', 'activate saved annotation in wide overlay');
    await note.fill('Wide viewport saved annotation edited without losing the reading area.');
    await waitFor(() => readPaper().blocks[11].notes.some(item => item.body === 'Wide viewport saved annotation edited without losing the reading area.'), 'wide overlay note save');
    await page.locator('.inspector-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const wideClose = await closeInspector().boundingBox();
    assert.ok(wideClose.y >= 0 && wideClose.y + wideClose.height <= current.viewport.height, JSON.stringify(wideClose));
    await screenshot('wide-short-inspector.png');
    await closeInspector().click();
    await inspector.waitFor({ state: 'hidden' });
    assert.equal(await inspector.evaluate(node => getComputedStyle(node).display), 'none', 'no-inspector must still hide the wide overlay');
    if (await page.getByRole('button', { name: 'Close quick lookup', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close quick lookup', exact: true }).click();
    await page.getByRole('button', { name: 'Show Research Inspector', exact: true }).click();
    await page.keyboard.press('Control+Alt+f');
    await page.waitForFunction(() => document.querySelector('.app').classList.contains('focus'));
    assert.equal(await inspector.evaluate(node => getComputedStyle(node).display), 'none', 'Focus Reading must win over the overlay flex layout');
    await page.getByRole('button', { name: 'Exit Focus Reading', exact: true }).click();
    await inspector.waitFor({ state: 'visible' });
    assert.equal(await inspector.evaluate(node => getComputedStyle(node).display), 'flex');

    stage('normal drawer restoration at 500px and 620px');
    for (const height of [500, 620]) {
      await nativeSize(980, height, 1);
      await page.waitForFunction(height => Math.abs(innerWidth - 980) <= 2 && Math.abs(innerHeight - height) <= 2, height);
      current = await state(); metrics.push({ label: `restored-${height}`, ...current });
      assert.equal(current.inspector.position, 'static');
      assert.equal(current.inspectorBody.display, 'grid');
      assert.ok(current.inspector.top >= current.main.bottom - 1 && current.main.height > 0, JSON.stringify(current));
      assert.equal(await page.locator('.title-row h1').getAttribute('title'), title);
      await screenshot(`restored-drawer-${height}.png`);
    }
    assert.deepEqual(rendererErrors, []);
    assert.equal(generationRequests, 0);
    assert.ok(readPaper().blocks.every(block => block.status === 'ok' && block.translation));
  } catch (error) {
    fail(error, phase);
    await diagnose('failure-diagnostics.json').catch(cause => console.error(cause));
    if (page && !page.isClosed()) await screenshot('failure.png').catch(cause => console.error(cause));
  } finally {
    if (app) {
      const child = app.process();
      try { await bounded('Electron close', app.close(), 15000); }
      catch (error) {
        fail(error, 'cleanup');
        await diagnose('close-diagnostics.json').catch(cause => console.error(cause));
        if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === 'win32') await bounded('owned process termination', new Promise((resolve, reject) => {
              execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
            }), 12000);
            else child.kill('SIGKILL');
          } catch (cause) { fail(cause, 'owned process cleanup'); }
        }
      }
    }
    server.closeAllConnections();
    await bounded('fixture service close', new Promise(resolve => server.close(resolve)), 3000).catch(error => fail(error, 'cleanup'));
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ metrics, screenshots }, null, 2));
  console.log(`Short workspace passed: real 200% zoom, usable Reader, keyboard controls, inspector notes and scroll, undo, 1600x440 saved annotation editing and Focus Reading, normal 500px/620px drawer restoration. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
