const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../electron/storage.cjs');
const { createUpdateChecker, selectWindowsRelease } = require('../electron/updates.cjs');

const day = 24 * 60 * 60 * 1000;
const initialTime = 1_800_000_000_000;
const identity = { tag: 'windows-v0.3.0', installerName: 'PaperBridge Setup 0.3.0.exe' };
const release = version => selectWindowsRelease([{ tag_name: identity.tag, draft: false, prerelease: false,
  assets: [{ name: identity.installerName, state: 'uploaded' }] }], version);
function memoryStore(record = {}) {
  let state = record;
  return { settings: () => ({ autoCheckUpdates: true }), updateCheckState: () => state,
    saveUpdateCheckState: value => { state = structuredClone(value); } };
}

test('a discovered update survives store/checker restart and is reevaluated after the app upgrades', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-update-cache-'));
  try {
    let version = '0.2.0';
    let calls = 0;
    const store = createStore(root);
    const first = createUpdateChecker({ store, currentVersion: () => version, now: () => initialTime,
      checkRelease: async value => { calls++; return release(value); } });
    assert.equal((await first(true)).status, 'available');
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'updates.json'), 'utf8'));
    assert.deepEqual(persisted, { cacheVersion: 1, lastCheckAt: initialTime, release: identity });
    const reopenedStore = createStore(root);
    const restarted = createUpdateChecker({ store: reopenedStore, currentVersion: () => version, now: () => initialTime + 1000,
      checkRelease: async () => { calls++; throw new Error('Network should not run during the daily interval'); } });
    const cached = await restarted(true);
    assert.equal(cached.status, 'available');
    assert.equal(cached.fromCache, true);
    assert.equal(cached.releaseUrl, 'https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.3.0');
    version = '0.3.0';
    assert.deepEqual(await restarted(true), { status: 'skipped', currentVersion: version });
    version = '0.4.0';
    assert.equal((await restarted(true)).status, 'skipped');
    assert.equal(calls, 1);
  } finally {
    if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected update cache fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cache URLs/status are ignored and release tag plus installer identity are validated', async () => {
  const record = { cacheVersion: 1, lastCheckAt: initialTime - 1000, release: { ...identity,
    releaseUrl: 'https://evil.example/download', status: 'current', currentVersion: '99.0.0' } };
  const checker = createUpdateChecker({ store: memoryStore(record), currentVersion: () => '0.2.0', now: () => initialTime,
    checkRelease: async () => { throw new Error('Unexpected network'); } });
  const result = await checker(true);
  assert.equal(result.status, 'available');
  assert.equal(result.currentVersion, '0.2.0');
  assert.equal(result.releaseUrl, 'https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.3.0');
  for (const badRelease of [{ ...identity, tag: 'v1.9' }, { ...identity, tag: ['windows-v0.3.0'] },
    { ...identity, tag: 'windows-v0.3.0/../../elsewhere' }, { ...identity, installerName: 'PaperBridge Setup 0.4.0.exe' },
    { tag: identity.tag }, { ...identity, installerName: 'https://evil.example/installer.exe' }]) {
    let calls = 0;
    const invalid = createUpdateChecker({ store: memoryStore({ ...record, release: badRelease }), currentVersion: () => '0.2.0', now: () => initialTime,
      checkRelease: async version => { calls++; return release(version); } });
    assert.equal((await invalid(true)).status, 'available');
    assert.equal(calls, 1, 'Invalid cached metadata must not suppress a real check');
  }
});

test('legacy, damaged and future-dated cache data do not suppress automatic checks', async () => {
  for (const record of [null, '{damaged', {}, { lastCheckAt: initialTime },
    { cacheVersion: 1, lastCheckAt: initialTime + day, release: identity },
    { cacheVersion: 1, lastCheckAt: '1800000000000', release: identity }]) {
    let calls = 0;
    const checker = createUpdateChecker({ store: memoryStore(record), currentVersion: () => '0.2.0', now: () => initialTime,
      checkRelease: async version => { calls++; return release(version); } });
    await checker(true);
    assert.equal(calls, 1);
  }
});

