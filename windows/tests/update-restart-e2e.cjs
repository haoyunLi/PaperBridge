const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'update-restart-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected update restart test workspace');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const settingsFile = path.join(workspace, 'settings.json');
  const cacheFile = path.join(workspace, 'updates.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const launch = () => electron.launch({ args: ['.'], cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    const currentVersion = await app.evaluate(({ app }) => app.getVersion());
    const parts = currentVersion.split('.').map(Number);
    const nextVersion = `${parts[0]}.${parts[1] + 1}.0`;
    const identity = { tag: `windows-v${nextVersion}`, installerName: `PaperBridge Setup ${nextVersion}.exe` };
    await app.evaluate((_electron, fixture) => {
      const originalFetch = global.fetch;
      global.__updateReleaseCalls = 0;
      global.fetch = (url, options) => {
        if (String(url) === 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100') {
          global.__updateReleaseCalls++;
          return Promise.resolve(new Response(JSON.stringify([{ tag_name: fixture.tag, draft: false, prerelease: false,
            assets: [{ name: fixture.installerName, state: 'uploaded' }] }]), { status: 200 }));
        }
        return originalFetch(url, options);
      };
    }, identity);
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const command = Menu.getApplicationMenu().getMenuItemById('command:checkUpdates');
      if (!command.enabled) throw new Error('Check for Updates must be enabled after startup');
      command.click(null, BrowserWindow.getAllWindows()[0]);
    });
    await page.locator('.update-banner').getByText(`PaperBridge for Windows ${nextVersion} is available`, { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => global.__updateReleaseCalls), 1);
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(cached.cacheVersion, 1);
    assert.deepEqual(cached.release, identity);
    assert.equal(Number.isSafeInteger(cached.lastCheckAt), true);
    // Enable the normal startup check through the public settings IPC before quitting.
    await page.evaluate(async () => {
      const state = await window.paperBridge.bootstrap();
      await window.paperBridge.saveSettings({ ...state.settings, autoCheckUpdates: true });
    });
    await app.close();
    app = null;
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoCheckUpdates, true);

    app = await launch();
    page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.locator('.update-banner').getByText(`PaperBridge for Windows ${nextVersion} is available`, { exact: true }).waitFor();
    // After restart there is no fake release provider: the banner must come from disk.
    const restored = await page.evaluate(() => window.paperBridge.checkUpdates(true));
    assert.equal(restored.status, 'available');
    assert.equal(restored.fromCache, true);
    assert.equal(restored.currentVersion, currentVersion);
    assert.equal(restored.releaseUrl, `https://github.com/haoyunLi/PaperBridge/releases/tag/${identity.tag}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cached, 'Startup within 24 hours must not refresh the cache timestamp');
    console.log('A release discovered through the native menu remained visible after a real Electron restart, using its validated daily cache.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
