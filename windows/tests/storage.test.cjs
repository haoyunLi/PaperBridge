const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { createStore, safeId, bootstrapSnapshot } = require('../electron/storage.cjs');
const { vendorOf } = require('../electron/hardware.cjs');

function temporaryWorkspace(t, prefix) {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith(prefix)) throw Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

async function withWindowsReadLock(filename, operation) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$handle = [IO.File]::Open($env:PAPERBRIDGE_TEST_LOCK_FILE, "Open", "Read", "Read")',
    'try { [Console]::WriteLine("locked"); [Console]::Out.Flush(); [void][Console]::ReadLine(); [Console]::WriteLine("releasing"); [Console]::Out.Flush(); [Threading.Thread]::Sleep(80) } finally { $handle.Dispose() }'
  ].join('\n');
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, env: { ...process.env, PAPERBRIDGE_TEST_LOCK_FILE: filename }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(locker, 'close');
  const output = createInterface({ input: locker.stdout });
  try {
    const [line] = await Promise.race([once(output, 'line'), closed.then(([code]) => { throw Error('Lock helper exited: ' + code); })]);
    assert.equal(line, 'locked');
    await operation(async () => {
      const releasing = once(output, 'line');
      locker.stdin.end('\n');
      assert.deepEqual(await releasing, ['releasing']);
    });
  } finally {
    if (!locker.stdin.writableEnded) locker.stdin.end('\n');
    assert.equal((await closed)[0], 0);
  }
}

test('a Windows sharing violation preserves the paper and a brief lock clears within one save', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const root = temporaryWorkspace(t, 'paperbridge-save-lock-');
  const store = createStore(root);
  const id = 'e'.repeat(64);
  const original = { id, name: 'Field notes', blocks: [], position: { paragraph: 3 }, notes: ['original'] };
  const edited = { ...original, position: { paragraph: 8 }, notes: ['edited'] };
  const primary = path.join(root, 'papers', id + '.json');
  store.savePaper(original);
  const before = fs.readFileSync(primary, 'utf8');
  await withWindowsReadLock(primary, async releaseSoon => {
    assert.throws(() => store.savePaper(edited), error => ['EPERM', 'EBUSY', 'EACCES'].includes(error.code));
    assert.equal(fs.readFileSync(primary, 'utf8'), before);
    await releaseSoon();
    store.savePaper(edited);
  });
  assert.deepEqual(createStore(root).paper(id).position, edited.position);
  assert.deepEqual(createStore(root).paper(id).notes, edited.notes);
  assert.equal(fs.readFileSync(primary + '.backup', 'utf8'), before);
});

test('workspace saves papers and can recover a damaged primary file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-test-'));
  try {
    const store = createStore(root);
    const id = 'a'.repeat(64);
    store.savePaper({ id, name: 'First', blocks: [], createdAt: '2026-01-01' });
    store.savePaper({ id, name: 'Second', blocks: [], createdAt: '2026-01-01' });
    assert.equal(store.list().length, 1);
    assert.equal(store.paper(id).name, 'Second');
    fs.writeFileSync(path.join(root, 'papers', `${id}.json`), '{broken');
    assert.equal(store.paper(id).name, 'First');
    assert.throws(() => safeId('../outside'));
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected temporary path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GPU vendor classification distinguishes AMD from CUDA-capable vendors', () => {
  assert.equal(vendorOf('NVIDIA GeForce RTX 4070'), 'NVIDIA');
  assert.equal(vendorOf('AMD Radeon RX 7800 XT'), 'AMD');
  assert.equal(vendorOf('Intel Arc'), 'Intel');
});

