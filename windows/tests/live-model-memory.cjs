// Opt-in hardware test. This server reads an already installed model and has its own endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'live-memory-'));
  const address = '127.0.0.1:' + await freePort(), baseURL = 'http://' + address;
  const model = 'translategemma:4b';
  const { translationPrompt, translationSystem } = await import('../src/prompts.mjs');
  const source = 'The solar panel supplied power to the temperature sensor. The researchers recorded the temperature every hour.';
  const log = fs.openSync(path.join(workspace, 'ollama.log'), 'w');
  const server = spawn(process.env.PAPERBRIDGE_OLLAMA_EXE || 'ollama.exe', ['serve'], {
    env: { ...process.env, OLLAMA_HOST: address }, windowsHide: true, stdio: ['ignore', log, log]
  });
  const closed = new Promise(resolve => server.once('close', resolve));
  let startError;
  server.once('error', error => { startError = error; });
  fs.closeSync(log);
  async function api(endpoint, payload) {
    const response = await fetch(baseURL + '/api/' + endpoint, {
      signal: AbortSignal.timeout(payload ? 120000 : 4000),
      ...(payload && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    });
    if (!response.ok) throw Error('Ollama ' + endpoint + ': ' + response.status + ' ' + await response.text());
    return response.json();
  }
  let app, loaded = false;
  const history = [];
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (startError) throw startError;
      if (server.exitCode !== null) throw Error('Isolated Ollama server exited ' + server.exitCode);
      try { await api('version'); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await delay(200); }
    }
    assert.ok((await api('tags')).models.some(item => item.name === model), 'Install TranslateGemma 4B before running this test');
    fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
      ...defaults, ollamaBaseURL: baseURL, autoCheckUpdates: false, onboardingCompletedVersion: 1
    }));
    const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
    app = await electron.launch({ cwd: root, ...(executablePath && { executablePath }),
      args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
    const pane = page.getByLabel('Ollama model memory');
    const empty = () => pane.filter({ hasText: 'No Ollama models are loaded.' }).waitFor({ timeout: 30000 });
    await empty();
    for (const [offload, expected] of [[1, 'CPU + GPU'], [-1, 'GPU'], [0, 'CPU memory only']]) {
      const reply = await api('generate', { model, stream: false, keep_alive: '2m',
        system: translationSystem('Simplified Chinese'),
        prompt: translationPrompt(source, 'English', 'Simplified Chinese'),
        options: { num_gpu: offload, num_ctx: 2048, num_predict: 96, temperature: 0 } });
      loaded = true;
      assert.match(reply.response, /太阳能/);
      assert.match(reply.response, /温度/);
      assert.match(reply.response, /小时/);
      const stats = (await api('ps')).models.find(item => item.name === model);
      assert.ok(stats && stats.size > 0);
      const kind = stats.size_vram === 0 ? 'CPU memory only' : stats.size_vram === stats.size ? 'GPU' : 'CPU + GPU';
      const label = model + ' · ' + kind + (kind === 'CPU memory only' ? '' : ' ·');
      await pane.filter({ hasText: label }).waitFor({ timeout: 15000 });
      history.push({ offload, requested: expected, actual: kind, bytes: stats.size, vram: stats.size_vram,
        display: await pane.innerText(), translation: reply.response });
      await pane.getByRole('button', { name: 'Release memory for ' + model, exact: true }).click();
      await empty();
      assert.ok(!(await api('ps')).models.some(item => item.name === model));
      assert.ok((await api('tags')).models.some(item => item.name === model));
      loaded = false;
    }
    console.log(JSON.stringify({ workspace, history }));
    assert.deepEqual(history.map(item => item.actual), ['CPU + GPU', 'GPU', 'CPU memory only']);
  } finally {
    try { if (loaded) await api('generate', { model, keep_alive: 0, stream: false }); }
    finally {
      try { if (app) await app.close(); }
      finally { if (server.pid && server.exitCode === null) server.kill(); await closed; }
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
