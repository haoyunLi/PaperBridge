const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { selectWindowsRelease, updateDownload, createUpdateChecker } = require('../electron/updates.cjs');
const { UpdateDownload } = require('../electron/update-download.cjs');

const version = '0.3.0';
const tag = 'windows-v' + version;
const payload = Buffer.from('test release data');
const digest = createHash('sha256').update(payload).digest('hex');
function asset(kind) {
  const name = 'PaperBridge-Windows-' + version + '-x64-' + kind + '.exe';
  return { name, state: 'uploaded', size: payload.length, digest: 'sha256:' + digest,
    browser_download_url: 'https://github.com/haoyunLi/PaperBridge/releases/download/' + tag + '/' + name };
}
const setup = asset('Setup'), portable = asset('Portable');
const select = (...assets) => selectWindowsRelease([{ tag_name: tag, assets }], '0.2.29');
const next = updateDownload(select(setup, portable), true);

test('only the matching official edition contributes a usable digest to the daily cache', async () => {
  let record;
  const store = { settings: () => ({ autoCheckUpdates: true }), updateCheckState: () => record, saveUpdateCheckState: value => { record = value; } };
  const checker = () => createUpdateChecker({ store, currentVersion: () => '0.2.29', checkRelease: async () => select(setup, portable) });
  assert.deepEqual(updateDownload(await checker()(false), true), next);
  const cached = await checker()(true);
  assert.equal(cached.fromCache, true);
  assert.deepEqual(updateDownload(cached, false).file, { name: setup.name, sha256: digest, size: payload.length });
  for (const invalid of [{ digest: null }, { digest: 'md5:' + digest }, { size: 0 }, { size: '16' }, { browser_download_url: portable.browser_download_url }]) {
    const result = select({ ...setup, ...invalid }, portable);
    assert.equal(updateDownload(result, false).file, undefined);
    assert.equal(updateDownload(result, true).file.sha256, digest);
  }
});

async function fixture(t, transfer, verifyProvenance = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbridge-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const changes = [], shown = [];
  const create = () => new UpdateDownload({ directory, transfer, verifyProvenance, notify: value => changes.push(value), reveal: file => shown.push(file) });
  return { directory, changes, shown, create };
}

test('prepare is shared, verifies before publication and reuses the exact file after restart', async t => {
  let calls = 0;
  const { directory, changes, shown, create } = await fixture(t, async (download, file, signal, progress) => {
    calls++; progress(5); assert.equal(download.file.name, portable.name);
    if (calls === 1) assert.ok(!(await fs.readdir(directory)).includes(portable.name));
    await fs.writeFile(file, payload);
  });
  const manager = create();
  await Promise.all([manager.prepare(next), manager.prepare(next)]);
  assert.equal(calls, 1);
  assert.ok(changes.some(state => state.phase === 'downloading' && state.percent > 0));
  const restarted = create();
  await restarted.prepare(next);
  await restarted.show(tag);
  assert.equal(calls, 1);
  assert.deepEqual(shown, [path.join(directory, portable.name)]);
  await assert.rejects(restarted.show('windows-v0.1.0'), /No verified/);
  await fs.writeFile(shown[0], Buffer.alloc(payload.length));
  await assert.rejects(restarted.show(tag), /no longer matches/);
  assert.equal(restarted.state.phase, 'failed');
  await restarted.prepare(next);
  assert.equal(calls, 2);
  assert.equal(restarted.state.phase, 'ready');
  assert.deepEqual(await fs.readFile(shown[0]), payload);
});

test('missing metadata, a bad hash or length, and cancellation never publish an executable', async t => {
  let body = Buffer.alloc(payload.length);
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const { directory, create } = await fixture(t, async (download, file, signal) => {
    if (body) return fs.writeFile(file, body);
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const manager = create();
  const missing = updateDownload(select({ ...setup, digest: null }), false);
  await manager.prepare(missing);
  assert.equal(manager.state.phase, 'unverified');
  for (const bytes of [Buffer.alloc(payload.length), Buffer.from('short')]) {
    body = bytes;
    await manager.prepare(next);
    assert.equal(manager.state.phase, 'failed');
    assert.deepEqual(await fs.readdir(directory), []);
  }
  body = null;
  const canceled = manager.prepare(next);
  await begun;
  manager.cancel();
  await canceled;
  assert.equal(manager.state.phase, 'idle');
  assert.deepEqual(await fs.readdir(directory), []);
});

test('a matching hash without an authentic build proof cannot be offered, even after restart', async t => {
  let valid = false, verifications = 0;
  const { directory, create } = await fixture(t, async (_download, file) => fs.writeFile(file, payload), async () => {
    verifications++;
    if (!valid) throw new Error('Build proof failed.');
  });
  const manager = create();
  await manager.prepare(next);
  assert.equal(manager.state.phase, 'failed');
  assert.deepEqual(await fs.readdir(directory), []);
  valid = true;
  await manager.prepare(next);
  assert.equal(manager.state.phase, 'ready');
  valid = false;
  const restarted = create();
  await restarted.prepare(next);
  assert.equal(restarted.state.phase, 'failed');
  await assert.rejects(restarted.show(tag), /No verified/);
  assert.equal(verifications, 3);
});

test('an explicit Setup action rechecks the file and shares one Windows handoff while it is opening', async t => {
  const { directory, create } = await fixture(t, async (_download, filename) => fs.writeFile(filename, payload));
  const files = create(), installer = updateDownload(select(setup, portable), false);
  await files.prepare(installer, { manual: true });
  assert.equal(files.manual, true);
  await files.prepare(installer);
  assert.equal(files.manual, true);
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { release = resolve; });
  const paths = [];
  const open = filename => { paths.push(filename); started(); return result; };
  const first = files.openInstaller(tag, open), repeated = files.openInstaller(tag, open);
  await waiting;
  assert.deepEqual(paths, [path.join(directory, setup.name)]);
  release('');
  await Promise.all([first, repeated]);
  await assert.rejects(files.openInstaller(tag, async () => 'Windows did not open the installer'), /Windows did not open/);
  await fs.writeFile(paths[0], Buffer.alloc(payload.length));
  await assert.rejects(files.openInstaller(tag, open), /no longer matches/);
  await files.prepare(next);
  assert.equal(files.manual, false);
  await assert.rejects(files.openInstaller(tag, open), /Setup update is required/);
  assert.equal(paths.length, 1);
});

test('startup cleanup preserves current and running releases as well as unrelated files', async t => {
  const { directory, create } = await fixture(t, () => {});
  const names = ['PaperBridge-Windows-0.2.1-x64-Portable.exe', 'PaperBridge-Windows-0.2.5-x64-Setup.exe', 'PaperBridge-Windows-0.2.29-x64-Portable.exe', 'personal.exe'];
  await Promise.all(names.map(name => fs.writeFile(path.join(directory, name), payload)));
  await fs.mkdir(path.join(directory, '.partial-a123BC'));
  await create().clean('0.2.29', path.join(directory, names[0]));
  assert.deepEqual((await fs.readdir(directory)).sort(), [names[0], names[2], names[3]].sort());
});
