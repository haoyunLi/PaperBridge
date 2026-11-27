const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'update-restart-'));
  const settingsFile = path.join(workspace, 'settings.json');
  const cacheFile = path.join(workspace, 'updates.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = (portable = false) => electron.launch({ ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')], cwd: root,
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
        if (String(url).endsWith('/windows/latest-release.json')) return Promise.resolve(new Response(null, { status: 404 }));
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
    // These small UI fixtures are not published binaries. After the real rejection
    // below, isolate just the proof verifier for the handoff and restart UI checks.
    // The public-release job verifies the actual executables and the signed bundle.
    const useFixtureVerifier = instance => instance.evaluate(({ app }, hash) => {
      const requireApp = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(), 'package.json'));
      const type = requireApp('./electron/update-download.cjs').UpdateDownload;
      const original = type.prototype.save;
      type.prototype.save = function(download, signal) {
        if (download.file.sha256 !== hash) throw new Error('Unexpected test download');
        this.verifyProvenance = async () => {};
        return original.call(this, download, signal);
      };
    }, hash);
    const provideDownload = instance => instance.evaluate(({ session, shell }, { identity, bytes, hash }) => {
      const asset = { size: Buffer.byteLength(bytes), sha256: hash };
      const feed = { version: identity.tag.slice('windows-v'.length), files: { Setup: asset, Portable: asset } };
      const originalFetch = global.fetch;
      global.fetch = (url, options) => {
        if (String(url).endsWith('/windows/latest-release.json')) return Promise.resolve(Response.json(feed));
        if (String(url).endsWith('-provenance.json')) return Promise.resolve(new Response(null, { status: 404 }));
        if (String(url).startsWith('https://api.github.com/')) return Promise.resolve(new Response(null, { status: 403 }));
        return originalFetch(url, options);
      };
      global.__fileRequests = [];
      const partition = session.fromPartition('paperbridge-update-downloads');
      partition.downloadURL = url => {
        global.__fileRequests.push(url);
        const item = new (process.getBuiltinModule('node:events').EventEmitter)();
        item.getURLChain = () => [url];
        item.cancel = () => item.emit('done', {}, 'cancelled');
        item.getReceivedBytes = () => Buffer.byteLength(bytes);
        item.setSavePath = file => { item.destination = file; };
        partition.emit('will-download', { preventDefault() { throw new Error('Unexpected fixture URL'); } }, item);
        if (global.__holdUpdateTransfer) { global.__transferStarted(); return; }
        setImmediate(() => {
          process.getBuiltinModule('node:fs').writeFileSync(item.destination, bytes);
          item.emit('updated');
          item.emit('done', {}, 'completed');
        });
      };
      shell.showItemInFolder = filename => { global.__revealed = filename; };
    }, { identity, bytes, hash });
    await provideDownload(app);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    const background = page.getByLabel('Download new Windows releases in the background');
    assert.equal(await background.isChecked(), false);
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Check now' && !button.disabled));
    assert.deepEqual(await app.evaluate(() => global.__fileRequests), []);
    const updateSettings = page.getByRole('dialog');
    await app.evaluate(() => {
      global.__holdUpdateTransfer = true;
      global.__waitingForTransfer = new Promise(resolve => { global.__transferStarted = resolve; });
    });
    await updateSettings.getByRole('button', { name: 'Download portable update' }).click();
    const cancelDownload = updateSettings.getByRole('button', { name: 'Cancel download', exact: true });
    await cancelDownload.waitFor();
    await app.evaluate(() => global.__waitingForTransfer);
    assert.equal(await page.evaluate(() => window.paperBridge.cancelUpdateDownload('windows-v99.0.0')), false);
    await cancelDownload.focus();
    await page.keyboard.press('Enter');
    await updateSettings.getByText('Update download cancelled. You can download it again.').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Download portable update');
    await background.check();
    const afterCancel = await page.evaluate(() => window.paperBridge.checkUpdates(true));
    assert.equal(afterCancel.updateFile.phase, 'cancelled');
    assert.equal(await app.evaluate(() => global.__fileRequests.length), 1);
    await app.evaluate(() => { global.__holdUpdateTransfer = false; });
    await updateSettings.getByRole('button', { name: 'Download portable update' }).click();
    await page.getByText(/Could not verify the GitHub build proof/).last().waitFor();
    assert.equal(fs.existsSync(path.join(workspace, 'update-downloads', identity.portableName)), false);
    assert.equal(await page.getByRole('button', { name: 'Show downloaded update' }).count(), 0);
    await background.uncheck();
    await useFixtureVerifier(app);
    await app.evaluate(() => { global.__fileRequests = []; });
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
    await useFixtureVerifier(app);
    page = await app.firstWindow();
    const restartedDownload = page.locator('.update-banner');
    await restartedDownload.waitFor();
    // The first-window bootstrap may have checked the cache before test instrumentation.
    await page.evaluate(() => window.paperBridge.checkUpdates(true));
    await restartedDownload.getByRole('button', { name: 'Show downloaded update' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoDownloadUpdates, true);
    await app.evaluate(({ shell }) => { shell.showItemInFolder = () => { throw new Error('Changed download must never be revealed'); }; });
    fs.writeFileSync(savedFile, 'x'.repeat(bytes.length));
    await assert.rejects(page.evaluate(tag => window.paperBridge.revealUpdate(tag), identity.tag), /no longer matches/);
    await page.locator('.update-banner').getByRole('button', { name: 'Download portable update' }).waitFor();
    await assert.rejects(page.evaluate(tag => window.paperBridge.openUpdateInstaller(tag), identity.tag), /installed reader/);
    await app.close(); app = null;
    fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), autoCheckUpdates: false, autoDownloadUpdates: false }));
    app = await launch();
    page = await app.firstWindow();
    await provideDownload(app);
    await useFixtureVerifier(app);
    await app.evaluate(({ app, shell }) => {
      if (!app.isPackaged) Object.defineProperty(app, 'isPackaged', { get: () => true });
      global.__installerRequests = [];
      shell.showItemInFolder = filename => { global.__revealedSetup = filename; };
      shell.openPath = async filename => { global.__installerRequests.push(filename); return global.__installerError || ''; };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    const settings = page.getByRole('dialog');
    await settings.getByRole('button', { name: 'Download installer', exact: true }).click();
    const install = settings.getByRole('button', { name: 'Open installer', exact: true });
    await install.waitFor();
    assert.deepEqual(await app.evaluate(() => global.__installerRequests), [], 'Downloading must never open the installer automatically');
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoDownloadUpdates, false);
    await install.click();
    await settings.getByText('Follow the Windows setup wizard. If no window appears, choose Show downloaded update to find the installer in File Explorer.').waitFor();
    assert.ok(await page.isVisible('body'), 'Opening the standard wizard keeps the reader available');
    const installer = path.join(workspace, 'update-downloads', identity.installerName);
    assert.deepEqual(await app.evaluate(() => global.__installerRequests), [installer]);
    await settings.getByRole('heading', { name: 'Update verification' }).waitFor();
    await app.evaluate(() => { global.__installerError = 'Windows blocked this installer'; });
    await install.click();
    await settings.getByText(/Windows blocked this installer/).waitFor();
    await settings.getByRole('button', { name: 'Show downloaded update', exact: true }).click();
    assert.equal(await app.evaluate(() => global.__revealedSetup), installer);
    await assert.rejects(page.evaluate(tag => window.paperBridge.openUpdateInstaller(tag), 'windows-v99.0.0'), /current verified Setup/);
    fs.writeFileSync(installer, 'x'.repeat(bytes.length));
    await assert.rejects(page.evaluate(tag => window.paperBridge.openUpdateInstaller(tag), identity.tag), /no longer matches/);
    assert.equal(await app.evaluate(() => global.__installerRequests.length), 2);
    await settings.getByRole('button', { name: 'Skip this version' }).focus();
    await page.keyboard.press('Enter');
    await settings.getByText(`Skipped Windows ${nextVersion}. You can still find it with Check now.`).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Check now');
    assert.equal(JSON.parse(fs.readFileSync(cacheFile)).skippedTag, identity.tag);
    await assert.rejects(page.evaluate(tag => window.paperBridge.skipUpdate(tag), 'windows-v99.0.0'), /current release/);
    await page.getByLabel(/Check official Windows releases/).check();
    await page.getByLabel(/Download new Windows releases in the background/).check();
    await page.waitForFunction(async () => (await window.paperBridge.bootstrap()).settings.autoDownloadUpdates === true);
    await app.close();
    app = await launch(true);
    page = await app.firstWindow();
    await provideDownload(app);
    await page.locator('.welcome').waitFor();
    assert.equal((await page.evaluate(() => window.paperBridge.checkUpdates(true))).status, 'skipped');
    assert.deepEqual(await app.evaluate(() => global.__fileRequests), []);
    assert.equal(await page.locator('.update-banner').count(), 0);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await page.locator('.update-banner').getByText(`PaperBridge for Windows ${nextVersion} is available`).waitFor({ state: 'attached' });
    assert.deepEqual(await app.evaluate(() => global.__fileRequests), [], 'Manual discovery of a skipped release needs an explicit download');
    assert.equal((await page.evaluate(() => window.paperBridge.checkUpdates(true))).status, 'skipped');
    await page.getByRole('dialog').getByRole('button', { name: 'Download portable update', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(item => item.textContent.includes('verify the GitHub build proof')));
    assert.equal(await app.evaluate(() => global.__fileRequests.length), 1);
    await app.close();
    app = null;
    // A subsequent release must still surface on startup.
    fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile)), autoDownloadUpdates: false }));
    const laterVersion = `${parts[0]}.${parts[1] + 1}.1`;
    const nextCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const laterRelease = JSON.parse(JSON.stringify(nextCache.release).replaceAll(nextVersion, laterVersion));
    fs.writeFileSync(cacheFile, JSON.stringify({ ...nextCache, release: laterRelease }));
    app = await launch(true);
    page = await app.firstWindow();
    await page.locator('.update-banner').getByText(`PaperBridge for Windows ${laterVersion} is available`).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(cacheFile)).skippedTag, identity.tag);
    console.log('Verified update downloads, installer handoff, offline restart, per-version skipping and explicit rediscovery passed.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
