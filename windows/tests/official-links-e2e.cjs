const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'official-links-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected official links test workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await app.evaluate(({ shell }) => {
      global.__officialBrowserLinks = [];
      shell.openExternal = async url => { global.__officialBrowserLinks.push(url); };
    });
    const allowed = ['https://ollama.com/download/windows', 'https://ollama.com/library/translategemma:4b'];
    const blocked = ['https://other.example/', 'http://ollama.com/library/qwen3', 'https://user:pass@ollama.com/library/qwen3',
      'https://ollama.com:8443/library/qwen3', 'https://ollama.com/download/mac'];
    for (const url of [...allowed, ...blocked]) {
      await page.evaluate(url => { window.open(url, '_blank'); }, url);
    }
    const deadline = Date.now() + 5000;
    let opened;
    do {
      opened = await app.evaluate(() => global.__officialBrowserLinks);
      if (opened.length === allowed.length) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.deepEqual(opened, allowed);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'External links must not create an Electron child window');
    console.log('Electron new-window handling opened only official Ollama links through the stubbed system browser and rejected other destinations.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
