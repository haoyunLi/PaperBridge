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
  const workspace = path.join(artifacts, 'menu-ui-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected menu UI test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const generationRequests = [];
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url === '/api/generate') {
      request.resume();
      request.on('end', () => generationRequests.push(response));
      return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false, onboardingCompletedVersion: 1
  }));

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    const native = () => app.evaluate(({ Menu }) => {
      const values = {};
      for (const group of Menu.getApplicationMenu().items) for (const item of group.submenu.items) {
        if (item.id?.startsWith('command:')) values[item.id.slice(8)] = item.enabled;
      }
      return values;
    });
    const expectMenus = async expected => {
      await waitFor(async () => {
        const actual = await native();
        return Object.entries(expected).every(([command, enabled]) => actual[command] === enabled);
      }, `native menu state ${JSON.stringify(expected)}`);
    };
    const clickMenu = command => app.evaluate(({ Menu, BrowserWindow }, command) => {
      const item = Menu.getApplicationMenu().getMenuItemById(`command:${command}`);
      if (!item?.enabled) throw new Error(`Native menu ${command} is disabled`);
      item.click(null, BrowserWindow.getAllWindows()[0]);
    }, command);

    await expectMenus({ openPdf: true, summary: false, export: false, generateSummary: false, primaryTask: false, translateSelection: false });
    await page.getByRole('button', { name: 'Paste Text', exact: true }).first().click();
    await page.locator('.paste-area').fill('Abstract\n\nThis paper studies deterministic menu state transitions.');
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.locator('.paper-preview-block').first().waitFor();
    await expectMenus({ summary: true, export: true, generateSummary: true, generateFullTranslation: true, primaryTask: true, undo: false, highlightSelection: false });

    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-2 .source-text').waitFor();
    await page.evaluate(() => {
      const source = document.querySelector('#block-2 .source-text');
      const text = source.firstChild;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 10);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector blockquote').waitFor();
    await expectMenus({ translateSelection: true, explainSelection: true, highlightSelection: true, undo: false });
    await clickMenu('highlightSelection');
    await page.locator('#block-2 .source-text mark').waitFor();
    assert.equal(await page.locator('#block-2 .source-text mark').innerText(), 'This paper');
    await expectMenus({ undo: true });
    await clickMenu('undo');
    await page.locator('#block-2 .source-text mark').waitFor({ state: 'detached' });
    await expectMenus({ undo: false });

    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await waitFor(() => generationRequests.length === 1, 'delayed translation request');
    await expectMenus({ openPdf: false, export: false, primaryTask: false, generateSummary: false, generateFullTranslation: false,
      translateSelection: false, explainSelection: false, summary: true, find: true, highlightSelection: true });
    generationRequests[0].end(JSON.stringify({ response: '摘要', done: true }));
    await waitFor(() => generationRequests.length === 2, 'body translation after heading');
    await expectMenus({ openPdf: false, export: false, primaryTask: false, generateSummary: false, generateFullTranslation: false });
    generationRequests[1].end(JSON.stringify({ response: '菜单状态回归测试译文。', done: true }));
    await page.locator('#block-2 .translation-text.done').waitFor();
    await expectMenus({ openPdf: true, export: true, primaryTask: false, generateSummary: true, generateFullTranslation: true });
    await page.keyboard.press('Escape');
    await expectMenus({ translateSelection: false, explainSelection: false, highlightSelection: false });

    // Only environment discovery is stubbed; menu state always comes from the live renderer.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('setup:status');
      ipcMain.handle('setup:status', () => ({ busy: false, hardware: { adapters: [], systemMemoryBytes: 16 * 1024 ** 3 },
        ollama: { installed: true, running: true, models: ['translategemma:4b'] },
        mineru: { installed: false, compatible: false, executable: '' },
        plan: { ollama: false, models: [], mineru: true, gpu: { index: null, reason: 'Test fixture' } } }));
    });
    await expectMenus({ onboarding: true });
    await clickMenu('onboarding');
    await page.getByRole('heading', { name: 'Getting Started', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Build your local reading setup.', exact: true }).waitFor();
    await expectMenus({ summary: false, export: false, generateSummary: false });
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.onboarding-modal').waitFor({ state: 'detached' });
    await expectMenus({ summary: true, export: true, generateSummary: true });
    console.log('Live renderer changes drove native menus for empty/imported papers, selection, highlight/undo, delayed translation, and Getting Started.');
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
