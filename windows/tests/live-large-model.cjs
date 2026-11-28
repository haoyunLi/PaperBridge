// Compare an installed 4B with a 12B or 27B downloaded into a disposable Ollama model store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView, openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');

async function loopbackPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function run() {
  const installed4B = process.argv.includes('--installed-4b');
  const variant = installed4B ? '4b' : process.argv.includes('--temporary-12b') ? '12b' : '27b';
  if (!installed4B) {
    const permission = 'PAPERBRIDGE_TEMPORARY_' + variant.toUpperCase();
    assert.equal(process.env[permission], '1', 'Set ' + permission + '=1 to download temporary weights.');
  }
  const model = 'translategemma:' + variant;
  const temporaryPrefix = 'paperbridge-temporary-' + variant + '-';
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'large-model-reader-'));
  const report = { model, stages: [], results: [] };
  const reportFile = path.join(workspace, 'report.json');
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  function stage(name) {
    report.stages.push({ name, at: new Date().toISOString() });
    save();
    console.log(name);
  }

  const tempRoot = fs.realpathSync(os.tmpdir());
  const port = installed4B ? 11434 : await loopbackPort();
  const modelStore = installed4B ? null : fs.mkdtempSync(path.join(tempRoot, temporaryPrefix));
  const baseURL = 'http://127.0.0.1:' + port;
  const log = fs.openSync(path.join(workspace, 'runtime.log'), 'w');
  const server = installed4B ? null : spawn(process.env.PAPERBRIDGE_OLLAMA_EXE || 'ollama.exe', ['serve'], {
    env: { ...process.env, OLLAMA_HOST: baseURL, OLLAMA_MODELS: modelStore },
    windowsHide: true, stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  const closed = server && new Promise(resolve => server.once('close', resolve));
  let startError, app, heartbeat;
  server?.once('error', error => { startError = error; });
  report.temporaryModelStore = modelStore;
  console.log('Report: ' + reportFile);
  const api = async endpoint => (await fetch(baseURL + '/api/' + endpoint, { signal: AbortSignal.timeout(5000) })).json();
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  try {
    stage(installed4B ? 'Checking installed 4B' : 'Starting isolated Ollama');
    for (const deadline = Date.now() + 30000; ; ) {
      if (startError || server?.exitCode != null) throw startError || Error('The isolated runtime exited.');
      try { report.ollama = (await api('version')).version; break; }
      catch (error) { if (Date.now() >= deadline) throw error; await delay(200); }
    }
    const installed = (await api('tags')).models;
    if (installed4B) assert.ok(installed.some(item => item.name === model), 'Install the 4B model before comparing.');
    else assert.deepEqual(installed, []);
    fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults,
      ollamaBaseURL: baseURL, autoCheckUpdates: false, onboardingCompletedVersion: 1,
      sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', ...(installed4B && { translationModel: model }) }));
    app = await launch();
    let page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    report.version = await page.evaluate(async () => (await window.paperBridge.bootstrap()).version);
    report.hardware = await page.evaluate(() => window.paperBridge.graphicsStatus());
    if (!installed4B) {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Local AI', exact: true }).click();
      const card = page.locator('[data-model-id="' + model + '"]');
      await page.evaluate(() => {
        window.largeModelProgress = {};
        window.paperBridge.onProgress(event => {
          if (event.kind === 'model') window.largeModelProgress = { status: event.status, completed: event.completed, total: event.total };
        });
      });
      stage('Downloading ' + variant.toUpperCase() + ' in the reader');
      heartbeat = setInterval(async () => {
        try { report.progress = await page.evaluate(() => window.largeModelProgress); save(); } catch { /* The reader can be restarting. */ }
      }, 10000);
      heartbeat.unref();
      await card.getByRole('button', { name: 'Download & use', exact: true }).click();
      await Promise.race([
        card.getByRole('button', { name: 'Selected', exact: true }).waitFor({ timeout: 90 * 60000 }),
        page.locator('.settings-download-status[role="alert"]').waitFor({ timeout: 90 * 60000 }).then(async () => {
          throw Error(await page.locator('.settings-download-status[role="alert"]').innerText());
        })
      ]);
      clearInterval(heartbeat);
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    const weights = (await api('tags')).models.find(item => item.name === model);
    assert.ok(weights?.size > { '4b': 2e9, '12b': 7e9, '27b': 16e9 }[variant]);
    report.weights = { bytes: weights.size, digest: weights.digest, quantization: weights.details?.quantization_level };
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json'))).translationModel, model);
    const samples = [
      'The solar panel supplied power to the temperature sensor. The researchers recorded the temperature every hour.',
      'The efficiency increased from 12.5% to 14.8%. The study did not establish a causal relationship.',
      'At 300 K, the mean voltage was 1.25 V. The difference was not statistically significant (p = 0.08).'
    ];
    await revealSidebarSource(page);
    await openPasteText(page);
    await page.locator('.paste-area').fill(samples.join('\n\n'));
    const paperId = await loadPastedText(page, { view: 'Reader' });
    for (const [index, source] of samples.entries()) {
      const block = page.locator('#block-' + (index + 1));
      assert.equal(await block.locator('.source-text').innerText(), source);
      stage('Translating paragraph ' + (index + 1));
      const start = Date.now();
      await block.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
      const translated = block.locator('.translation-text.done');
      await Promise.race([translated.waitFor({ timeout: 13 * 60000 }),
        page.locator('.notice.error').waitFor({ timeout: 13 * 60000 }).then(async () => { throw Error(await page.locator('.notice.error').innerText()); })]);
      const translation = await translated.innerText();
      const loaded = (await api('ps')).models.find(item => item.name === model);
      assert.ok(loaded?.size > 0);
      report.results.push({ source, translation, elapsedMs: Date.now() - start, runtimeBytes: loaded.size, vramBytes: loaded.size_vram });
      save();
      assert.ok(loaded.size_vram > 0, 'Ollama did not report GPU allocation.');
      const expected = [
        [/太阳能/, /温度传感器/, /每(?:隔)?(?:一|1)?(?:个)?小时/],
        [/12\.5\s*[%％]/, /14\.8\s*[%％]/, /(?:未|不|没有|没能).*因果/],
        [/300\s*(?:K|开尔文|开)/i, /1\.25\s*(?:V|伏特|伏)/i, /0\.08/, /不|无|未|没有/]
      ];
      for (const detail of expected[index]) assert.match(translation, detail);
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    for (const [index, result] of report.results.entries()) {
      assert.equal(await page.locator('#block-' + (index + 1) + ' .translation-text.done').innerText(), result.translation);
    }
    report.paperId = paperId;
    report.reopened = true;
    stage('Reopened all saved translations');
  } finally {
    clearInterval(heartbeat);
    try { await app?.close(); } finally {
      if (server?.pid && server.exitCode === null) {
        try {
          if ((await api('ps')).models.some(item => item.name === model)) {
            await fetch(baseURL + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, keep_alive: 0, stream: false }), signal: AbortSignal.timeout(30000) });
          }
        } catch { /* The isolated runtime may already have exited. */ }
        server.kill();
      }
      await closed;
      if (modelStore) {
        const existing = fs.realpathSync(modelStore);
        if (path.dirname(existing) !== tempRoot || existing !== modelStore || !path.basename(existing).startsWith(temporaryPrefix)) throw Error('Unexpected model cleanup path.');
        fs.rmSync(existing, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
        report.modelStoreRemoved = !fs.existsSync(modelStore);
      }
      save();
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
