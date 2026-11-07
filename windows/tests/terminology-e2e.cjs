const { revealSidebarSource, openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout = 15000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}

async function selectText(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const root = document.querySelector(selector);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`Selection fixture missing ${text}`);
  }, { selector, text });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'terminology-e2e-'));
  const glossaryFile = path.join(workspace, 'glossary.json');
  const readTerms = () => JSON.parse(fs.readFileSync(glossaryFile, 'utf8'));
  const entry = (source, target, sourceLanguage = 'English', targetLanguage = 'Simplified Chinese') =>
    ({ source, target, sourceLanguage, targetLanguage });
  const initialTerms = [entry('attention', '注意力'), entry('self-attention', '旧术语'),
    entry('自注意力', 'self-attention', 'Simplified Chinese', 'English'), entry('self-attention', 'attention propre', 'English', 'French')];
  fs.writeFileSync(glossaryFile, JSON.stringify(initialTerms));

  async function withWriteFailure(action) {
    const saved = `${glossaryFile}.test-preserve`;
    fs.renameSync(glossaryFile, saved);
    fs.mkdirSync(glossaryFile);
    try { await action(JSON.parse(fs.readFileSync(saved, 'utf8'))); }
    finally {
      fs.rmdirSync(glossaryFile);
      fs.renameSync(saved, glossaryFile);
    }
  }

  const model = 'translategemma:4b';
  const prompts = [];
  const requests = [];
  const skippedPorts = [];
  const ollama = http.createServer(async (request, response) => {
    requests.push({ url: request.url, at: Date.now() });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end('{"models":[]}');
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    const { prompt } = JSON.parse(body);
    prompts.push(prompt);
    const answer = prompt.startsWith('Translate exactly and only') ? 'self-attention' : '此处使用自注意力。';
    response.end(JSON.stringify({ response: answer, done: true }));
  });
  // Some test hosts allocate ephemeral ports from a range containing 10080.
  // fetch rejects that port before sending HTTP, even though the server bound
  // successfully. Check the fixture itself; do not change app network policy.
  const initialPort = Number(process.env.PAPERBRIDGE_TERMINOLOGY_TEST_PORT || 0);
  assert.ok(Number.isInteger(initialPort) && initialPort >= 0 && initialPort <= 65535);
  for (let attempt = 0; attempt < 8; attempt++) {
    await bounded('fixture server listen', new Promise((resolve, reject) => {
      const failed = error => reject(error);
      ollama.once('error', failed);
      ollama.listen(attempt === 0 ? initialPort : 0, '127.0.0.1', () => {
        ollama.removeListener('error', failed); resolve();
      });
    }), 5000);
    const port = ollama.address().port;
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/tags`, { signal: AbortSignal.timeout(5000) });
      assert.equal(probe.status, 200);
      assert.deepEqual(await probe.json(), { models: [{ model }] });
      break;
    } catch (error) {
      ollama.closeAllConnections();
      await bounded('unusable fixture close', new Promise(resolve => ollama.close(resolve)), 5000);
      if (error.cause?.message !== 'bad port' || attempt === 7) throw error;
      skippedPorts.push(port);
      console.log(`[terminology] fetch rejected fixture port ${port}; requesting another ephemeral port`);
    }
  }
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const dictionary = prompt => JSON.parse(prompt.split('\n').find(line => line.startsWith('[{"source":')));
  let app, page, stage = 'launch';
  const errors = [];
  const mark = value => { stage = value; console.log(`[terminology] ${stage}`); };
  const closeApp = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    try { await bounded('Electron close', owned.close()); }
    catch (error) {
      console.error(`[terminology] close failed: ${error.stack || error}`);
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') await bounded('owned Electron termination', new Promise((resolve, reject) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
        }), 12000);
        else child.kill('SIGKILL');
      }
      throw error;
    } finally { app = null; }
  };
  try {
    app = await launch();
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    mark('paste source and save terminology with failure/retry');
    await revealSidebarSource(page);
    await openPasteText(page);
    await page.locator('.paste-area').fill('Self-attention stabilizes the baseline attention score.');
    await loadPastedText(page, { view: 'Paper' });
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-1 .source-text').waitFor();
    await selectText(page, '#block-1 .source-text', 'Self-attention');
    const draft = page.getByPlaceholder('Approved translation');
    await draft.fill(' 自注意机制 ');
    const save = page.getByRole('button', { name: 'Save term', exact: true });
    await withWriteFailure(async saved => {
      assert.deepEqual(saved, initialTerms);
      await save.click();
      await page.getByRole('alert').getByText(/Could not save the term/).waitFor();
      assert.equal(await draft.inputValue(), ' 自注意机制 ');
      assert.equal(await page.getByText('Term saved for future translations.', { exact: true }).count(), 0);
    });
    await save.click();
    await page.getByText('Term saved for future translations.', { exact: true }).waitFor();
    assert.deepEqual(readTerms(), [initialTerms[0], initialTerms[2], initialTerms[3], entry('Self-attention', '自注意机制')]);

    mark('translate paragraph using the approved forward dictionary');
    await page.locator('#block-1').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
    const translation = page.locator('#block-1 .translation-text.done');
    await translation.waitFor();
    const forward = [{ source: 'Self-attention', translation: '自注意机制' }, { source: 'attention', translation: '注意力' }];
    assert.deepEqual(dictionary(prompts[0]), forward);
    mark('translate the selected target text using the reverse dictionary');
    await selectText(page, '#block-1 .translation-text', '自注意力');
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.getByText('Selection translated.', { exact: true }).waitFor();
    assert.deepEqual(dictionary(prompts[1]), [{ source: '自注意力', translation: 'self-attention' }]);
    mark('translate the full paper with forward terminology');
    await openWorkspaceView(page, 'Full Translation');
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    assert.match(prompts[2], /Paper excerpt:/);
    assert.deepEqual(dictionary(prompts[2]), forward);

    mark('remove terminology with failure/retry and restart');
    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    await page.getByPlaceholder('Search saved terms').fill('  自注意机制 ');
    const termRow = page.locator('.term-row');
    await termRow.getByText('Self-attention', { exact: true }).waitFor();
    const remove = termRow.getByRole('button', { name: 'Remove Self-attention' });
    await withWriteFailure(async saved => {
      assert.equal(saved.length, 4);
      await remove.click();
      await page.getByRole('alert').getByText(/Could not remove the term/).waitFor();
      assert.equal(await termRow.count(), 1);
    });
    await remove.click();
    await termRow.waitFor({ state: 'detached' });
    assert.equal(readTerms().length, 3);
    await closeApp();
    app = await launch();
    page = await bounded('reopened Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await openWorkspaceView(page, 'Reader');
    assert.match(await page.locator('#block-1 .translation-text.done').innerText(), /此处使用自注意力/);
    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    assert.equal(await page.locator('.term-row').count(), 3);
    assert.deepEqual(errors, []);
    if (initialPort === 10080) assert.ok(skippedPorts.includes(10080), 'the injected fetch-blocked port must be rejected before launching the application');
    fs.writeFileSync(path.join(workspace, 'report.json'), JSON.stringify({ requests, prompts, skippedPorts, errors }, null, 2));
    console.log(`[terminology] report: ${workspace}`);
    console.log('Terminology verified: durable save and removal, failure and retry, longest match, reverse selection, full translation and unchanged saved output after restart.');
  } catch (error) {
    console.error(`[terminology] ${stage}: ${error.stack || error}`);
    const diagnostic = { stage, workspace, requests, prompts, skippedPorts, errors, error: error.stack || String(error) };
    try { diagnostic.renderer = await bounded('failure renderer diagnostics', page.evaluate(() => ({
      text: document.body.innerText, width: innerWidth, height: innerHeight,
      displayMode: document.querySelector('.app')?.dataset.displayMode,
      visibility: document.visibilityState, dialogs: [...document.querySelectorAll('[role="dialog"],dialog')].map(node => node.innerText)
    })), 5000); } catch (cause) { diagnostic.rendererError = String(cause); }
    try { diagnostic.window = await bounded('failure window diagnostics', app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { zoom: window.webContents.getZoomFactor(), visible: window.isVisible(), bounds: window.getBounds() };
    }), 5000); } catch (cause) { diagnostic.windowError = String(cause); }
    fs.writeFileSync(path.join(workspace, 'failure.json'), JSON.stringify(diagnostic, null, 2));
    await page?.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 5000 }).catch(() => {});
    console.error(`[terminology] diagnostics: ${workspace}`);
    throw error;
  } finally {
    try { await closeApp(); }
    finally {
      ollama.closeAllConnections();
      await bounded('fixture server close', new Promise(resolve => ollama.close(resolve)), 5000);
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
