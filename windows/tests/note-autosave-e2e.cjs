const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* the atomic file may be between revisions */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function selectText(page, selector, quote) {
  await page.evaluate(({ selector, quote }) => {
    const host = document.querySelector(selector);
    const source = host?.textContent || '';
    const offset = source.indexOf(quote);
    if (offset < 0 || offset !== source.lastIndexOf(quote)) throw new Error(`Expected one exact quote: ${quote}`);
    const range = document.createRange();
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = cursor + node.textContent.length;
      if (!started && offset < end) { range.setStart(node, offset - cursor); started = true; }
      if (started && offset + quote.length <= end) { range.setEnd(node, offset + quote.length - cursor); break; }
      cursor = end;
    }
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, quote });
  await page.waitForFunction(text => document.querySelector('.inspector blockquote')?.textContent === text, quote);
}

async function launch(root, workspace) {
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1320, height: 900 });
  await page.locator('#block-1').waitFor({ timeout: 20000 });
  return { app, page };
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'note-autosave-workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });
  const id = crypto.createHash('sha256').update('PaperBridge note autosave fixture').digest('hex');
  const paperPath = path.join(workspace, 'papers', `${id}.json`);
  const settings = {
    ollamaBaseURL: 'http://127.0.0.1:11434', translationModel: 'test:1b', summaryModel: 'test:1b', explainModel: 'test:1b', quickLookupModel: 'test:1b',
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', autoCheckUpdates: false, onboardingCompletedVersion: 1
  };
  const fixture = {
    id, name: 'Note autosave fixture', type: 'text', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    taskSettings: settings, explanationLanguage: 'English', inspectorOpen: true, extraction: 'Pasted text', position: { block: 1, tab: 'Reader', displayMode: 'source' },
    blocks: [{ id: 1, text: 'Alpha passage has a Beta control sentence.', translation: '', status: 'pending',
      notes: [{ id: 'stale', text: 'Alpha passage', offset: 0, kind: 'source', body: 'review me', needsReview: true }],
      highlights: [{ id: 'highlight', text: 'Alpha passage', offset: 0, color: 'amber' }] }]
  };
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(paperPath, JSON.stringify(fixture));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  const readPaper = () => JSON.parse(fs.readFileSync(paperPath, 'utf8'));

  let app;
  let page;
  try {
    ({ app, page } = await launch(root, workspace));
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await selectText(page, '#block-1 .source-text', 'Alpha passage');
    const textarea = page.getByPlaceholder('What should you remember?');
    assert.equal(await textarea.inputValue(), '', 'review-needed note must not populate a new editing session');

    const exactBody = '  first draft with spaces  \n';
    await textarea.fill(exactBody);
    await waitFor(() => readPaper().blocks[0].notes.some(item => !item.needsReview && item.body === exactBody), '350 ms note autosave');
    await page.locator('.save-status.saved').waitFor();
    assert.equal(readPaper().blocks[0].highlights.length, 1);
    await textarea.blur();

    await textarea.fill('edit one');
    await textarea.fill('edit two');
    await textarea.fill('edit three');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await waitFor(() => readPaper().blocks[0].notes.some(item => !item.needsReview && item.body === exactBody), 'one undo for one typing session');

    await selectText(page, '#block-1 .source-text', 'Beta control');
    await page.getByPlaceholder('What should you remember?').fill('selection switch flushes me');
    await selectText(page, '#block-1 .source-text', 'Alpha passage');
    await waitFor(() => readPaper().blocks[0].notes.some(item => item.text === 'Beta control' && item.body === 'selection switch flushes me'), 'selection-switch flush');

    await textarea.fill('');
    await waitFor(() => !readPaper().blocks[0].notes.some(item => !item.needsReview && item.text === 'Alpha passage'), 'empty-body note removal');
    assert.equal(readPaper().blocks[0].highlights.length, 1, 'clearing a note must retain its highlight');
    assert.equal(readPaper().blocks[0].notes.some(item => item.id === 'stale' && item.needsReview), true, 'review record remains isolated');

    await textarea.fill('flush this exact body on close');
    await app.close();
    app = null;
    assert.equal(readPaper().blocks[0].notes.some(item => !item.needsReview && item.body === 'flush this exact body on close'), true, 'normal quit must flush a pending note');
    assert.deepEqual(pageErrors, []);

    ({ app, page } = await launch(root, workspace));
    await selectText(page, '#block-1 .source-text', 'Alpha passage');
    assert.equal(await page.getByPlaceholder('What should you remember?').inputValue(), 'flush this exact body on close');
    await app.evaluate(({ ipcMain }) => {
      const originalSave = ipcMain._invokeHandlers?.get('paper:save');
      if (!originalSave) throw new Error('Could not capture the production paper save handler.');
      global.__noteSaveAttempt = 0;
      ipcMain.removeHandler('paper:save');
      ipcMain.handle('paper:save', (_event, paper) => {
        global.__noteSaveAttempt++;
        if (global.__noteSaveAttempt === 1) throw new Error('simulated disk failure');
        return originalSave(_event, paper);
      });
    });
    await page.getByPlaceholder('What should you remember?').fill('retry keeps this exact note');
    await page.locator('.save-status.error').waitFor({ timeout: 10000 });
    assert.match(await page.locator('.save-status.error').innerText(), /simulated disk failure/);
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.locator('.save-status.saved').waitFor();
    assert.equal(readPaper().blocks[0].notes.some(item => item.body === 'retry keeps this exact note'), true);
    await page.screenshot({ path: path.join(artifacts, 'note-autosave.png') });
    console.log('Note autosave checks passed: exact whitespace, review isolation, 350 ms debounce, session undo, selection flush, clear semantics, quit flush, sticky status and retry.');
  } catch (error) {
    await page?.screenshot({ path: path.join(artifacts, 'note-autosave-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app?.close().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
