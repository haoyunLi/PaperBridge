const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');
const { openPasteText, loadPastedText } = require('./sidebar-controls.cjs');

async function bounded(label, operation, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'paste-text-'));
  const textA = 'Abstract\n\nAlpha evidence preserves an exact note before another document opens.';
  const textB = 'Results\n\nBeta evidence stays independent when an earlier import returns late.';
  const textC = 'Discussion\n\nGamma evidence preserves edits made while a different document is still opening.\n\nReferences\n\n[1] A. Example. An earlier controlled study. Journal of Tests, 2025.';
  const paperId = text => crypto.createHash('sha256').update(text.trim()).digest('hex');
  const idA = paperId(textA), idB = paperId(textB), idC = paperId(textC);
  const readPaper = id => JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
  let phase = 'fixture setup', app, page, failure, result, generationRequests = 0;
  const progress = message => {
    const line = `${new Date().toISOString()} [paste-text] ${message}`;
    console.log(line); fs.appendFileSync(path.join(workspace, 'progress.log'), `${line}\n`);
  };
  const stage = value => { phase = value; progress(`BEGIN ${phase}`); };
  stage(phase);
  const ollama = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await bounded('fake Ollama listen', new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve)), 5000);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese'
  }));
  const evaluate = (fn, value) => bounded(`${phase}: renderer evaluation`, page.evaluate(fn, value));
  const evaluateMain = (fn, value) => bounded(`${phase}: Electron evaluation`, app.evaluate(fn, value));
  const windows = () => bounded('window diagnostics', app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), bounds: window.getBounds()
  }))), 3000);
  const renderer = () => bounded('renderer diagnostics', page.evaluate(() => ({
    visibilityState: document.visibilityState, focused: document.hasFocus(), width: innerWidth, height: innerHeight,
    paperId: document.querySelector('.main-scroll')?.dataset.readingPaperId,
    restoring: document.querySelector('.main-scroll')?.getAttribute('aria-busy'),
    tab: document.querySelector('.header-tools .tabs .active')?.textContent,
    task: document.querySelector('.task-progress')?.textContent,
    save: document.querySelector('.save-status')?.textContent,
    draft: document.querySelector('.sidebar-paste textarea')?.value,
    activeElement: document.activeElement?.outerHTML.slice(0, 400)
  })), 3000);
  const screenshot = async name => {
    progress(`Capturing ${name}`);
    await bounded(`${phase}: screenshot`, page.screenshot({ path: path.join(workspace, name), timeout: 10000 }), 12000);
  };
  const closeElectron = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    progress(`Closing owned Electron pid=${child.pid}`);
    try { await bounded('app.close', owned.close(), 15000); }
    catch (error) {
      console.error(`[paste-text] Close failed: ${error.stack || error}`);
      fs.writeFileSync(path.join(workspace, 'close-diagnostics.json'), JSON.stringify({ phase,
        windows: await windows().catch(cause => ({ error: cause.message })),
        renderer: page && !page.isClosed() ? await renderer().catch(cause => ({ error: cause.message })) : { closed: true } }, null, 2));
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform === 'win32') await bounded('owned Electron termination', new Promise((resolve, reject) => {
            execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
          }), 12000);
          else child.kill('SIGKILL');
        } catch (cause) { console.error(cause); }
      }
      throw error;
    } finally { app = null; }
  };
  const paste = () => page.locator('.sidebar-paste');
  const input = () => paste().getByRole('textbox', { name: 'Paste text', exact: true });
  const load = () => paste().getByRole('button', { name: 'Load Text', exact: true });
  const clear = () => paste().getByRole('button', { name: 'Clear', exact: true });
  const currentId = () => page.locator('.main-scroll').getAttribute('data-reading-paper-id');
  const currentTab = () => page.locator('.header-tools .tabs .active').innerText();
  const note = () => page.getByRole('textbox', { name: 'Note for selected passage', exact: true });
  const ready = id => waitFor(() => evaluate(id => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false' && !document.querySelector('.task-progress');
  }, id), `paper ${id.slice(0, 8)} ready`);
  const frames = () => bounded(`${phase}: two rendering frames`, page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)))), 5000);
  const hasNote = (id, body) => readPaper(id).blocks.some(block => block.notes?.some(item => item.body === body));
  const selectAlpha = async () => {
    if (await currentTab() !== 'Reader') await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await ready(idA);
    if (!await page.locator('.inspector').isVisible()) await page.getByRole('button', { name: 'Show Research Inspector', exact: true }).click();
    await evaluate(() => {
      const host = document.querySelector('#block-2 .source-text');
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), quote = 'Alpha evidence';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf(quote);
        if (at < 0) continue;
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + quote.length);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return;
      }
      throw new Error('Missing Alpha selection fixture');
    });
    await waitFor(() => evaluate(() => document.querySelector('.inspector-quote-text')?.textContent === 'Alpha evidence'), 'exact note selection');
  };
  const expectPreloadNote = async (target, body) => {
    const events = await evaluateMain(() => globalThis.__pasteTest.loads);
    const event = events.filter(item => item.id === target).at(-1);
    assert.ok(event?.savedNotes.includes(body), 'import must flush the old note before reading a possible existing destination snapshot');
  };
  const pendingNoteThenLoad = async (body, target) => {
    await evaluateMain((_electron, expectation) => { globalThis.__pasteTest.expected = expectation; }, { id: idA, body });
    const dispatch = await evaluate(body => {
      const note = document.querySelector('textarea[aria-label="Note for selected passage"]');
      const load = [...document.querySelectorAll('.sidebar-paste button')].find(button => button.textContent === 'Load Text');
      if (!note || load.disabled) throw new Error('Expected a writable note and enabled Load Text');
      const start = performance.now();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, body);
      note.dispatchEvent(new Event('input', { bubbles: true }));
      // Same-turn activation deliberately precedes the 350ms note debounce and
      // avoids blur flushing the note on behalf of the import implementation.
      load.click();
      return { elapsed: performance.now() - start, value: note.value };
    }, body);
    assert.ok(dispatch.elapsed < 350, 'fixture activates Load Text before the autosave debounce');
    assert.equal(dispatch.value, body);
    await ready(target);
  };
  const inspectBusy = async () => {
    assert.equal(await load().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
    assert.equal(await input().isEditable(), true, 'ongoing work must not prevent preparing the next paste draft');
    for (const name of ['Open PDF', 'Try a Practice Paper']) {
      assert.equal(await page.locator('.sidebar-source').getByRole('button', { name, exact: true }).isDisabled(), true);
    }
  };
  try {
    stage('welcome entry, focus, blank load and whitespace clear');
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('firstWindow', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    await bounded('initial viewport', page.setViewportSize({ width: 1500, height: 900 }));
    assert.equal(await evaluateMain(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1,
      'the isolated Chromium profile starts at 100% zoom');
    await waitFor(() => evaluate(() => innerWidth === 1500 && innerHeight === 900), 'initial unscaled CSS viewport');
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await evaluateMain(({ ipcMain }) => {
      const save = ipcMain._invokeHandlers.get('paper:save'), load = ipcMain._invokeHandlers.get('paper:load');
      if (!save || !load) throw new Error('Missing production paper handlers');
      globalThis.__pasteTest = { failSave: false, holdId: null, heldLoad: null, heldSave: null,
        holdSaveBody: null, expected: null, loads: [], saves: [], releases: 0 };
      ipcMain.removeHandler('paper:save');
      ipcMain.handle('paper:save', (event, paper) => {
        const state = globalThis.__pasteTest;
        const notes = paper.blocks.flatMap(block => block.notes || []).map(note => note.body);
        state.saves.push({ id: paper.id, notes });
        if (state.failSave) throw new Error('Intentional paste boundary save failure');
        if (state.holdSaveBody && notes.includes(state.holdSaveBody)) {
          state.holdSaveBody = null;
          return new Promise((resolve, reject) => { state.heldSave = () => {
            state.heldSave = null; return Promise.resolve(save(event, paper)).then(resolve, reject);
          }; });
        }
        return save(event, paper);
      });
      ipcMain.removeHandler('paper:load');
      ipcMain.handle('paper:load', async (event, id) => {
        const state = globalThis.__pasteTest;
        const before = state.expected ? await load(event, state.expected.id) : null;
        state.loads.push({ id, savedNotes: before?.blocks.flatMap(block => block.notes || []).map(note => note.body) || [] });
        const snapshot = await load(event, id);
        if (state.holdId === id) {
          state.holdId = null;
          return new Promise(resolve => { state.heldLoad = () => { state.heldLoad = null; state.releases++; resolve(snapshot); }; });
        }
        return snapshot;
      });
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ installed: false, compatible: false, executable: '', message: 'Isolated paste test' }));
    });
    await page.getByRole('button', { name: 'Hide Document Sidebar', exact: true }).click();
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    await openPasteText(page);
    await waitFor(() => evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Paste text'), 'welcome action focuses the sidebar editor');
    assert.equal(await page.locator('.modal').isVisible(), false, 'pasting stays inline instead of opening a modal');
    assert.equal(await input().inputValue(), ''); assert.equal(await load().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
    await input().fill(' \n\t ');
    assert.equal(await load().isDisabled(), true); assert.equal(await clear().isDisabled(), false);
    await paste().locator('.sidebar-paste-placeholder').waitFor({ state: 'visible' });
    await clear().click(); assert.equal(await input().inputValue(), '');
    assert.equal(await clear().isDisabled(), true);

    stage('new document Overview and retained inline draft');
    await input().fill(textA); await loadPastedText(page);
    assert.equal(await currentId(), idA); assert.equal(await currentTab(), 'Overview');
    assert.equal(await input().inputValue(), textA);
    assert.notEqual(await page.locator('.document-details').getAttribute('open'), null);
    assert.notEqual(await paste().getAttribute('open'), null);
    assert.match(await page.locator('.workspace-status').innerText(), /Loaded Pasted Text with \d+ analysis paragraphs using Pasted text/);
    await waitFor(() => fs.existsSync(path.join(workspace, 'papers', `${idA}.json`)), 'first pasted paper saved');
    await paste().locator(':scope > summary').click();
    assert.equal(await input().isVisible(), false);
    await openPasteText(page); assert.equal(await input().inputValue(), textA);

    stage('pending note flush before importing a different document');
    await input().fill(textB); await selectAlpha();
    await pendingNoteThenLoad('Pending note before opening Beta.', idB);
    assert.equal(await currentTab(), 'Overview'); assert.equal(await input().inputValue(), textB);
    assert.equal(hasNote(idA, 'Pending note before opening Beta.'), true);
    await expectPreloadNote(idB, 'Pending note before opening Beta.');

    stage('same text restores its saved tab, latest note and repaired source');
    await input().fill(textA); await loadPastedText(page);
    assert.equal(await currentTab(), 'Reader', 'same text keeps its saved reading tab');
    await selectAlpha(); assert.equal(await note().inputValue(), 'Pending note before opening Beta.');
    await page.locator('#block-2').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    const repaired = textA.split('\n\n')[1] + ' This sentence was repaired by the reader.';
    await page.getByRole('textbox', { name: 'Paragraph source', exact: true }).fill(repaired);
    await page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.paragraph-editor').waitFor({ state: 'hidden' });
    await waitFor(() => readPaper(idA).blocks[1].text === repaired, 'manual repair saved');
    await selectAlpha();
    await pendingNoteThenLoad('Newest same-document note before its old hash is loaded.', idA);
    await expectPreloadNote(idA, 'Newest same-document note before its old hash is loaded.');
    assert.equal(await currentTab(), 'Reader'); assert.equal(await page.locator('#block-2 .source-text').innerText(), repaired);
    await selectAlpha(); assert.equal(await note().inputValue(), 'Newest same-document note before its old hash is loaded.');
    assert.equal(await input().inputValue(), textA, 'the original paste draft does not replace manually repaired source');

    stage('failed old-paper save blocks import and keeps retryable draft');
    await input().fill(textB); await selectAlpha();
    await evaluateMain(() => { globalThis.__pasteTest.failSave = true; });
    await pendingNoteThenLoad('Retain this note when the disk save fails.', idA);
    await page.locator('.save-status.error').waitFor();
    assert.match(await page.locator('.save-status.error').innerText(), /Intentional paste boundary save failure/);
    assert.equal(await currentId(), idA); assert.equal(await currentTab(), 'Reader'); assert.equal(await input().inputValue(), textB);
    assert.equal(hasNote(idA, 'Retain this note when the disk save fails.'), false);
    await evaluateMain(() => { globalThis.__pasteTest.failSave = false; });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.locator('.save-status.saved').waitFor();
    assert.equal(hasNote(idA, 'Retain this note when the disk save fails.'), true);
    await loadPastedText(page); assert.equal(await currentId(), idB);

    stage('busy controls, editable next draft and cancelled late load');
    await input().fill(textA);
    await evaluateMain((_electron, id) => { globalThis.__pasteTest.holdId = id; globalThis.__pasteTest.heldLoad = null; }, idA);
    await load().click();
    await waitFor(() => evaluateMain(() => typeof globalThis.__pasteTest.heldLoad === 'function'), 'held destination load');
    await inspectBusy(); await input().fill(textC);
    await screenshot('paste-busy-editable.png');
    await page.getByRole('button', { name: 'Stop', exact: true }).click(); await ready(idB);
    await evaluateMain(() => globalThis.__pasteTest.heldLoad()); await frames();
    assert.equal(await currentId(), idB); assert.equal(await input().inputValue(), textC);
    assert.equal(fs.existsSync(path.join(workspace, 'papers', `${idC}.json`)), false);
    assert.equal(await load().isDisabled(), false); assert.equal(await clear().isDisabled(), false);

    stage('edits during pending load flush before a new document replaces them');
    await input().fill(textA); await loadPastedText(page); await selectAlpha();
    await input().fill(textC);
    await evaluateMain((_electron, id) => {
      const state = globalThis.__pasteTest; state.holdId = id; state.heldLoad = null; state.heldSave = null;
      state.holdSaveBody = 'Note typed while the new document was being read.';
    }, idC);
    await load().click();
    await waitFor(() => evaluateMain(() => typeof globalThis.__pasteTest.heldLoad === 'function'), 'held new-paper lookup');
    await note().fill('Note typed while the new document was being read.');
    const nextDraft = 'A next draft prepared while the current import was still running.';
    await input().fill(nextDraft);
    await evaluateMain(() => globalThis.__pasteTest.heldLoad());
    await waitFor(() => evaluateMain(() => typeof globalThis.__pasteTest.heldSave === 'function'), 'held final old-paper save');
    assert.equal(await currentId(), idA, 'the current document stays visible until its late edit has reached disk');
    await inspectBusy();
    const newestNote = 'Newest edit made while the earlier save itself was blocked.';
    await evaluateMain((_electron, body) => { globalThis.__pasteTest.holdSaveBody = body; }, newestNote);
    await note().fill(newestNote);
    await evaluateMain(() => globalThis.__pasteTest.heldSave());
    await waitFor(() => evaluateMain(() => typeof globalThis.__pasteTest.heldSave === 'function'), 'save of typing received during an in-flight save');
    assert.equal(await currentId(), idA, 'import waits for the newest note, not only the older in-flight write');
    await evaluateMain(() => globalThis.__pasteTest.heldSave()); await ready(idC);
    assert.equal(await currentTab(), 'Overview'); assert.equal(await input().inputValue(), nextDraft, 'finishing import does not clear newer typing');
    assert.equal(hasNote(idA, newestNote), true);
    assert.equal(readPaper(idA).blocks[1].text, repaired);
    assert.match(await page.locator('.workspace-status').innerText(), /reference blocks/);

    stage('long inline draft and controls remain usable at 980px and 200% zoom');
    const longDraft = Array.from({ length: 40 }, (_, at) => `Draft line ${at + 1}: preserve this full paragraph while the sidebar scrolls.`).join('\n');
    await input().fill(longDraft);
    const layouts = [];
    for (const sample of [{ width: 980, height: 620, zoom: 1 }, { width: 1960, height: 1240, zoom: 2 }]) {
      await evaluateMain(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), sample.zoom);
      await bounded('resize viewport', page.setViewportSize({ width: sample.width, height: sample.height }));
      await paste().scrollIntoViewIfNeeded();
      const layout = await evaluate(() => {
        const host = document.querySelector('.sidebar-scroll'), bounds = host.getBoundingClientRect();
        const area = document.querySelector('.sidebar-paste textarea');
        return { width: innerWidth, height: innerHeight, left: bounds.left, right: bounds.right, top: bounds.top,
          bottom: bounds.top + host.clientHeight, scrollable: host.scrollHeight > host.clientHeight,
          inputScrollable: area.scrollHeight > area.clientHeight, overflow: document.documentElement.scrollWidth - innerWidth,
          controls: [...document.querySelectorAll('.sidebar-paste textarea, .sidebar-paste button')].map(node => {
            const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          }) };
      });
      layouts.push({ ...sample, ...layout });
      assert.ok(layout.scrollable && layout.inputScrollable);
      assert.ok(layout.overflow <= 1);
      for (const box of layout.controls) assert.ok(box.left >= layout.left && box.right <= layout.right + 1 &&
        box.top >= layout.top - 1 && box.bottom <= layout.bottom + 1, JSON.stringify(layout));
      assert.equal(await input().inputValue(), longDraft);
      await screenshot(`paste-inline-zoom-${sample.zoom}.png`);
    }
    await clear().click(); assert.equal(await input().inputValue(), '');
    assert.equal(await load().isDisabled(), true); assert.equal(await clear().isDisabled(), true);
    assert.equal(await currentId(), idC, 'Clear only clears the paste draft');
    assert.equal(hasNote(idA, newestNote), true);
    assert.equal(generationRequests, 0, 'pasting, notes and draft editing never invoke AI');

    stage('failed workspace reset preserves the paper and paste draft; retry clears both');
    await evaluateMain(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await bounded('reset test viewport', page.setViewportSize({ width: 1500, height: 900 }));
    await waitFor(() => evaluate(() => innerWidth === 1500 && innerHeight === 900), 'reset viewport at 100% zoom');
    const resetDraft = 'Keep this unimported draft when clearing saved data fails.';
    await input().fill(resetDraft);
    await page.locator('.save-status.saved').waitFor();
    const beforeResetBlocks = readPaper(idC).blocks;
    await evaluateMain(({ ipcMain }) => {
      const clear = ipcMain._invokeHandlers.get('paper:clear-data');
      if (!clear) throw new Error('Missing production paper:clear-data handler');
      globalThis.__pasteResetAttempts = 0;
      globalThis.__pasteResetGenerations = 0;
      ipcMain.removeHandler('paper:clear-data');
      ipcMain.handle('paper:clear-data', event => {
        if (++globalThis.__pasteResetAttempts === 1) throw new Error('Intentional paste reset failure');
        return clear(event);
      });
      // Reset restores the default Ollama endpoint, so also count the actual
      // generation IPC and prevent any accidental model work in this fixture.
      ipcMain.removeHandler('ollama:generate');
      ipcMain.handle('ollama:generate', () => {
        globalThis.__pasteResetGenerations++;
        throw new Error('Practice must not invoke a model');
      });
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Local Data', exact: true }).click();
    await page.getByRole('button', { name: 'Remove all saved PaperBridge data…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Remove Saved Data', exact: true }).getByRole('button', { name: 'Remove saved data', exact: true }).click();
    await page.getByText(/Could not clear saved data:.*Intentional paste reset failure/).waitFor();
    assert.equal(await evaluateMain(() => globalThis.__pasteResetAttempts), 1);
    assert.equal(await currentId(), idC); assert.equal(await paste().locator('textarea').inputValue(), resetDraft);
    assert.deepEqual(readPaper(idC).blocks, beforeResetBlocks); assert.equal(hasNote(idA, newestNote), true);
    await page.getByRole('dialog', { name: 'Remove Saved Data', exact: true }).getByRole('button', { name: 'Remove saved data', exact: true }).click();
    await page.locator('.welcome').waitFor();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await evaluateMain(() => globalThis.__pasteResetAttempts), 2);
    assert.equal(await currentId(), ''); assert.equal(await paste().locator('textarea').inputValue(), '');
    assert.equal(await paste().getAttribute('open'), null, 'successful reset also collapses the paste disclosure');
    for (const id of [idA, idB, idC]) assert.equal(fs.existsSync(path.join(workspace, 'papers', `${id}.json`)), false);

    stage('practice starts in Overview without clearing an unrelated paste draft or invoking AI');
    await openPasteText(page);
    const practiceDraft = 'My next paper draft remains available while I explore the practice document.';
    await input().fill(practiceDraft);
    await page.locator('.sidebar-source').getByRole('button', { name: 'Try a Practice Paper', exact: true }).click();
    await page.locator('.title-wrap h1').getByText('Welcome to PaperBridge (practice sample)', { exact: true }).waitFor();
    await page.getByText('Loaded a fictional practice paper. No model is used until you choose an AI action.', { exact: true }).waitFor();
    assert.equal(await currentTab(), 'Overview'); assert.equal(await input().inputValue(), practiceDraft);
    assert.equal(await evaluateMain(() => globalThis.__pasteResetGenerations), 0);
    assert.equal(generationRequests, 0, 'opening practice never sends a model request');
    result = { passed: true, workspace, layouts, checked: ['welcome opens and focuses inline editor', 'blank load and whitespace Clear',
      'new pasted documents open Overview', 'draft survives successful import and disclosure changes',
      'pending note flush precedes different/same-document lookup', 'same hash restores latest note, repaired source and saved tab',
      'failed save blocks import and Retry preserves note and draft', 'busy action locks while textarea stays editable',
      'cancelled late lookup cannot replace current paper', 'edits during pending load flush before replacement',
      'new typing during an in-flight save drains before paper replacement',
      'newer draft typing survives an old import', '980x620 and 200% zoom',
      'failed clear-data preserves paper and draft; successful retry clears and collapses paste',
      'practice opens Overview with exact fictional/no-model status and retains an unrelated draft', 'no model requests'] };
    progress('All assertions passed; beginning cleanup');
  } catch (error) {
    failure = error; console.error(`[paste-text] FAILED during ${phase}: ${error.stack || error}`);
    progress(`FAILED during ${phase}: ${error.message}`);
    const diagnostics = { phase, error: error.stack || String(error), generationRequests };
    if (app) diagnostics.windows = await windows().catch(cause => ({ error: cause.message }));
    if (page && !page.isClosed()) {
      diagnostics.renderer = await renderer().catch(cause => ({ error: cause.message }));
      await bounded('failure screenshot', page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 4000 }), 5000)
        .catch(cause => { diagnostics.screenshotError = cause.message; });
    }
    fs.writeFileSync(path.join(workspace, 'failure-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  } finally {
    // Release only this suite's held IPC calls before close; a failed assertion
    // must not leave the isolated app waiting for a deliberately held save.
    if (app) await evaluateMain(() => {
      const state = globalThis.__pasteTest;
      if (state) { state.failSave = false; state.heldLoad?.(); state.heldSave?.(); }
    }).catch(error => { console.error(error); failure ||= error; });
    ollama.closeAllConnections();
    try { await bounded('fake Ollama close', new Promise(resolve => ollama.close(resolve)), 5000); }
    catch (error) { console.error(error); failure ||= error; }
    try { await closeElectron(); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
