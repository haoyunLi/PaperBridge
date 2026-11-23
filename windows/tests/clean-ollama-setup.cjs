// The test installs Ollama and a real model on a disposable Windows runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView, openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');

async function run() {
  assert.ok(process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.platform === 'win32' && process.env.PAPERBRIDGE_TEST_EXECUTABLE,
    'The clean installation check requires a disposable hosted Windows machine.');
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'paperbridge-first-use-'));
  const report = { release: process.env.PAPERBRIDGE_CLEAN_RELEASE, stage: 'fresh installation' };
  const reportFile = path.join(artifacts, 'clean-ollama-report.json');
  function checkpoint(stage) {
    report.stage = stage;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(stage);
  }
  async function within(operation, milliseconds, label) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  const url = 'http://127.0.0.1:11434', model = 'translategemma:4b';
  const json = async route => (await fetch(url + route, { signal: AbortSignal.timeout(3500) })).json();
  assert.equal(await json('/api/version').then(() => true, () => false), false);
  const launch = () => electron.launch({ executablePath: process.env.PAPERBRIDGE_TEST_EXECUTABLE, cwd: root,
    args: ['--user-data-dir=' + path.join(workspace, 'profile')], env: { ...process.env, PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch(), page, heartbeat;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    heartbeat = setInterval(async () => {
      try {
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        const snapshot = await page.evaluate(() => ({
          screen: document.querySelector('.onboarding, .modal')?.innerText.slice(-1100),
          progress: window.setupReport
        }));
        fs.writeFileSync(reportFile, JSON.stringify({ ...report, ...snapshot }, null, 2));
      } catch { /* The reader can be between processes during restart. */ }
    }, 30000);
    heartbeat.unref();
    checkpoint('opening the first-run guide');
    const guide = page.locator('.onboarding');
    await guide.waitFor();
    await page.evaluate(() => {
      window.setupReport = { phases: [], installerBytes: 0, modelBytes: 0 };
      window.paperBridge.onProgress(event => {
        const stats = window.setupReport;
        if (event.kind === 'setup') {
          if (event.message && stats.phases.at(-1) !== event.message) stats.phases.push(event.message);
          stats.installerBytes = Math.max(stats.installerBytes, Number(event.received) || 0);
        }
        if (event.kind === 'model') stats.modelBytes = Math.max(stats.modelBytes, Number(event.completed) || 0);
      });
    });
    const next = () => guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await next();
    await guide.getByRole('button', { name: 'Install Ollama', exact: true }).click();
    checkpoint('installing signed Ollama runtime');
    const error = guide.locator('.onboarding-error');
    await Promise.race([
      guide.getByText('Ollama is ready', { exact: true }).waitFor({ timeout: 16 * 60000 }),
      error.waitFor({ timeout: 16 * 60000 }).then(async () => { throw Error(await error.innerText()); })
    ]);
    report.ollama = (await json('/api/version')).version;
    report.install = await page.evaluate(() => window.setupReport);
    assert.ok(report.install.installerBytes > 1000000 && report.install.phases.some(s => /publisher signature/i.test(s)));
    assert.ok(!(await json('/api/tags')).models.some(m => m.name === model));
    checkpoint('selecting the translation model');
    await next();
    const card = guide.locator('[data-model-id="' + model + '"]');
    const download = card.getByRole('button', { name: 'Download & use', exact: true });
    await download.click();
    checkpoint('cancelling actual model transfer');
    await page.waitForFunction(() => window.setupReport.modelBytes > 1024 * 1024, null, { timeout: 5 * 60000 });
    await guide.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await download.waitFor({ timeout: 2 * 60000 });
    assert.ok(!(await json('/api/tags')).models.some(m => m.name === model));
    report.bytesAtCancel = await page.evaluate(() => window.setupReport.modelBytes);
    checkpoint('resuming model in the background');
    await download.click();
    await guide.getByRole('button', { name: 'Continue in Background', exact: true }).click();
    await guide.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel download', exact: true }).waitFor({ state: 'hidden', timeout: 15 * 60000 });
    const weights = (await json('/api/tags')).models.find(m => m.name === model);
    assert.ok(weights && weights.size > 1000000000);
    report.weights = { name: model, size: weights.size, digest: weights.digest };
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    checkpoint('translating in the installed reader');
    await revealSidebarSource(page); await openPasteText(page);
    await page.locator('.paste-area').fill('The solar panel supplied power to the temperature sensor. The researchers recorded the temperature every hour.');
    await loadPastedText(page, { view: 'Reader' });
    checkpoint('requesting a translation from the fresh local model');
    await page.locator('#block-1').getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    const result = page.locator('#block-1 .translation-text.done');
    await result.waitFor({ timeout: 5 * 60000 });
    report.translation = await result.innerText();
    assert.match(report.translation, /温度/);
    checkpoint('checking the loaded model after translation');
    const loaded = (await json('/api/ps')).models.find(m => m.name === model);
    assert.ok(loaded && loaded.size > 0);
    report.runtimeBytes = loaded.size; report.vramBytes = loaded.size_vram;
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json')));
    assert.equal(settings.translationModel, model);
    checkpoint('closing the reader after its first translation');
    await within(app.close(), 75000, 'Closing the translated reader');
    checkpoint('reopening the translated reader');
    app = await launch(); page = await app.firstWindow({ timeout: 60000 });
    page.setDefaultTimeout(45000);
    await openWorkspaceView(page, 'Reader');
    assert.equal(await page.locator('#block-1 .translation-text.done').innerText(), report.translation);
    report.reopened = true; report.stage = 'complete';
  } catch (error) {
    report.error = error.message.slice(0, 1200);
    if (page && !page.isClosed()) {
      report.screen = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(-2500);
      report.progress = await within(page.evaluate(() => window.setupReport), 5000, 'Reading final progress').catch(() => null);
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    // A failed setup may still own a task and prompt on normal quit. Only this
    // test's disposable reader needs to exit so Actions can collect its report.
    if (report.error) {
      await within(app.evaluate(({ app }) => { setImmediate(() => app.exit(1)); }), 5000, 'Closing the failed test reader').catch(() => {});
    } else await within(app.close(), 75000, 'Closing the reopened reader');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
