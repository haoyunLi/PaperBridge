const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'model-pull-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected model pull test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });

  const model = 'paperbridge-download-test:4b';
  const pulls = [];
  let installed = false;
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }, ...(installed ? [{ model }] : [])] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url === '/api/pull') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const pull = { body: JSON.parse(body), response, closed: false };
        pulls.push(pull);
        response.on('close', () => { pull.closed = true; });
        response.setHeader('Content-Type', 'application/x-ndjson');
        response.write(`${JSON.stringify({ status: `downloading attempt ${pulls.length}`, completed: 25, total: 100 })}\n`);
      });
      return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${ollama.address().port}`;
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ollamaBaseURL: baseURL, autoCheckUpdates: false }));

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.evaluate(() => {
      window.__modelPullEvents = [];
      window.paperBridge.onProgress(event => { if (event.kind === 'model') window.__modelPullEvents.push(event); });
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByLabel('Model to download').fill(model);
    const download = page.getByRole('button', { name: 'Download model', exact: true });
    await download.click();
    await waitFor(() => pulls.length === 1, 'first streaming model download');
    await page.getByText('downloading attempt 1', { exact: false }).waitFor();
    assert.equal(await download.isDisabled(), true, 'Download must be disabled during an active pull');
    assert.equal(pulls[0].body.model, model);
    assert.equal(pulls[0].body.stream, true);

    const duplicateError = await page.evaluate(async payload => {
      try { await window.paperBridge.pullModel(payload); return ''; }
      catch (error) { return error.message; }
    }, { baseURL, model });
    assert.match(duplicateError, /already running/);
    const setupError = await page.evaluate(async baseURL => {
      try { await window.paperBridge.setupInstall({ baseURL, models: ['translategemma:4b'], mineruExecutable: '' }); return ''; }
      catch (error) { return error.message; }
    }, baseURL);
    assert.match(setupError, /model download is already running/);
    assert.equal(pulls.length, 1, 'Rejected duplicate must not send another pull request');
    await page.screenshot({ path: path.join(artifacts, 'model-download-progress.png') });

    await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await waitFor(() => pulls[0].closed, 'Ollama streaming connection to close after cancellation');
    await page.waitForFunction(() => window.__modelPullEvents.some(event => event.phase === 'cancelled'));
    await waitFor(() => download.isEnabled(), 'download button to recover after cancellation');
    // A server may finish a cancelled request late. That result cannot reach the next pull.
    pulls[0].response.end(`${JSON.stringify({ status: 'success' })}\n`);
    assert.equal(await page.evaluate(() => window.__modelPullEvents.some(event => event.phase === 'done')), false);
    assert.equal(await page.getByLabel('Translation model').locator('option').filter({ hasText: model }).count(), 0);

    await download.click();
    await waitFor(() => pulls.length === 2, 'retry streaming model download');
    await page.getByText('downloading attempt 2', { exact: false }).waitFor();
    assert.equal(await download.isDisabled(), true);
    installed = true;
    pulls[1].response.end(`${JSON.stringify({ status: 'success', completed: 100, total: 100 })}\n`);
    await page.waitForFunction(() => window.__modelPullEvents.some(event => event.phase === 'done'));
    await waitFor(() => download.isEnabled(), 'download button to recover after success');
    await page.getByLabel('Translation model').locator('option').filter({ hasText: model }).waitFor({ state: 'attached' });
    const phases = await page.evaluate(() => window.__modelPullEvents.filter(event => ['done', 'cancelled', 'error'].includes(event.phase)).map(event => event.phase));
    assert.deepEqual(phases, ['cancelled', 'done']);
    assert.equal(await page.getByRole('button', { name: 'Cancel download', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(artifacts, 'model-download-retried.png') });
    console.log('Model download UI cancellation closed the Ollama stream, rejected concurrent downloads/setup, ignored late completion, and successfully retried.');
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
