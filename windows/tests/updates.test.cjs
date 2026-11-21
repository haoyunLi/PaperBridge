const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, releaseUrl, updateDownload, selectWindowsRelease, checkWindowsRelease, createUpdateChecker } = require('../electron/updates.cjs');

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

test('Windows update check recognizes the public setup filename and ignores other release assets', () => {
  const installer = 'PaperBridge-Windows-0.2.0-x64-Setup.exe';
  const assets = [
    { name: 'PaperBridge-Windows-0.2.0-x64-Portable.exe', state: 'uploaded' },
    { name: `${installer}.sha256`, state: 'uploaded' },
    { name: 'PaperBridge-Windows-0.2.0-arm64-Setup.exe', state: 'uploaded' },
    { name: installer, state: 'starter' }
  ];
  assert.equal(selectWindowsRelease([release('windows-v0.2.0', { assets })], '0.1.0').status, 'unpublished');
  assets.push({ name: installer, state: 'uploaded' });
  const versions = [release('v1.10.0'), release('windows-v0.2.0', { assets })];
  assert.equal(selectWindowsRelease(versions, '0.1.0').installerName, installer);
  assert.equal(selectWindowsRelease(versions, '0.2.0').status, 'current');
});

test('download targets match the uploaded edition and official version even for historical installers', () => {
  const version = '0.3.0';
  const tag = 'windows-v' + version;
  const setup = 'PaperBridge Setup 0.3.0.exe';
  const portable = 'PaperBridge-Windows-0.3.0-x64-Portable.exe';
  const assets = [{ name: setup, state: 'uploaded', browser_download_url: 'https://example.org/other' },
    { name: portable, state: 'starter' }];
  const check = current => selectWindowsRelease([release(tag, { assets })], current);
  const base = 'https://github.com/haoyunLi/PaperBridge/releases/download/' + tag + '/';
  assert.equal(updateDownload(check('0.2.0'), false).url, base + encodeURIComponent(setup));
  assert.equal(updateDownload(check('0.2.0'), true), null);
  assets[1].state = 'uploaded';
  assert.equal(updateDownload(check('0.2.0'), true).url, base + portable);
  assert.equal(updateDownload(check(version), false), null);
  assert.equal(updateDownload({ ...check('0.2.0'), portableName: '../another.exe' }, true), null);
  assert.equal(updateDownload({ ...check('0.2.0'), installerName: 'unrelated.exe' }, false), null);
});

test('update URL and version comparison accept only Windows release tags', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.throws(() => releaseUrl('v1.9'));
  assert.throws(() => releaseUrl('windows-v0.3.0/../../other'));
});

const feedUrl = 'https://raw.githubusercontent.com/haoyunLi/PaperBridge/windows/desktop-app/windows/latest-release.json';
const feed = { version: '0.3.0', files: {
  Setup: { size: 103, sha256: 'a'.repeat(64) }, Portable: { size: 94, sha256: 'b'.repeat(64) }
} };

test('public release feed discovers both verified editions without calling the rate-limited API', async () => {
  const calls = [];
  const fetchFeed = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    return Response.json({ ...feed, url: 'https://example.org/ignored' });
  };
  const result = await checkWindowsRelease('0.2.0', fetchFeed);
  assert.deepEqual(calls, [feedUrl]);
  assert.equal(result.status, 'available');
  for (const kind of ['Setup', 'Portable']) {
    const file = 'PaperBridge-Windows-0.3.0-x64-' + kind + '.exe';
    const download = updateDownload(result, kind === 'Portable');
    assert.equal(download.url, 'https://github.com/haoyunLi/PaperBridge/releases/download/windows-v0.3.0/' + file);
    assert.deepEqual(download.file, { name: file, ...feed.files[kind] });
  }
  assert.equal((await checkWindowsRelease('0.3.0', fetchFeed)).status, 'current');
});

test('unavailable or malformed feeds fall back to the official release API', async () => {
  for (const bad of [new Error('offline'), null, { version: '../escape', files: feed.files },
    { ...feed, files: { Setup: feed.files.Setup } }, { ...feed, files: { ...feed.files, Portable: { size: -1, sha256: 'x' } } }]) {
    const calls = [];
    const result = await checkWindowsRelease('0.2.0', async url => {
      calls.push(url);
      if (url !== feedUrl) return Response.json([release('windows-v0.3.1')]);
      if (bad instanceof Error) throw bad;
      return Response.json(bad);
    });
    assert.deepEqual(calls, [feedUrl, 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100']);
    assert.equal(result.latestVersion, '0.3.1');
  }
});

test('release check uses the API when raw content is blocked and reports failures of both sources', async () => {
  const result = await checkWindowsRelease('0.2.0', async (url, options) => {
    if (url === feedUrl) return new Response(null, { status: 404 });
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
  let cachedState = {};
  let calls = 0;
  const store = {
    settings: () => ({ autoCheckUpdates: true }),
    updateCheckState: () => cachedState,
    saveUpdateCheckState: value => { cachedState = value; lastCheckAt = value.lastCheckAt; }
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
  assert.equal((await checkUpdates(true)).status, 'available');
  assert.equal(calls, 2);
});
