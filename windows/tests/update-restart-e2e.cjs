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
  const launch = (portable = false) => electron.launch({ args: ['.'], cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace,
      PORTABLE_EXECUTABLE_FILE: portable ? path.join(workspace, 'PaperBridge Portable.exe') : '' }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    const currentVersion = await app.evaluate(({ app }) => app.getVersion());
    const parts = currentVersion.split('.').map(Number);
    const nextVersion = `${parts[0]}.${parts[1] + 1}.0`;
    const identity = { tag: `windows-v${nextVersion}`, installerName: `PaperBridge-Windows-${nextVersion}-x64-Setup.exe`,
      portableName: `PaperBridge-Windows-${nextVersion}-x64-Portable.exe` };
    await app.evaluate((_electron, fixture) => {
      const originalFetch = global.fetch;
      global.__updateReleaseCalls = 0;
      global.fetch = (url, options) => {
        if (String(url) === 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100') {
          global.__updateReleaseCalls++;
          return Promise.resolve(new Response(JSON.stringify([{ tag_name: fixture.tag, draft: false, prerelease: false,
            assets: [fixture.installerName, fixture.portableName].map(name => ({ name, state: 'uploaded' })) }]), { status: 200 }));
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
    let cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(cached.cacheVersion, 1);
    assert.deepEqual(cached.release, identity);
    assert.equal(Number.isSafeInteger(cached.lastCheckAt), true);
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await page.locator('.update-banner').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    await app.evaluate(({ shell }) => {
      global.__updateLinks = [];
      shell.openExternal = async url => { global.__updateLinks.push(url); };
    });
    const releaseButton = page.getByRole('button', { name: `View Windows ${nextVersion} release`, exact: true });
    await page.getByRole('button', { name: 'Download installer', exact: true }).click();
    await releaseButton.click();
    await page.getByRole('link', { name: 'View release history', exact: true }).click();
    await page.getByLabel(/Check official Windows releases/).check();
    await releaseButton.waitFor();
    assert.equal(await page.locator('.update-banner').count(), 0, 'An automatic cache hit must respect Later');
    assert.deepEqual(await app.evaluate(() => global.__updateLinks), [
      `https://github.com/haoyunLi/PaperBridge/releases/download/${identity.tag}/${identity.installerName}`,
      `https://github.com/haoyunLi/PaperBridge/releases/tag/${identity.tag}`, 'https://github.com/haoyunLi/PaperBridge/releases'
    ]);
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await page.locator('.update-banner').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    await app.close();
    app = null;
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoCheckUpdates, true);

    app = await launch(true);
    page = await app.firstWindow();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.locator('.update-banner').getByText(`PaperBridge for Windows ${nextVersion} is available`, { exact: true }).waitFor();
    await app.evaluate(({ shell }) => {
      global.__updateLinks = [];
      shell.openExternal = async url => { global.__updateLinks.push(url); };
    });
    await page.locator('.update-banner').getByRole('button', { name: 'Download portable update', exact: true }).click();
    assert.deepEqual(await app.evaluate(() => global.__updateLinks),
      [`https://github.com/haoyunLi/PaperBridge/releases/download/${identity.tag}/${identity.portableName}`]);
    await assert.rejects(page.evaluate(() => window.paperBridge.downloadUpdate('windows-v99.0.0')), /Check for updates/);
    // After restart there is no fake release provider: the banner must come from disk.
    const restored = await page.evaluate(() => window.paperBridge.checkUpdates(true));
    assert.equal(restored.status, 'available');
    assert.equal(restored.fromCache, true);
    assert.equal(restored.currentVersion, currentVersion);
    assert.equal(restored.releaseUrl, `https://github.com/haoyunLi/PaperBridge/releases/tag/${identity.tag}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cached, 'Startup within 24 hours must not refresh the cache timestamp');
    // The fixture supplies bytes at Chromium's transport boundary. The app
    // performs the actual edition selection, file verification and persistence.
    const bytes = 'Portable release fixture for ' + nextVersion;
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    await app.evaluate(({ session, shell }, { identity, bytes, hash }) => {
      const base = 'https://github.com/haoyunLi/PaperBridge/releases/download/' + identity.tag + '/';
      const assets = [identity.installerName, identity.portableName].map(name => ({ name, state: 'uploaded',
        browser_download_url: base + name, size: Buffer.byteLength(bytes), digest: 'sha256:' + hash }));
      const originalFetch = global.fetch;
      global.fetch = (url, options) => String(url) === 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100'
        ? Promise.resolve(Response.json([{ tag_name: identity.tag, assets }])) : originalFetch(url, options);
      global.__fileRequests = [];
      const partition = session.fromPartition('paperbridge-update-downloads');
      partition.downloadURL = url => {
        global.__fileRequests.push(url);
        const item = new (process.getBuiltinModule('node:events').EventEmitter)();
        item.getURLChain = () => [url];
        item.getReceivedBytes = () => Buffer.byteLength(bytes);
        item.setSavePath = file => { item.destination = file; };
        partition.emit('will-download', { preventDefault() { throw new Error('Unexpected fixture URL'); } }, item);
        setImmediate(() => {
          process.getBuiltinModule('node:fs').writeFileSync(item.destination, bytes);
          item.emit('updated');
          item.emit('done', {}, 'completed');
        });
      };
      shell.showItemInFolder = filename => { global.__revealed = filename; };
    }, { identity, bytes, hash });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    const background = page.getByLabel('Download new Windows releases in the background');
    assert.equal(await background.isChecked(), false);
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Check now' && !button.disabled));
    assert.deepEqual(await app.evaluate(() => global.__fileRequests), []);
    await background.check();
    const reveal = page.getByRole('button', { name: 'Show downloaded update', exact: true });
    try { await reveal.last().waitFor({ timeout: 20000 }); }
    catch (error) {
      console.error('Download state:', await page.locator('.update-banner').innerText(), await app.evaluate(() => global.__fileRequests));
      throw error;
    }
    assert.deepEqual(await app.evaluate(() => global.__fileRequests), ['https://github.com/haoyunLi/PaperBridge/releases/download/' + identity.tag + '/' + identity.portableName]);
    const savedFile = path.join(workspace, 'update-downloads', identity.portableName);
    assert.equal(fs.readFileSync(savedFile, 'utf8'), bytes);
    await page.evaluate(tag => window.paperBridge.revealUpdate(tag), identity.tag);
    assert.equal(await app.evaluate(() => global.__revealed), savedFile);
    await app.close(); app = null;
    app = await launch(true);
    page = await app.firstWindow();
    await page.locator('.update-banner').getByRole('button', { name: 'Show downloaded update' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoDownloadUpdates, true);
    await app.evaluate(({ shell }) => { shell.showItemInFolder = () => { throw new Error('Changed download must never be revealed'); }; });
    fs.writeFileSync(savedFile, 'x'.repeat(bytes.length));
    await assert.rejects(page.evaluate(tag => window.paperBridge.revealUpdate(tag), identity.tag), /no longer matches/);
    await page.locator('.update-banner').getByRole('button', { name: 'Download portable update' }).waitFor();
    console.log('Official browser links, opt-in download handoff, verified edition, offline restart and changed-file rejection passed.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
