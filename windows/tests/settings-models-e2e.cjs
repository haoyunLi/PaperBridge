const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* The settings write may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'settings-models-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected settings model test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const settingsFile = path.join(workspace, 'settings.json');
  const saved = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const assistants = settings => [settings.summaryModel, settings.explainModel, settings.quickLookupModel];
  const specialist = 'paperbridge-installed-specialist:1b';
  const endpointBModel = 'paperbridge-endpoint-b:1b';
  const installed = new Set(['translategemma:4b', 'gemma3:4b', specialist]);
  const pulls = [];
  const errors = [];
  const viewports = [];
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [...installed].map(model => ({ model })) }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/pull') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      const pull = { payload, response, closed: false };
      pulls.push(pull);
      response.on('close', () => { pull.closed = true; });
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.write(`${JSON.stringify({ status: `Downloading fixture ${payload.model}`, completed: 25, total: 100 })}\n`);
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const ollamaB = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: endpointBModel }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollamaB.listen(0, '127.0.0.1', resolve));
  const endpointB = `http://127.0.0.1:${ollamaB.address().port}`;
  fs.writeFileSync(settingsFile, JSON.stringify({ onboardingCompletedVersion: 1, autoCheckUpdates: false,
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, translationModel: 'translategemma:4b',
    summaryModel: specialist, explainModel: 'translategemma:4b', quickLookupModel: 'paperbridge-missing-model:1b' }));

  let app;
  let page;
  const card = model => page.locator(`.settings-models [data-model-id="${model}"]`);
  const clickTab = name => page.getByRole('tab', { name, exact: true }).click();
  async function openSettings() {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Local AI', exact: true }).waitFor();
    await clickTab('Local AI');
  }
  async function launch() {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('hardware:status');
      ipcMain.handle('hardware:status', () => ({ systemMemoryBytes: 32 * 1024 ** 3,
        adapters: [{ vendor: 'AMD', name: 'Mock AMD GPU', memoryBytes: 2 ** 32 - 1 }], cudaVersion: null }));
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: false, installed: false, reason: 'No parser installed in this test fixture.' }));
    });
    await page.reload();
    await page.locator('.welcome').waitFor();
    await openSettings();
  }
  function finishPull(index) {
    installed.add(pulls[index].payload.model);
    pulls[index].response.end(`${JSON.stringify({ status: 'success', completed: 100, total: 100 })}\n`);
  }
  async function pastePaper(text, blockCount) {
    await page.getByRole('button', { name: 'Paste Text', exact: true }).first().click();
    await page.locator('.paste-area').fill(text);
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('.paper-preview-block').length === count, blockCount);
  }
  async function checkSettingsNavigation(screenshot) {
    const sections = [
      ['Local AI', 'Set up local AI'], ['Parsing', 'PDF parsing'], ['Models', 'Ollama'],
      ['Reading', 'Translation direction'], ['Updates', /^Windows updates/], ['Local Data', 'Local workspace']
    ];
    for (const [name, heading] of sections) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await panel.getByRole('heading', { name: heading, exact: typeof heading === 'string' }).waitFor();
      const geometry = await tab.evaluate(button => {
        const panel = document.getElementById(button.getAttribute('aria-controls'));
        const box = button.getBoundingClientRect(), content = panel.getBoundingClientRect();
        const within = rect => rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
        return { tabVisible: within(box), panelVisible: within(content), hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
      assert.deepEqual(geometry, { tabVisible: true, panelVisible: true, hit: true }, `${name}: tab and panel must remain usable inside the viewport`);
    }
    await page.getByRole('tab', { name: 'Local AI', exact: true }).focus();
    for (const [key, expected] of [['End', 'Local Data'], ['ArrowRight', 'Local AI'], ['ArrowLeft', 'Local Data'], ['Home', 'Local AI'], ['ArrowRight', 'Parsing']]) {
      await page.keyboard.press(key);
      const tab = page.getByRole('tab', { name: expected, exact: true });
      assert.equal(await tab.getAttribute('aria-selected'), 'true', `${key} selects ${expected}`);
      assert.equal(await tab.evaluate(button => document.activeElement === button), true, `${key} keeps focus on the selected tab`);
    }
    await clickTab('Local AI');
    viewports.push(await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio })));
    await page.screenshot({ path: path.join(artifacts, screenshot) });
  }

  try {
    await launch();
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Local AI', 'Parsing', 'Models', 'Reading', 'Updates', 'Local Data']);
    assert.equal(await page.locator('.settings-models .model-card').count(), 9);
    assert.equal(await page.locator('[data-model-role="translation"] .model-card').count(), 3);
    assert.equal(await page.locator('[data-model-role="assistant"] .model-card').count(), 6);
    await page.getByText('This PC: 32 GiB system RAM', { exact: true }).waitFor();
    await page.getByText('Starting suggestion: TranslateGemma 12B', { exact: true }).waitFor();
    assert.equal(await card('translategemma:4b').getByRole('button', { name: 'Selected', exact: true }).isDisabled(), true);
    const links = await page.locator('.settings-models .model-card a').evaluateAll(items => items.map(item => item.href));
    assert.equal(links.length, 9);
    assert.equal(links.every(link => new URL(link).origin === 'https://ollama.com' && new URL(link).pathname.startsWith('/library/')), true);
    assert.equal(pulls.length, 0, 'Showing the recommendations must not start downloads');
    await page.screenshot({ path: path.join(artifacts, 'settings-models-recommendations.png') });

    await card('translategemma:12b').getByRole('button', { name: 'Download & use', exact: true }).click();
    await waitFor(() => pulls.length === 1, 'first recommended translation download');
    assert.deepEqual(pulls[0].payload, { model: 'translategemma:12b', stream: true });
    assert.equal(await card('translategemma:12b').getByRole('button', { name: 'Downloading…', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.settings-models .model-card button').evaluateAll(buttons => buttons.every(button => button.disabled)), true);
    await clickTab('Models');
    await page.getByText('Downloading fixture translategemma:12b', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await waitFor(() => pulls[0].closed, 'cancelled recommendation download stream');
    await page.getByRole('button', { name: 'Cancel download', exact: true }).waitFor({ state: 'detached' });
    assert.equal(saved().translationModel, 'translategemma:4b');
    assert.deepEqual(assistants(saved()), [specialist, 'translategemma:4b', 'paperbridge-missing-model:1b']);
    pulls[0].response.end(`${JSON.stringify({ status: 'success' })}\n`);
    await clickTab('Local AI');
    await card('translategemma:12b').getByRole('button', { name: 'Download & use', exact: true }).click();
    await waitFor(() => pulls.length === 2, 'retry recommendation download');
    finishPull(1);
    await waitFor(() => saved().translationModel === 'translategemma:12b' && assistants(saved()).join('|') === [specialist, 'translategemma:12b', 'translategemma:12b'].join('|'), 'translation download applies only following/missing assistant roles');
    await card('translategemma:12b').getByRole('button', { name: 'Selected', exact: true }).waitFor();
    await card('translategemma:4b').getByRole('button', { name: 'Use model', exact: true }).click();
    await waitFor(() => saved().translationModel === 'translategemma:4b' && assistants(saved()).join('|') === [specialist, 'translategemma:4b', 'translategemma:4b'].join('|'), 'installed translation selection retains the specialist');
    assert.equal(pulls.length, 2, 'Using an installed recommendation does not download again');

    await card('qwen3:4b-instruct').getByRole('button', { name: 'Download & use', exact: true }).click();
    await waitFor(() => pulls.length === 3, 'assistant recommendation download');
    finishPull(2);
    await waitFor(() => assistants(saved()).every(model => model === 'qwen3:4b-instruct'), 'downloaded assistant applies all three roles');
    assert.equal(saved().translationModel, 'translategemma:4b');
    await card('gemma3:4b').getByRole('button', { name: 'Use model', exact: true }).click();
    await waitFor(() => assistants(saved()).every(model => model === 'gemma3:4b'), 'installed assistant applies all three roles');
    assert.equal(pulls.length, 3);
    assert.equal(saved().translationModel, 'translategemma:4b');
    await clickTab('Models');
    assert.equal(await page.getByLabel('Translation model').inputValue(), 'translategemma:4b');
    for (const label of ['Summary model', 'Explanation model', 'Quick lookup model']) assert.equal(await page.getByLabel(label).inputValue(), 'gemma3:4b');
    await page.getByLabel('Quick lookup model').selectOption('qwen3:4b-instruct');
    await waitFor(() => saved().quickLookupModel === 'qwen3:4b-instruct', 'separate quick lookup role');
    await clickTab('Local AI');
    assert.equal(await card('gemma3:4b').getByRole('button', { name: 'Use model', exact: true }).isEnabled(), true, 'An assistant is selected only when all three roles use it');
    await card('gemma3:4b').getByRole('button', { name: 'Use model', exact: true }).click();
    await waitFor(() => assistants(saved()).every(model => model === 'gemma3:4b'), 'assistant role restoration');
    await page.setViewportSize({ width: 980, height: 620 });
    await page.waitForFunction(() => innerWidth >= 979 && innerWidth <= 981);
    await checkSettingsNavigation('settings-models-small.png');
    // This is Electron page zoom inside an actual 980x620 content window, not physical display DPI.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(980, 620);
      window.webContents.setZoomFactor(1.5);
    });
    await page.waitForFunction(() => innerWidth < 800);
    await checkSettingsNavigation('settings-models-980x620-zoom150.png');
    const zoom = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { contentSize: window.getContentSize(), zoomFactor: window.webContents.getZoomFactor() };
    });
    assert.equal(zoom.zoomFactor, 1.5);
    // Windows can round a native client area by one pixel when converting display scale.
    assert.ok(Math.abs(zoom.contentSize[0] - 980) <= 1 && Math.abs(zoom.contentSize[1] - 620) <= 1);
    await cdp.detach();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await app.close(); app = null;
    await launch();
    await card('gemma3:4b').getByRole('button', { name: 'Selected', exact: true }).waitFor();
    await card('translategemma:4b').getByRole('button', { name: 'Selected', exact: true }).waitFor();
    assert.equal(pulls.length, 3, 'Restarting Settings must not redownload selected models');

    // A background download belongs to its original paper and Ollama endpoint.
    // Restoring another paper while it finishes must not change the new paper's roles or model list.
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await pastePaper('Abstract\n\nSettings model task A.', 2);
    await pastePaper('Abstract\n\nSettings model task B.\n\nConclusion', 3);
    await openSettings();
    await clickTab('Models');
    await page.getByLabel('Ollama URL').fill(endpointB);
    await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
    for (const label of ['Translation model', 'Summary model', 'Explanation model', 'Quick lookup model']) await page.getByLabel(label).selectOption(endpointBModel);
    await waitFor(() => saved().ollamaBaseURL === endpointB && saved().translationModel === endpointBModel && assistants(saved()).every(model => model === endpointBModel), 'paper B endpoint and roles');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.library-row').filter({ hasText: '2 blocks' }).click();
    await page.getByText('Settings model task A.', { exact: false }).first().waitFor();
    await openSettings();
    await card('qwen3:8b').getByRole('button', { name: 'Download & use', exact: true }).click();
    await waitFor(() => pulls.length === 4, 'paper A background recommendation pull');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.library-row').filter({ hasText: '3 blocks' }).click();
    await page.getByText('Settings model task B.', { exact: false }).first().waitFor();
    await openSettings();
    await clickTab('Models');
    assert.equal(await page.getByLabel('Ollama URL').inputValue(), endpointB);
    finishPull(3);
    await page.getByRole('button', { name: 'Cancel download', exact: true }).waitFor({ state: 'detached' });
    assert.equal(saved().ollamaBaseURL, endpointB);
    for (const label of ['Translation model', 'Summary model', 'Explanation model', 'Quick lookup model']) {
      assert.equal(await page.getByLabel(label).inputValue(), endpointBModel, 'Late completion must retain paper B model roles');
      assert.deepEqual(await page.getByLabel(label).locator('option').allTextContents(), [endpointBModel], 'Endpoint A models must not enter the endpoint B list');
    }
    const storedPapers = fs.readdirSync(path.join(workspace, 'papers')).filter(file => file.endsWith('.json')).map(file => JSON.parse(fs.readFileSync(path.join(workspace, 'papers', file), 'utf8')));
    const paperA = storedPapers.find(paper => paper.blocks.some(block => block.text === 'Settings model task A.'));
    const paperB = storedPapers.find(paper => paper.blocks.some(block => block.text === 'Settings model task B.'));
    assert.deepEqual(assistants(paperA.taskSettings), Array(3).fill('gemma3:4b'));
    assert.deepEqual(assistants(paperB.taskSettings), Array(3).fill(endpointBModel));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'settings-models-actions.json'), JSON.stringify({ pulls: pulls.map(pull => pull.payload), viewports, zoom, settings: saved() }, null, 2));
    console.log('Settings recommendations passed: nine cards, conservative RAM suggestion, official links, cancellation across tabs, retry, download/use task roles, specialist retention, independent quick lookup, restart persistence, late completion isolation across papers/endpoints, and tab navigation at 980x620 with 100%/150% Electron zoom.');
  } finally {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'settings-models-final.png') }).catch(() => {});
    await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1)).catch(() => {});
    await app?.close();
    ollama.closeAllConnections();
    ollamaB.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
    await new Promise(resolve => ollamaB.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
