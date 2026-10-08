const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* A settings write may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'onboarding-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected onboarding test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const settingsFile = path.join(workspace, 'settings.json');
  const savedSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const managedMineru = path.join(workspace, 'mock-tools', 'mineru.exe');
  const installed = new Set(['translategemma:4b', 'gemma3:4b']);
  const pulls = [];
  const setupPayloads = [];
  const errors = [];
  let runtimeReady = false;
  let mineruReady = false;
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
      response.write(`${JSON.stringify({ status: `Mock download ${payload.model}`, completed: 30, total: 100 })}\n`);
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${ollama.address().port}`;
  fs.writeFileSync(settingsFile, JSON.stringify({ ollamaBaseURL: baseURL, autoCheckUpdates: false,
    onboardingCompletedVersion: 0, onboardingPage: 0, translationModel: 'translategemma:4b',
    summaryModel: 'translategemma:4b', explainModel: 'translategemma:4b', quickLookupModel: 'translategemma:4b' }));

  let app;
  let page;
  const onboarding = () => page.locator('.onboarding');
  async function assertPage(index) {
    await page.locator(`.onboarding[data-onboarding-page="${index}"]`).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.onboarding-rail li[aria-current="step"]').innerText(), ['Welcome', 'Ollama', 'Translation model', 'MinerU parser', 'Explanation model', 'Ready'][index]);
  }
  async function next(index) {
    await onboarding().getByRole('button', { name: 'Continue', exact: true }).click();
    await assertPage(index);
  }
  async function assertFooter(width, height, screenshot) {
    await page.setViewportSize({ width, height });
    const checks = await page.locator('.onboarding-footer button').evaluateAll(buttons => buttons.filter(button => getComputedStyle(button).display !== 'none').map(button => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { label: button.textContent.trim(), visible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, unobstructed: Boolean(hit && button.contains(hit)) };
    }));
    assert.ok(checks.length >= 3);
    for (const check of checks) { assert.equal(check.visible, true, `${width}x${height}: ${check.label} is within viewport`); assert.equal(check.unobstructed, true, `${width}x${height}: ${check.label} is clickable`); }
    if (screenshot) await page.screenshot({ path: path.join(artifacts, screenshot) });
  }
  async function mockTools() {
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      global.__onboardingMock = { runtimeReady: fixture.runtimeReady, mineruReady: fixture.mineruReady, installed: fixture.installed, requests: [], pending: null };
      const state = global.__onboardingMock;
      const send = event => BrowserWindow.getAllWindows().forEach(window => window.webContents.send('paperbridge:progress', event));
      for (const channel of ['setup:status', 'setup:install', 'setup:cancel', 'hardware:status', 'mineru:runtime']) ipcMain.removeHandler(channel);
      ipcMain.handle('hardware:status', () => ({ systemMemoryBytes: 32 * 1024 ** 3, adapters: [{ vendor: 'AMD', name: 'Mock AMD GPU', memoryBytes: 2 ** 32 - 1 }] }));
      ipcMain.handle('mineru:runtime', () => ({ cuda: false }));
      ipcMain.handle('setup:status', () => ({
        busy: Boolean(state.pending), hardware: { systemMemoryBytes: 32 * 1024 ** 3, adapters: [{ vendor: 'AMD', name: 'Mock AMD GPU' }] },
        ollama: { installed: state.runtimeReady, running: state.runtimeReady, models: state.installed },
        mineru: { installed: state.mineruReady, compatible: state.mineruReady, executable: fixture.managedMineru, version: 'MinerU test fixture', runtime: { cuda: false } },
        plan: { gpu: { reason: 'Mock AMD hardware: MinerU uses its CPU pipeline.' } }
      }));
      ipcMain.handle('setup:install', (_event, payload) => {
        if (state.pending) throw new Error('Mock setup is already running.');
        state.requests.push(payload);
        send({ kind: 'setup', phase: payload.components.mineru ? 'mineru' : 'ollama', message: 'Mock component install is running…' });
        return new Promise((resolve, reject) => { state.pending = { payload, resolve, reject }; });
      });
      ipcMain.handle('setup:cancel', () => {
        const pending = state.pending; state.pending = null;
        pending?.reject(new Error('Mock setup cancelled.'));
        send({ kind: 'setup', phase: 'cancelled', message: 'Mock setup cancelled.' });
        return Boolean(pending);
      });
    }, { runtimeReady, mineruReady, installed: [...installed], managedMineru });
  }
  async function launch(expectedPage) {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace, PAPERBRIDGE_TOOLS_ROOT: path.join(workspace, 'mock-tools') }, timeout: 30000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1320, height: 820 });
    if (expectedPage !== null) await assertPage(expectedPage);
    else { await page.locator('.welcome').waitFor({ timeout: 20000 }); assert.equal(await onboarding().count(), 0); }
    // Preserve real bootstrap/storage and renderer state. Only local tool installers/status are mocked;
    // model pulls still use the production IPC manager and a streaming local Ollama fixture.
    await mockTools();
    await page.reload();
    if (expectedPage !== null) { await assertPage(expectedPage); await waitFor(() => onboarding().getByRole('button', { name: 'Refresh status', exact: true }).isEnabled(), 'mock status ready'); }
    else { await page.locator('.welcome').waitFor(); assert.equal(await onboarding().count(), 0); }
  }
  async function restart(expectedPage) { await app.close(); app = null; await launch(expectedPage); }
  async function assertBusy(index, cancelName) {
    await onboarding().getByRole('button', { name: cancelName, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close dialog', exact: true }).isDisabled(), true);
    for (const name of ['Skip setup', 'Advanced setup', 'Back', 'Continue']) {
      const button = onboarding().getByRole('button', { name, exact: true });
      if (await button.count()) assert.equal(await button.isDisabled(), true, `${name} must be disabled during setup`);
    }
    await page.keyboard.press('Escape');
    await assertPage(index);
    // Keyboard navigation must stay inside the modal even after it wraps repeatedly.
    for (const key of [...Array(15).fill('Tab'), ...Array(15).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.modal'))), true, `${key} must not focus the background during setup`);
    }
    await page.locator('.modal').focus();
    await page.getByRole('button', { name: 'Settings', exact: true }).first().evaluate(button => button.focus());
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.modal'))), true, 'The inert background must reject focus');
    await page.keyboard.press('Enter');
    await assertPage(index);
    assert.equal(await onboarding().getByRole('button', { name: cancelName, exact: true }).count(), 1);
    // Exercise the same command channel as the native menu, even if the menu item itself is disabled.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('paperbridge:command', 'settings'));
    await assertPage(index);
    assert.equal(savedSettings().onboardingCompletedVersion, 0);
  }
  async function completeSetup() {
    const payload = await app.evaluate(({ BrowserWindow }, managedMineru) => {
      const state = global.__onboardingMock;
      const pending = state.pending;
      if (!pending) throw new Error('Expected a pending setup');
      state.pending = null;
      if (pending.payload.components.ollama) state.runtimeReady = true;
      if (pending.payload.components.mineru) state.mineruReady = true;
      const result = pending.payload.components.mineru ? { mineruExecutable: managedMineru, mineruBackend: 'pipeline' } : {};
      BrowserWindow.getAllWindows().forEach(window => window.webContents.send('paperbridge:progress', { kind: 'setup', phase: 'done', message: 'Mock component installed.' }));
      pending.resolve(result);
      return pending.payload;
    }, managedMineru);
    setupPayloads.push(payload);
    if (payload.components.ollama) runtimeReady = true;
    if (payload.components.mineru) mineruReady = true;
    await waitFor(() => onboarding().getByRole('button', { name: 'Continue', exact: true }).isEnabled(), 'setup to release navigation');
    return payload;
  }
  async function finishPull(index) {
    const pull = pulls[index];
    installed.add(pull.payload.model);
    await app.evaluate((_electron, models) => { global.__onboardingMock.installed = models; }, [...installed]);
    pull.response.end(`${JSON.stringify({ status: 'success', completed: 100, total: 100 })}\n`);
    await waitFor(() => onboarding().getByRole('button', { name: 'Continue', exact: true }).isEnabled(), 'model download to release navigation');
  }
  const roles = settings => [settings.summaryModel, settings.explainModel, settings.quickLookupModel];

  try {
    await launch(0);
    assert.equal(savedSettings().onboardingCompletedVersion, 0);
    assert.deepEqual(await page.locator('.onboarding-rail li').allTextContents(), ['Welcome', 'Ollama', 'Translation model', 'MinerU parser', 'Explanation model', 'Ready']);
    assert.equal(pulls.length, 0, 'First launch must not download a model');
    assert.equal(await app.evaluate(() => global.__onboardingMock.requests.length), 0, 'First launch must not install tools');
    await assertFooter(1320, 820, 'onboarding-welcome-1320x820.png');
    await assertFooter(980, 620, 'onboarding-welcome-980x620.png');

    await next(1);
    await onboarding().getByRole('button', { name: 'Install Ollama', exact: true }).click();
    await assertBusy(1, 'Cancel setup');
    const cancelledSetup = await app.evaluate(() => global.__onboardingMock.requests[0]);
    assert.deepEqual(cancelledSetup.components, { ollama: true, models: false, mineru: false });
    await onboarding().getByRole('button', { name: 'Cancel setup', exact: true }).click();
    await waitFor(() => onboarding().getByRole('button', { name: 'Install Ollama', exact: true }).isEnabled(), 'cancelled runtime install');
    await onboarding().getByRole('button', { name: 'Install Ollama', exact: true }).click();
    assert.deepEqual((await completeSetup()).components, { ollama: true, models: false, mineru: false });
    await onboarding().getByText('Ollama is ready', { exact: true }).waitFor();
    await next(2);
    await waitFor(() => savedSettings().onboardingPage === 2, 'translation step persistence');
    await restart(2);
    assert.equal(savedSettings().onboardingCompletedVersion, 0, 'Closing the application retains unfinished onboarding');
    assert.equal(await page.locator('.onboarding-model-card').count(), 3);
    await assertFooter(1320, 820, 'onboarding-translation-1320x820.png');
    await assertFooter(980, 620, 'onboarding-translation-980x620.png');

    const translation12 = () => page.locator('[data-model-id="translategemma:12b"] button');
    await translation12().click();
    await waitFor(() => pulls.length === 1, 'first translation pull');
    assert.deepEqual(pulls[0].payload, { model: 'translategemma:12b', stream: true });
    await assertBusy(2, 'Cancel download');
    await onboarding().getByRole('button', { name: 'Cancel download', exact: true }).click();
    await waitFor(() => pulls[0].closed && translation12().isEnabled(), 'cancelled model stream');
    assert.equal(savedSettings().translationModel, 'translategemma:4b');
    assert.deepEqual(roles(savedSettings()), Array(3).fill('translategemma:4b'));
    // A late response from a cancelled stream must not apply a model or finish the guide.
    pulls[0].response.end(`${JSON.stringify({ status: 'success' })}\n`);
    await translation12().click();
    await waitFor(() => pulls.length === 2, 'retry translation pull');
    await finishPull(1);
    await waitFor(() => savedSettings().translationModel === 'translategemma:12b' && roles(savedSettings()).every(model => model === 'translategemma:12b'), 'translation and following assistant roles');
    await page.locator('[data-model-id="translategemma:4b"]').getByRole('button', { name: 'Use model', exact: true }).click();
    await waitFor(() => savedSettings().translationModel === 'translategemma:4b' && roles(savedSettings()).every(model => model === 'translategemma:4b'), 'using an installed translation model');
    assert.equal(pulls.length, 2, 'Use model must not redownload installed weights');

    await next(3);
    await onboarding().getByRole('button', { name: 'Install MinerU', exact: true }).click();
    await assertBusy(3, 'Cancel setup');
    const mineruPayload = await completeSetup();
    assert.deepEqual(mineruPayload.components, { ollama: false, models: false, mineru: true });
    assert.equal(mineruPayload.repairMineru, false);
    await waitFor(() => savedSettings().mineruExecutable === managedMineru && savedSettings().mineruBackend === 'pipeline', 'installed parser settings');
    await onboarding().getByRole('button', { name: 'Repair / update MinerU', exact: true }).click();
    const repairPayload = await completeSetup();
    assert.deepEqual(repairPayload.components, { ollama: false, models: false, mineru: true });
    assert.equal(repairPayload.repairMineru, true);
    await next(4);
    assert.equal(await page.locator('.onboarding-model-card').count(), 6);
    await assertFooter(1320, 820, 'onboarding-assistants-1320x820.png');
    await assertFooter(980, 620, 'onboarding-assistants-980x620.png');
    await page.locator('[data-model-id="qwen3:4b-instruct"] button').click();
    await waitFor(() => pulls.length === 3, 'assistant model pull');
    assert.equal(pulls[2].payload.model, 'qwen3:4b-instruct');
    await finishPull(2);
    await waitFor(() => roles(savedSettings()).every(model => model === 'qwen3:4b-instruct'), 'downloaded assistant model roles');
    assert.equal(savedSettings().translationModel, 'translategemma:4b');
    await page.locator('[data-model-id="gemma3:4b"]').getByRole('button', { name: 'Use model', exact: true }).click();
    await waitFor(() => roles(savedSettings()).every(model => model === 'gemma3:4b'), 'installed assistant model roles');
    assert.equal(pulls.length, 3);
    assert.equal(savedSettings().translationModel, 'translategemma:4b');
    await next(5);
    await onboarding().getByRole('heading', { name: 'Your local reader is ready.', exact: true }).waitFor();
    await assertFooter(1320, 820, 'onboarding-ready-1320x820.png');
    await assertFooter(980, 620, 'onboarding-ready-980x620.png');

    await onboarding().getByRole('button', { name: 'Skip setup', exact: true }).click();
    await onboarding().waitFor({ state: 'detached' });
    assert.equal(savedSettings().onboardingCompletedVersion, 1);
    await restart(null);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Getting Started guide', exact: true }).click();
    await assertPage(0);
    for (let index = 1; index < 6; index++) await next(index);
    await onboarding().getByRole('button', { name: 'Try a Practice Paper', exact: true }).click();
    await onboarding().waitFor({ state: 'detached' });
    await page.locator('.title-wrap h1').getByText('Welcome to PaperBridge (practice sample)', { exact: true }).waitFor();
    await waitFor(() => fs.existsSync(path.join(workspace, 'papers')) && fs.readdirSync(path.join(workspace, 'papers')).some(file => file.endsWith('.json')), 'practice paper saved');
    assert.equal(savedSettings().onboardingCompletedVersion, 1);
    assert.equal(pulls.length, 3, 'Finishing with a practice paper must not launch AI');

    // A slow settings save keeps the guide modal, and repeated finish clicks open one dialog.
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Getting Started guide', exact: true }).click();
    for (let index = 1; index < 6; index++) await next(index);
    await waitFor(() => savedSettings().onboardingPage === 5, 'Ready step before delayed completion');
    await app.evaluate(({ ipcMain }, fixture) => {
      const store = process.getBuiltinModule('module').createRequire(fixture.storageModule)(fixture.storageModule).createStore(fixture.workspace);
      global.__onboardingFinish = { pending: [], released: false, imports: 0, saveCalls: 0 };
      ipcMain.removeHandler('settings:save');
      ipcMain.handle('settings:save', async (_event, settings) => {
        const state = global.__onboardingFinish;
        state.saveCalls++;
        if (!state.released) await new Promise(resolve => state.pending.push(resolve));
        store.saveSettings(settings);
      });
      ipcMain.removeHandler('pdf:import');
      ipcMain.handle('pdf:import', () => { global.__onboardingFinish.imports++; return null; });
    }, { workspace, storageModule: path.join(root, 'electron', 'storage.cjs') });
    const finish = onboarding().getByRole('button', { name: 'Finish & Open PDF', exact: true });
    // Two user clicks arrive while the first settings save is still pending.
    const finishBounds = await finish.boundingBox();
    await page.mouse.click(finishBounds.x + finishBounds.width / 2, finishBounds.y + finishBounds.height / 2, { clickCount: 2, delay: 20 });
    await waitFor(() => app.evaluate(() => global.__onboardingFinish.pending.length > 0), 'delayed completion save');
    assert.equal(await page.locator('.modal').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.modal-body').evaluate(element => element.inert), true);
    assert.equal(await app.evaluate(() => global.__onboardingFinish.imports), 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await assertPage(5);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.modal'))), true);
    await app.evaluate(() => {
      const state = global.__onboardingFinish;
      state.released = true;
      state.pending.splice(0).forEach(resolve => resolve());
    });
    await onboarding().waitFor({ state: 'detached' });
    await waitFor(() => app.evaluate(() => global.__onboardingFinish.imports === 1), 'single PDF dialog after duplicate finish clicks');
    // Wait for the regular settings effect too, so a queued duplicate completion cannot hide.
    await waitFor(() => app.evaluate(() => global.__onboardingFinish.pending.length === 0), 'completion save queue drained');
    assert.equal(await app.evaluate(() => global.__onboardingFinish.imports), 1);
    assert.deepEqual(errors, [], 'Renderer must not throw');
    fs.writeFileSync(path.join(artifacts, 'onboarding-actions.json'), JSON.stringify({ cancelledSetup, setupPayloads, pulls: pulls.map(pull => pull.payload), settings: savedSettings() }, null, 2));
    console.log('Onboarding passed: real first-launch/resume/skip persistence, Settings reopening, six steps, isolated installs/repair, streamed download cancellation and model roles, busy dismissal and keyboard focus guards, practice completion, delayed-save duplicate completion, and usable footer at 1320x820 / 980x620.');
  } finally {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'onboarding-final.png') }).catch(() => {});
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
