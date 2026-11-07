const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { setupPlan } = require('../electron/setup.cjs');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* A settings write may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function selectedKey(components) { return ['ollama', 'models', 'mineru'].map(key => components?.[key] ? '1' : '0').join(''); }

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'setup-components-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected setup test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const settingsFile = path.join(workspace, 'settings.json');
  const originalMineru = 'C:\\original\\mineru.exe';
  const repairedMineru = 'C:\\managed\\mineru.exe';
  fs.writeFileSync(settingsFile, JSON.stringify({ onboardingCompletedVersion: 1, autoCheckUpdates: false,
    ollamaBaseURL: 'http://127.0.0.1:9', mineruExecutable: originalMineru, mineruBackend: 'pipeline',
    summaryModel: 'summary-fixture:1b', explainModel: 'explain-fixture:1b', quickLookupModel: 'lookup-fixture:1b' }));

  const status = {
    hardware: { adapters: [{ name: 'AMD Radeon', vendor: 'AMD' }], cudaDriver: null, cudaVersion: null },
    ollama: { installed: false, running: false, models: [] },
    mineru: { installed: true, compatible: true, executable: originalMineru, version: 'MinerU 3.4.5', runtime: { cuda: false } }
  };
  const requiredModels = ['translategemma:4b'];
  const plans = {};
  for (let bits = 0; bits < 8; bits++) {
    const components = { ollama: Boolean(bits & 4), models: Boolean(bits & 2), mineru: Boolean(bits & 1) };
    plans[selectedKey(components)] = setupPlan(status, requiredModels, { components });
  }

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      global.__setupComponentInstalls = [];
      global.__setupComponentBusy = false;
      global.__setupRepairAttempts = 0;
      global.__setupPendingRepair = null;
      ipcMain.removeHandler('setup:status');
      ipcMain.handle('setup:status', (_event, config) => ({
        ...fixture.status, plan: fixture.plans[[config.components?.ollama, config.components?.models, config.components?.mineru].map(Boolean).map(value => value ? '1' : '0').join('')],
        busy: global.__setupComponentBusy,
        progress: global.__setupComponentBusy ? { kind: 'setup', phase: 'mineru', message: 'Mock managed MinerU repair in progress…' } : null
      }));
      ipcMain.removeHandler('setup:install');
      ipcMain.handle('setup:install', (_event, config) => {
        global.__setupComponentInstalls.push(config);
        if (!config.repairMineru) return { warning: 'Models installed by mock.' };
        global.__setupRepairAttempts++;
        if (global.__setupRepairAttempts === 1) {
          global.__setupComponentBusy = true;
          return new Promise((resolve, reject) => { global.__setupPendingRepair = { resolve, reject }; });
        }
        return { mineruExecutable: fixture.repairedMineru, mineruBackend: 'auto', warning: 'Managed MinerU repair completed by mock.' };
      });
      ipcMain.removeHandler('setup:cancel');
      ipcMain.handle('setup:cancel', () => {
        const pending = global.__setupPendingRepair;
        global.__setupPendingRepair = null;
        global.__setupComponentBusy = false;
        pending?.reject(new Error('Setup cancelled by mock.'));
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('paperbridge:progress', { kind: 'setup', phase: 'cancelled', message: 'Mock setup cancelled.' });
        return Boolean(pending);
      });
    }, { status, plans, repairedMineru });

    await page.getByRole('button', { name: 'Local AI setup' }).click();
    await page.getByRole('heading', { name: 'Local AI setup' }).waitFor();
    await page.getByLabel('Ollama runtime').uncheck();
    await page.getByLabel('MinerU PDF parser (optional)').uncheck();
    assert.equal(await page.getByLabel('Selected AI models').isChecked(), true);
    await page.getByText('Selected models require Ollama.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Install missing components' }).click();
    await page.getByText('Models installed by mock.').waitFor();
    const modelInstall = await app.evaluate(() => global.__setupComponentInstalls[0]);
    assert.deepEqual(modelInstall.components, { ollama: false, models: true, mineru: false });
    assert.equal(modelInstall.repairMineru, undefined);
    await waitFor(() => {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return saved.mineruExecutable === originalMineru && saved.mineruBackend === 'pipeline';
    }, 'original MinerU configuration after model-only install');

    await page.getByLabel('Selected AI models').uncheck();
    await page.getByLabel('MinerU PDF parser (optional)').check();
    await page.getByRole('button', { name: 'Repair / update MinerU' }).click();
    await waitFor(() => app.evaluate(() => global.__setupComponentBusy), 'first repair to start');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Local AI setup' }).click();
    await page.getByRole('button', { name: 'Cancel setup' }).waitFor();
    assert.deepEqual((await app.evaluate(() => global.__setupComponentInstalls[1])).components, { ollama: false, models: false, mineru: true });
    assert.equal((await app.evaluate(() => global.__setupComponentInstalls[1])).repairMineru, true);
    await page.getByRole('button', { name: 'Cancel setup' }).click();
    await page.getByRole('button', { name: 'Repair / update MinerU' }).waitFor();
    await page.getByRole('button', { name: 'Repair / update MinerU' }).click();
    await page.getByText('Managed MinerU repair completed by mock.').waitFor();
    assert.equal((await app.evaluate(() => global.__setupComponentInstalls[2])).repairMineru, true);
    await waitFor(() => {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return saved.mineruExecutable === repairedMineru && saved.mineruBackend === 'auto';
    }, 'managed MinerU configuration after repair retry');
    const button = name => page.getByRole('button', { name, exact: true });
    await button('Close dialog').click();
    await button('Try a Practice Paper').first().click();
    await button('Set up translation').click();
    const modelsTab = page.getByRole('tab', { name: 'Models', exact: true });
    await modelsTab.waitFor();
    assert.equal(await modelsTab.getAttribute('aria-selected'), 'true');
    await page.getByText('The configured Ollama endpoint is unavailable. Check the Ollama URL and refresh models.').waitFor();

    await app.evaluate(({ ipcMain }, fixture) => {
      global.__taskOllamaReady = false;
      global.__taskSetupChecks = [];
      global.__taskSetupInstalls = [];
      global.__taskGenerations = [];
      ipcMain.removeHandler('ollama:models');
      ipcMain.handle('ollama:models', () => {
        if (!global.__taskOllamaReady) throw new Error('Fixture Ollama is unavailable.');
        return ['translategemma:4b'];
      });
      ipcMain.removeHandler('setup:status');
      ipcMain.handle('setup:status', (_event, config) => {
        global.__taskSetupChecks.push(config);
        return { ...fixture.status, busy: false,
          ollama: { installed: true, running: global.__taskOllamaReady, models: global.__taskOllamaReady ? ['translategemma:4b'] : [] },
          plan: { ...fixture.plan, ollama: !global.__taskOllamaReady, models: config.models.filter(model => !global.__taskOllamaReady || model !== 'translategemma:4b') } };
      });
      ipcMain.removeHandler('setup:install');
      ipcMain.handle('setup:install', (_event, config) => {
        global.__taskSetupInstalls.push(config);
        global.__taskOllamaReady = true;
        return { warning: 'Task setup finished in the fixture.' };
      });
      ipcMain.removeHandler('ollama:generate');
      ipcMain.handle('ollama:generate', (_event, request) => {
        global.__taskGenerations.push(request);
        return '本地任务译文';
      });
    }, { status, plan: plans['110'] });
    await page.getByLabel('Ollama URL').fill('http://localhost:11434');
    await button('Refresh models').click();
    await page.getByRole('tabpanel', { name: 'Models' }).getByText(/Fixture Ollama is unavailable/).waitFor();
    await button('Close dialog').click();
    await button('Full Translation').click();
    await button('Set up full translation').click();
    await page.getByRole('heading', { name: 'Local AI setup', exact: true }).waitFor();
    assert.equal(await page.getByLabel('MinerU PDF parser (optional)').isChecked(), false);
    assert.equal(await page.getByLabel('Ollama runtime').isChecked(), true);
    assert.equal(await page.getByLabel('Selected AI models').isChecked(), true);
    assert.equal(await app.evaluate(() => global.__taskSetupInstalls.length), 0);
    await button('Install missing components').click();
    await page.getByText('Task setup finished in the fixture.').waitFor();
    const taskInstall = await app.evaluate(() => global.__taskSetupInstalls[0]);
    assert.deepEqual(taskInstall.components, { ollama: true, models: true, mineru: false });
    assert.deepEqual(taskInstall.models, ['translategemma:4b']);
    await button('Close dialog').click();
    await button('Translate full paper').waitFor();
    assert.equal(await app.evaluate(() => global.__taskGenerations.length), 0, 'installation must not start translation automatically');

    await button('Overview').click();
    await button('Set up summary').click();
    await page.getByText(/To download: summary-fixture:1b/).waitFor();
    assert.deepEqual(await app.evaluate(() => global.__taskSetupChecks.at(-1).models), ['summary-fixture:1b', 'translategemma:4b']);
    await button('Choose task models').click();
    assert.equal(await modelsTab.getAttribute('aria-selected'), 'true');
    await button('Close dialog').click();
    await button('Reader').click();
    await page.locator('#block-2').getByTitle('Explain full paragraph').click();
    await page.locator('.paragraph-explanation').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.getByText(/To download: explain-fixture:1b/).waitFor();
    assert.deepEqual(await app.evaluate(() => global.__taskSetupChecks.at(-1).models), ['explain-fixture:1b']);
    await button('Close dialog').click();
    await page.locator('#block-2 .source-text').evaluate(element => {
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, 14);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.getByText(/To download: lookup-fixture:1b/).waitFor();
    assert.deepEqual(await app.evaluate(() => global.__taskSetupChecks.at(-1).models), ['lookup-fixture:1b']);
    assert.equal(await app.evaluate(() => global.__taskGenerations.length), 0);
    await button('Close dialog').click();
    await page.locator('#block-1').getByTitle('Translate heading').click();
    await page.locator('#block-1').getByText('本地任务译文', { exact: true }).waitFor();
    console.log('Setup verified: component selection, MinerU repair, task-specific model setup, custom endpoint guidance, and explicit translation.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
