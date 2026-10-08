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
    ollamaBaseURL: 'http://127.0.0.1:9', mineruExecutable: originalMineru, mineruBackend: 'pipeline' }));

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
    console.log('Setup component selection kept MinerU settings during model-only install; managed repair cancellation, reopen, and retry succeeded in mocks.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
