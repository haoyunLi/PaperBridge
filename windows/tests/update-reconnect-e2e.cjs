const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'update-reconnect-'));
  const store = createStore(dir);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, autoDownloadUpdates: false });
  const stale = process.argv.includes('--stale');
  const live = process.argv.includes('--live');
  const duringCheck = process.argv.includes('--during-check');
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ executablePath: exe, cwd: root, args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, PAPERBRIDGE_WORKSPACE: dir, NODE_ENV: 'production' } });
  try {
    const page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    const version = await app.evaluate(({ app }) => app.getVersion());
    const parts = version.split('.').map(Number);
    const offered = parts[0] + '.' + (parts[1] + 1) + '.0';
    if (stale) {
      store.saveUpdateCheckState({ cacheVersion: 1, lastCheckAt: Date.now() - 2 * 86400000,
        release: { tag: 'windows-v' + offered, installerName: 'PaperBridge-Windows-' + offered + '-x64-Setup.exe' } });
    }
    await app.evaluate((_electron, { offered, live, duringCheck }) => {
      const original = global.fetch;
      global.probeNetwork = { offline: true, attempts: 0, successful: 0 };
      global.fetch = async (url, options) => {
        const target = String(url);
        if (!target.endsWith('/windows/latest-release.json') && !target.startsWith('https://api.github.com/repos/haoyunLi/PaperBridge/releases')) return original(url, options);
        const net = global.probeNetwork;
        net.attempts++;
        if (net.offline) {
          if (duringCheck && target.includes('api.github.com')) await new Promise(resolve => { global.finishOfflineCheck = resolve; });
          throw new TypeError('The network is offline');
        }
        if (live) {
          const response = await original(url, options);
          if (response.ok) net.successful++;
          return response;
        }
        if (target.endsWith('/windows/latest-release.json')) return new Response(null, { status: 404 });
        net.successful++;
        return Response.json([{ tag_name: 'windows-v' + offered, draft: false, prerelease: false,
          assets: [{name: 'PaperBridge-Windows-' + offered + '-x64-Setup.exe', state: 'uploaded'}] }]);
      };
    }, { offered, live, duringCheck });
    const net = page.context();
    await net.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    const preferences = page.locator('.settings-panel');
    const automatic = preferences.getByLabel(/Check official Windows releases/);
    await automatic.check();
    await app.evaluate(async () => {
      const stop = Date.now() + 8000;
      while (global.probeNetwork.attempts < 2 && Date.now() < stop) await new Promise(r => setTimeout(r, 30));
      if (global.probeNetwork.attempts < 2) throw new Error('Automatic update check did not try both official endpoints');
    });
    if (stale) {
      await preferences.getByRole('button', { name: 'View Windows ' + offered + ' release' }).waitFor();
      await preferences.getByText('Last found Windows ' + offered + ' on ', { exact: false }).waitFor();
      assert.equal(await page.locator('.update-banner strong').innerText(), 'Previously found PaperBridge for Windows ' + offered);
    } else if (!duringCheck) {
      await preferences.getByText('Could not check for Windows updates. PaperBridge will retry automatically.').waitFor();
    }
    await app.evaluate(() => { global.probeNetwork.offline = false; });
    await net.setOffline(false);
    await page.waitForFunction(() => navigator.onLine);
    if (duringCheck) await app.evaluate(() => global.finishOfflineCheck());
    await app.evaluate(async () => {
      const stop = Date.now() + 5500;
      while (global.probeNetwork.successful < 1 && Date.now() < stop) await new Promise(r => setTimeout(r, 30));
    });
    const counts = await app.evaluate(() => global.probeNetwork);
    console.log(JSON.stringify({ version, stale, live, duringCheck, counts }));
    assert.equal(counts.successful, 1, 'Automatically recheck the release after the network becomes available');
    await preferences.getByText(live ? /You have the latest published Windows version|Windows [\d.]+ is available\./
      : 'Windows ' + offered + ' is available.', { exact: true }).waitFor();
    const current = store.updateCheckState();
    assert.ok(Date.now() - current.lastCheckAt < 60000);
    await net.setOffline(true); await net.setOffline(false);
    await automatic.uncheck();
    await net.setOffline(true); await net.setOffline(false);
    await page.waitForTimeout(200);
    assert.equal(await app.evaluate(() => global.probeNetwork.attempts), counts.attempts, 'Fresh cache and disabled checks avoid repeated network requests');
    console.log(JSON.stringify({ savedTag: current.release?.tag, recoveredWithoutRestart: true, disabledRespected: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