test('unpublished checks obey the same 24-hour interval even if the cache becomes unreadable', async () => {
  let time = initialTime;
  let calls = 0;
  const store = memoryStore();
  const checker = createUpdateChecker({ store, currentVersion: () => '0.2.0', now: () => time,
    checkRelease: async () => { calls++; return { status: 'unpublished', currentVersion: '0.2.0' }; } });
  assert.equal((await checker(true)).status, 'unpublished');
  assert.deepEqual(store.updateCheckState(), { cacheVersion: 1, lastCheckAt: initialTime, release: null });
  store.updateCheckState = () => { throw new Error('Cache cannot be read'); };
  time += day - 1;
  assert.equal((await checker(true)).status, 'skipped');
  assert.equal(calls, 1);
  time++;
  assert.equal((await checker(true)).status, 'unpublished');
  assert.equal(calls, 2, 'At exactly 24 hours a fresh network check must run');
});

test('expired cached update stays visible after automatic failure and retries without advancing its timestamp', async () => {
  let time = initialTime + day;
  let calls = 0;
  const store = memoryStore({ cacheVersion: 1, lastCheckAt: initialTime, release: identity });
  const checker = createUpdateChecker({ store, currentVersion: () => '0.2.0', now: () => time,
    checkRelease: async () => { calls++; throw new Error('Offline'); } });
  const failed = await checker(true);
  assert.equal(failed.status, 'available');
  assert.equal(failed.stale, true);
  assert.equal(store.updateCheckState().lastCheckAt, initialTime);
  time += 60 * 60 * 1000;
  await checker(true);
  assert.equal(calls, 2);
  await assert.rejects(checker(false), /Offline/, 'Manual check must still expose its network error');
  assert.equal(calls, 3);
});

test('failed first check does not start the interval, and cache write failure still returns a verified update', async () => {
  let calls = 0;
  const store = memoryStore();
  store.saveUpdateCheckState = () => { throw new Error('Disk full'); };
  const checker = createUpdateChecker({ store, currentVersion: () => '0.2.0', now: () => initialTime,
    checkRelease: async version => { if (++calls === 1) throw new Error('Offline'); return release(version); } });
  await assert.rejects(checker(true), /Offline/);
  assert.deepEqual(store.updateCheckState(), {});
  const result = await checker(true);
  assert.equal(result.status, 'available');
  assert.equal(result.cachePersisted, false);
  assert.equal((await checker(true)).fromCache, true);
  assert.equal(calls, 2, 'In-process verified cache still prevents repeated network calls after a disk failure');
});

test('disabled automatic checks remain disabled, manual checks refresh, and overlapping calls share one query', async () => {
  let resolveCheck;
  let calls = 0;
  const store = memoryStore();
  store.settings = () => ({ autoCheckUpdates: false });
  const checker = createUpdateChecker({ store, currentVersion: () => '0.2.0', now: () => initialTime,
    checkRelease: () => { calls++; return new Promise(resolve => { resolveCheck = resolve; }); } });
  assert.equal((await checker(true)).status, 'skipped');
  assert.equal(calls, 0);
  const first = checker(false);
  const second = checker(false);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveCheck(release('0.2.0'));
  assert.deepEqual(await first, await second);
  assert.equal((await checker(true)).status, 'skipped');
});

test('malformed live release data is never persisted as a successful check', async () => {
  const store = memoryStore();
  const checker = createUpdateChecker({ store, currentVersion: () => '0.2.0', now: () => initialTime,
    checkRelease: async () => ({ status: 'available', ...identity, latestVersion: '9.9.9' }) });
  await assert.rejects(checker(true), /Invalid Windows release information/);
  assert.deepEqual(store.updateCheckState(), {});
});