test('clearing saved work keeps original PDF copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-clear-'));
  try {
    const store = createStore(root);
    const id = 'b'.repeat(64);
    store.savePaper({ id, name: 'Saved work', blocks: [] });
    store.saveSettings({ translationModel: 'example' });
    store.saveUpdateCheckAt(1_700_000_000_000);
    assert.equal(store.lastUpdateCheckAt(), 1_700_000_000_000);
    store.saveGlossary([{ source: 'term', target: 'term' }]);
    fs.mkdirSync(path.join(root, 'pdfs'), { recursive: true });
    fs.writeFileSync(store.pdfPath(id), '%PDF-1.4\n');
    const interrupted = [
      'settings.json.123.tmp', 'glossary.json.backup.456.tmp', 'updates.json.123.tmp',
      'last-paper.json.backup.123.tmp', 'library-index.json.backup.123.tmp',
      path.join('papers', id + '.json.123.tmp'), path.join('papers', id + '.json.backup.456.tmp')
    ];
    const unrelated = ['settings.json.archive.123.tmp', 'private.json.123.tmp', path.join('papers', 'notes.123.tmp')];
    const extracted = [path.join('mineru-results', 'f'.repeat(16), 'images', 'figure.png'),
      path.join('mineru', id, 'auto', 'original.md')];
    const retained = [path.join('mineru', 'manual', 'document.md'), path.join('tools', 'mineru', 'runtime.txt')];
    for (const name of [...extracted, ...retained]) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), 'saved content');
    }
    const outside = path.dirname(path.join(root, retained[1]));
    fs.symlinkSync(outside, path.join(root, 'mineru-results', 'e'.repeat(16)), 'junction');
    fs.symlinkSync(outside, path.join(root, 'mineru-results', 'f'.repeat(16), 'linked-runtime'), 'junction');
    for (const name of [...interrupted, ...unrelated]) fs.writeFileSync(path.join(root, name), 'test data');
    store.clearData();
    for (const name of retained) assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'saved content');
    for (const name of [...extracted, ...interrupted]) assert.equal(fs.existsSync(path.join(root, name)), false, name);
    for (const name of unrelated) assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'test data', name);
    assert.equal(store.paper(id), null);
    assert.deepEqual(store.glossary(), []);
    assert.equal(store.settings().translationModel, 'translategemma:4b');
    assert.equal(store.settings().autoCheckUpdates, true);
    assert.equal(store.lastUpdateCheckAt(), 0);
    assert.equal(fs.existsSync(store.pdfPath(id)), true);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected temporary path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearing archived PDFs removes only managed copies and interrupted imports when explicitly requested', t => {
  const base = temporaryWorkspace(t, 'paperbridge-archived-copies-');
  const store = createStore(path.join(base, 'workspace'));
  const id = 'c'.repeat(64);
  const archived = store.pdfPath(id);
  const directory = path.dirname(archived);
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(base, 'Original research.pdf');
  fs.writeFileSync(source, '%PDF-1.4\nSource bytes');
  fs.copyFileSync(source, archived);
  const interrupted = archived + '.123.3c7532e2-e7d5-4d67-a2d1-4e75554a1088.tmp';
  const unrelated = path.join(directory, 'My PDF.pdf');
  const backup = archived + '.personal-backup';
  const nested = path.join(directory, 'shared');
  fs.mkdirSync(nested);
  for (const file of [interrupted, unrelated, backup, path.join(nested, id + '.pdf')]) fs.writeFileSync(file, 'retained');
  assert.equal(store.clearData('true').archivedPdfsRemoved, 0);
  assert.ok(fs.existsSync(archived));
  assert.deepEqual(store.clearData(true), { archivedPdfsRemoved: 1 });
  assert.ok(!fs.existsSync(archived) && !fs.existsSync(interrupted));
  assert.equal(fs.readFileSync(source, 'utf8'), '%PDF-1.4\nSource bytes');
  for (const file of [unrelated, backup, path.join(nested, id + '.pdf')]) assert.equal(fs.readFileSync(file, 'utf8'), 'retained');
  assert.deepEqual(store.clearData(true), { archivedPdfsRemoved: 0 });
});

test('a locked archived PDF leaves the reset workspace usable and can be removed on retry', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const root = temporaryWorkspace(t, 'paperbridge-clear-locked-pdf-');
  const store = createStore(root), id = 'd'.repeat(64), archived = store.pdfPath(id);
  store.savePaper({ id, name: 'Notebook', blocks: [] });
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.writeFileSync(archived, '%PDF-1.4');
  await withWindowsReadLock(archived, () => {
    const result = store.clearData(true);
    assert.equal(result.archivedPdfsRemoved, 0);
    assert.ok(result.pdfCleanupError);
    assert.deepEqual(createStore(root).list(), []);
    assert.equal(fs.readFileSync(archived, 'utf8'), '%PDF-1.4');
  });
  assert.deepEqual(store.clearData(true), { archivedPdfsRemoved: 1 });
  assert.equal(fs.existsSync(archived), false);
});

test('library orders opens independently of edits and retains paper metadata across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-last-opened-'));
  try {
    const store = createStore(root);
    const olderId = 'c'.repeat(64);
    const newerId = 'd'.repeat(64);
    store.savePaper({ id: olderId, name: 'Original title', libraryTitle: 'Opened without editing', blocks: [{ status: 'ok' }, { status: 'pending' }] });
    await new Promise(resolve => setTimeout(resolve, 10));
    store.savePaper({ id: newerId, name: 'Edited later', blocks: [] });
    store.markPaperOpened(newerId);
    const opened = store.markPaperOpened(olderId);
    store.savePaper({ ...store.paper(newerId), name: 'Edited after both opens' });
    const restarted = bootstrapSnapshot(createStore(root), '0.2.0');
    assert.deepEqual(restarted.library.map(item => item.id), [olderId, newerId]);
    assert.equal(restarted.library[0].name, 'Opened without editing');
    assert.equal(restarted.library[0].lastOpened, opened.lastOpened);
    assert.equal(restarted.library[0].translatedCount, 1);
    assert.equal(store.paper(olderId).name, 'Original title');
    assert.equal(restarted.lastPaperId, olderId);
    assert.equal(restarted.version, '0.2.0');
    assert.throws(() => store.markPaperOpened('e'.repeat(64)), /could not be loaded/);
    assert.throws(() => store.markPaperOpened('../outside'), /Invalid paper ID/);
    store.clearData();
    assert.equal(bootstrapSnapshot(createStore(root), '0.2.0').lastPaperId, null);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected temporary path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
