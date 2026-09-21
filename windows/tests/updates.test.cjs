const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, releaseUrl, selectWindowsRelease, checkWindowsRelease, createUpdateChecker } = require('../electron/updates.cjs');

const release = (tag, options = {}) => ({ tag_name: tag, draft: false, prerelease: false,
  assets: [{ name: `PaperBridge Setup ${tag.replace('windows-v', '')}.exe`, state: 'uploaded' }], ...options });

test('Windows update check ignores macOS, drafts, prereleases, and incomplete assets', () => {
  const releases = [release('v1.9'), release('windows-v0.5.0', { draft: true }),
    release('windows-v0.4.0', { prerelease: true }), release('windows-v0.3.0', { assets: [] }),
    release('windows-v0.2.1'), release('windows-v0.2.0')];
  const result = selectWindowsRelease(releases, '0.2.0');
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.2.1');
  assert.equal(result.releaseUrl, 'https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.1');
  assert.equal(selectWindowsRelease(releases, '0.2.1').status, 'current');
  assert.equal(selectWindowsRelease([release('v1.9')], '0.2.0').status, 'unpublished');
});

test('update URL and version comparison accept only Windows release tags', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.throws(() => releaseUrl('v1.9'));
  assert.throws(() => releaseUrl('windows-v0.3.0/../../other'));
});

test('release fetch uses the official GitHub API and reports errors', async () => {
  const result = await checkWindowsRelease('0.2.0', async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.match(options.headers['User-Agent'], /PaperBridge-Windows/);
    return { ok: true, json: async () => [release('windows-v0.3.0')] };
  });
  assert.equal(result.status, 'available');
  await assert.rejects(checkWindowsRelease('0.2.0', async () => ({ ok: false, status: 403 })), /GitHub 403/);
});

test('failed automatic update check is retried and only a successful check starts the daily interval', async () => {
  let time = 1_000_000_000;
  let lastCheckAt = 0;
  let calls = 0;
  const store = {
    settings: () => ({ autoCheckUpdates: true }),
    lastUpdateCheckAt: () => lastCheckAt,
    saveUpdateCheckAt: value => { lastCheckAt = value; }
  };
  const checkUpdates = createUpdateChecker({
    store,
    currentVersion: () => '0.2.0',
    now: () => time,
    checkRelease: async () => {
      calls++;
      if (calls === 1) throw new Error('Offline');
      return selectWindowsRelease([release('windows-v0.3.0')], '0.2.0');
    }
  });

  await assert.rejects(checkUpdates(true), /Offline/);
  assert.equal(lastCheckAt, 0);
  time += 60 * 60 * 1000;
  const result = await checkUpdates(true);
  assert.equal(result.status, 'available');
  assert.equal(result.latestVersion, '0.3.0');
  assert.equal(lastCheckAt, time);
  time += 60 * 60 * 1000;
  assert.equal((await checkUpdates(true)).status, 'skipped');
  assert.equal(calls, 2);
});
