const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'menu-state-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected menu state test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: request.url === '/api/tags' ? [{ model: 'translategemma:4b' }] : [] }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.evaluate(() => {
      window.__menuCommands = [];
      window.paperBridge.onCommand(command => window.__menuCommands.push(command));
    });
    const update = state => page.evaluate(state => window.paperBridge.updateMenuState(state), state);
    const native = () => app.evaluate(({ Menu }) => {
      const values = {};
      for (const group of Menu.getApplicationMenu().items) for (const item of group.submenu.items) {
        if (item.id?.startsWith('command:')) values[item.id.slice(8)] = item.enabled;
      }
      return values;
    });

    await update({ ready: true });
    let values = await native();
    assert.equal(values.openPdf, true);
    assert.equal(values.export, false);
    assert.equal(values.generateSummary, false);
    assert.equal(values.translateSelection, false);
    assert.equal(values.onboarding, true);

    const available = { ready: true, hasPaper: true, hasSelection: true, canUndo: true, canPrimaryTask: true,
      canGoBack: true, canGoForward: true, canSummarize: true, canFullTranslation: true, canLookupSelection: true, canExport: true };
    await update(available);
    values = await native();
    assert.equal(Object.values(values).every(Boolean), true);
    await update({ ...available, busy: true, canLookupSelection: false, checkingUpdates: true });
    values = await native();
    for (const command of ['openPdf', 'export', 'generateSummary', 'generateFullTranslation', 'primaryTask', 'translateSelection', 'explainSelection', 'checkUpdates']) assert.equal(values[command], false);
    for (const command of ['summary', 'find', 'highlightSelection', 'undo', 'onboarding']) assert.equal(values[command], true);

    const previous = values;
    for (const invalid of [{ ready: 'true' }, { execute: true }, null]) {
      const error = await page.evaluate(async state => {
        try { await window.paperBridge.updateMenuState(state); return ''; }
        catch (cause) { return cause.message; }
      }, invalid);
      assert.match(error, /Invalid menu state/);
      assert.deepEqual(await native(), previous, 'Invalid IPC data must leave the native menu unchanged');
    }

    await update({});
    assert.equal(Object.values(await native()).every(enabled => !enabled), true);
    await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu().getMenuItemById('command:onboarding').click(null, BrowserWindow.getAllWindows()[0]));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => window.__menuCommands), [], 'Disabled native action must not dispatch a command');
    await update({ ready: true });
    await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu().getMenuItemById('command:onboarding').click(null, BrowserWindow.getAllWindows()[0]));
    await page.waitForFunction(() => window.__menuCommands.includes('onboarding'));
    assert.deepEqual(await page.evaluate(() => window.__menuCommands), ['onboarding']);
    console.log('Native menus followed paper/task/selection/update state, rejected invalid IPC data, and dispatched Getting Started only when enabled.');
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
