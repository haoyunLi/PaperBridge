// The test installs Ollama and a real model on a disposable Windows runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView, openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');

async function run() {
  assert.ok(process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.platform === 'win32' && process.env.PAPERBRIDGE_TEST_EXECUTABLE,
    'The clean installation check requires a disposable hosted Windows machine.');
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'paperbridge-first-use-'));
  const size = process.env.GITHUB_REF_NAME?.match(/-(12b|27b)$/)?.[1] || '4b';
  const model = 'translategemma:' + size;
  const report = { release: process.env.PAPERBRIDGE_CLEAN_RELEASE, model, stage: 'fresh installation', systemRAM: os.totalmem() };
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
  async function closeReader(app) {
    const pid = await app.evaluate(() => process.pid);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      setImmediate(() => window.close());
    });
    // On Windows the installed Ollama tray process outlives the reader. Wait
    // for PaperBridge's actual OS process, independently of test-driver pipes.
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === 'ESRCH') return pid; throw error; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('PaperBridge process ' + pid + ' did not exit after its window closed');
  }
  const url = 'http://127.0.0.1:11434';
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
    const disk = fs.statfsSync(os.homedir());
    report.freeModelDisk = disk.bavail * disk.bsize;
    report.freeRAM = os.freemem();
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
    if (size === '27b' && report.freeModelDisk < 22000000000) {
      // The largest weights plus the fallback model need room on the same drive.
      await closeReader(app);
      report.stage = '27B transfer cancelled on disk-limited runner';
      return;
    }
    checkpoint('resuming model in the background');
    await download.click();
    await guide.getByRole('button', { name: 'Continue in Background', exact: true }).click();
    await guide.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel download', exact: true }).waitFor({ state: 'hidden', timeout: 15 * 60000 });
    const weights = (await json('/api/tags')).models.find(m => m.name === model);
    assert.ok(weights && weights.size > { '4b': 3e9, '12b': 7e9, '27b': 16e9 }[size]);
    report.weights = { name: model, size: weights.size, digest: weights.digest };
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    checkpoint('translating in the installed reader');
    await revealSidebarSource(page); await openPasteText(page);
    await page.locator('.paste-area').fill('The solar panel supplied power to the temperature sensor. The researchers recorded the temperature every hour.');
    await loadPastedText(page, { view: 'Reader' });
    checkpoint('requesting a translation from the fresh local model');
    await page.locator('#block-1').getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    const result = page.locator('#block-1 .translation-text.done');
    let activeModel = model;
    if (size === '27b') {
      const started = Date.now();
      const smaller = page.getByRole('button', { name: /^Choose (?:a smaller|another) model$/ });
      await Promise.race([result.waitFor({ timeout: 8 * 60000 }), smaller.waitFor({ timeout: 8 * 60000 })]);
      if (await smaller.isVisible()) {
        await page.locator('.notice.error summary').click();
        report.largeModelWaitMs = Date.now() - started;
        report.largeModelError = await page.locator('.notice.error details').innerText();
        assert.match(report.largeModelError, /requires more.*memory|out of.*memory|insufficient.*memory|not enough.*memory|during generation/i);
        report.serviceAfterError = await json('/api/version').then(data => data.version, () => null);
        report.loadedAfterError = await json('/api/ps').then(data => data.models.map(m => ({ name: m.name, size: m.size, vram: m.size_vram })), () => null);
        const serverLog = path.join(process.env.LOCALAPPDATA, 'Ollama', 'server.log');
        if (fs.existsSync(serverLog)) {
          report.runtimeEvents = fs.readFileSync(serverLog, 'utf8').split(/\r?\n/)
            .filter(line => /memory|error|timed out|stopped|offload/i.test(line)).slice(-12).map(line => line.slice(0, 400));
        }
        const original = await page.locator('#block-1 .source-text').innerText();
        if (!report.serviceAfterError) {
          await page.getByRole('button', { name: 'Check local AI', exact: true }).click();
          const setup = page.locator('.setup-panel');
          await setup.getByRole('checkbox', { name: 'Ollama runtime' }).check();
          await setup.getByRole('checkbox', { name: 'Selected AI models' }).uncheck();
          await setup.getByRole('checkbox', { name: /MinerU PDF parser/ }).uncheck();
          await setup.getByRole('button', { name: 'Check again', exact: true }).waitFor();
          const install = setup.getByRole('button', { name: 'Install missing components', exact: true });
          const ready = setup.getByRole('button', { name: /ready/i });
          await Promise.race([install.waitFor(), ready.waitFor()]);
          if (await install.isVisible()) await install.click();
          await ready.waitFor({ timeout: 3 * 60000 });
          await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
          report.restartedService = (await json('/api/version')).version;
        }
        await smaller.click();
        await page.getByRole('tab', { name: 'Local AI', exact: true }).click();
        activeModel = 'translategemma:4b';
        checkpoint('selecting the smaller model after the large-model request failed');
        const fallback = page.locator('[data-model-id="' + activeModel + '"]');
        await fallback.getByRole('button', { name: 'Download & use', exact: true }).click();
        await fallback.getByRole('button', { name: 'Selected', exact: true }).waitFor({ timeout: 10 * 60000 });
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
        assert.equal(await page.locator('#block-1 .source-text').innerText(), original);
        await page.locator('#block-1').getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
      }
    }
    await result.waitFor({ timeout: 5 * 60000 });
    report.translationModel = activeModel;
    report.translation = await result.innerText();
    assert.match(report.translation, /温度/);
    checkpoint('checking the loaded model after translation');
    const loaded = (await json('/api/ps')).models.find(m => m.name === activeModel);
    assert.ok(loaded && loaded.size > 0);
    report.runtimeBytes = loaded.size; report.vramBytes = loaded.size_vram;
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json')));
    assert.equal(settings.translationModel, activeModel);
    checkpoint('closing the reader after its first translation');
    report.closedReaderPID = await closeReader(app);
    assert.equal((await json('/api/version')).version, report.ollama);
    checkpoint('reopening the translated reader');
    app = await launch(); page = await app.firstWindow({ timeout: 60000 });
    page.setDefaultTimeout(45000);
    report.reopenedReaderPID = await app.evaluate(() => process.pid);
    assert.notEqual(report.reopenedReaderPID, report.closedReaderPID);
    await openWorkspaceView(page, 'Reader');
    assert.equal(await page.locator('#block-1 .translation-text.done').innerText(), report.translation);
    report.reopened = true;
    await closeReader(app);
    report.stage = 'complete';
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
    }
  }
}
// All reports are written synchronously. The runner owns the independently
// installed local service after this verification program finishes.
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
