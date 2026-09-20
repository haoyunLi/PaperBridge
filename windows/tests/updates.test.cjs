const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, releaseUrl, selectWindowsRelease, checkWindowsRelease } = require('../electron/updates.cjs');

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
