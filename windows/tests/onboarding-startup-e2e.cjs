const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'onboarding-startup-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected onboarding startup test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const settingsFile = path.join(workspace, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const endpointA = 'http://127.0.0.1:11435';
  const endpointB = 'http://127.0.0.1:11436';
  const globalSettings = { ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 0, ollamaBaseURL: endpointA,
    translationModel: 'translategemma:12b', summaryModel: 'translategemma:12b', explainModel: 'translategemma:12b', quickLookupModel: 'translategemma:12b' };
  const paperSettings = { ...defaults, ollamaBaseURL: endpointB };
  const paper = { id: 'c'.repeat(64), name: 'Delayed startup paper', type: 'text',
    blocks: [{ id: 1, text: 'Example source text retained in the latest paper.', status: 'pending' }], taskSettings: paperSettings };

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await app.evaluate(({ ipcMain }, fixture) => {
      global.__startupSetupConfigs = [];
      global.__startupModelConfigs = [];
      global.__startupStatusPending = [];
      global.__releaseStartupPaper = null;
      ipcMain.removeHandler('bootstrap');
      ipcMain.handle('bootstrap', () => ({ settings: fixture.globalSettings, version: '0.2.0', glossary: [],
        library: [{ id: fixture.paper.id, name: fixture.paper.name, blockCount: 1 }], lastPaperId: fixture.paper.id }));
      ipcMain.removeHandler('paper:load');
      ipcMain.handle('paper:load', () => new Promise(resolve => { global.__releaseStartupPaper = () => resolve(fixture.paper); }));
      ipcMain.removeHandler('ollama:models');
      ipcMain.handle('ollama:models', (_event, baseURL) => {
        global.__startupModelConfigs.push(baseURL);
        return [baseURL === fixture.endpointA ? 'translategemma:12b' : 'translategemma:4b'];
      });
      ipcMain.removeHandler('setup:status');
      ipcMain.handle('setup:status', (_event, config) => {
        global.__startupSetupConfigs.push(config.baseURL);
        return new Promise(resolve => global.__startupStatusPending.push(() => resolve({ busy: false,
          ollama: { running: true, installed: true, models: [config.baseURL === fixture.endpointA ? 'translategemma:12b' : 'translategemma:4b'] },
          mineru: { compatible: false, installed: false }, hardware: { adapters: [] },
          plan: { ollama: false, models: [], mineru: true, gpu: { reason: 'Startup race fixture' } } })));
      });
    }, { globalSettings, paper, endpointA });

    await page.reload();
    await waitFor(() => app.evaluate(() => Boolean(global.__releaseStartupPaper)), 'delayed startup paper request');
    assert.equal(await page.locator('.onboarding').count(), 0, 'First-launch guide must wait until saved paper task settings have restored');
    assert.deepEqual(await app.evaluate(() => global.__startupSetupConfigs), [], 'No setup diagnosis should use the pre-restore global endpoint');
    await app.evaluate(() => global.__releaseStartupPaper());
    await page.locator('.onboarding').waitFor();
    await page.locator('.title-wrap h1').getByText('Delayed startup paper').waitFor();
    await waitFor(() => app.evaluate(() => global.__startupStatusPending.length > 0), 'setup diagnosis after restore');
    assert.equal((await app.evaluate(() => global.__startupSetupConfigs)).every(endpoint => endpoint === endpointB), true, 'All guide diagnostics must target the restored paper endpoint');
    await app.evaluate(() => { for (const finish of global.__startupStatusPending.splice(0)) finish(); });

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const card4b = page.locator('[data-model-id="translategemma:4b"]');
    const card12b = page.locator('[data-model-id="translategemma:12b"]');
    await card4b.getByRole('button', { name: 'Selected', exact: true }).waitFor();
    assert.equal(await card12b.getByRole('button', { name: 'Use model', exact: true }).count(), 0);
    await card12b.getByRole('button', { name: 'Download & use', exact: true }).waitFor();
    await waitFor(() => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).ollamaBaseURL === endpointB, 'restored endpoint to save');
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).translationModel, 'translategemma:4b');
    console.log('First-launch onboarding waited for the delayed recent paper, diagnosed its restored Ollama endpoint, and displayed the correct installed model.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
