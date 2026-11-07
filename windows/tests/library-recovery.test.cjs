const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, bootstrapSnapshot } = require('../electron/storage.cjs');

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test workspace');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function paper(id, overrides = {}) {
  return { id, name: 'Original document.pdf', type: 'pdf', createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ id: 1, text: 'One', status: 'ok' }, { id: 2, text: 'Two', status: 'pending' }], ...overrides };
}

test('legacy papers seed the independent index and later workspace saves cannot roll back labels', t => {
  const root = workspace(t, 'paperbridge-library-seed-');
  const id = 'a'.repeat(64);
  const papers = path.join(root, 'papers');
  fs.mkdirSync(papers, { recursive: true });
  fs.writeFileSync(path.join(papers, `${id}.json`), JSON.stringify(paper(id, { libraryTitle: 'Legacy label', tags: ['legacy'] })));
  const store = createStore(root);
  assert.deepEqual(store.list().map(item => [item.name, item.workspaceAvailable]), [['Legacy label', true]]);
  assert.equal(fs.existsSync(path.join(root, 'library-index.json')), true);

  const bodyBeforeLabel = fs.readFileSync(path.join(papers, `${id}.json`), 'utf8');
  store.updateLibraryMetadata({ id, title: 'Authoritative label', tags: ['review', 'important'] });
  assert.equal(fs.readFileSync(path.join(papers, `${id}.json`), 'utf8'), bodyBeforeLabel, 'metadata edit must not rewrite source workspace');
  assert.equal(store.paper(id).name, 'Original document.pdf');
  assert.equal(store.paper(id).libraryTitle, 'Authoritative label');
  assert.deepEqual(store.paper(id).tags, ['review', 'important']);

  store.savePaper({ ...paper(id), libraryTitle: 'Late stale label', tags: ['stale'], blocks: [{ id: 1, status: 'pending' }] });
  const entry = store.list()[0];
  assert.equal(entry.name, 'Authoritative label');
  assert.deepEqual(entry.tags, ['review', 'important']);
  assert.equal(entry.blockCount, 1);
  assert.equal(entry.translatedCount, 0);
  assert.equal(store.paper(id).libraryTitle, 'Authoritative label');
});

test('unreadable workspaces retain indexed labels, support index-only edits, and recover on same-ID reimport', t => {
  const root = workspace(t, 'paperbridge-library-recovery-');
  const id = 'b'.repeat(64);
  const store = createStore(root);
  store.savePaper(paper(id));
  store.savePaper(paper(id, { blocks: [{ id: 1, status: 'ok' }] }));
  store.updateLibraryMetadata({ id, title: 'Needs reimport', tags: ['damaged'] });
  const primary = path.join(root, 'papers', `${id}.json`);
  const backup = `${primary}.backup`;
  fs.writeFileSync(primary, '{broken primary');
  fs.writeFileSync(backup, '{broken backup');
  const primaryBytes = fs.readFileSync(primary, 'utf8');
  const backupBytes = fs.readFileSync(backup, 'utf8');

  let entry = bootstrapSnapshot(createStore(root), 'test').library[0];
  assert.equal(entry.name, 'Needs reimport');
  assert.deepEqual(entry.tags, ['damaged']);
  assert.equal(entry.workspaceAvailable, false);
  assert.equal(createStore(root).paper(id), null);
  const updated = createStore(root).updateLibraryMetadata({ id, title: 'Reimport requested', tags: ['damaged', 'retry'] });
  assert.equal(updated[0].workspaceAvailable, false);
  assert.equal(fs.readFileSync(primary, 'utf8'), primaryBytes);
  assert.equal(fs.readFileSync(backup, 'utf8'), backupBytes);

  fs.unlinkSync(primary);
  fs.unlinkSync(backup);
  assert.equal(createStore(root).list()[0].workspaceAvailable, false);
  assert.equal(createStore(root).paper(id), null);

  createStore(root).savePaper(paper(id, { name: 'Reimported original.pdf', tags: [] }));
  entry = createStore(root).list()[0];
  assert.equal(entry.workspaceAvailable, true);
  assert.equal(entry.name, 'Reimport requested');
  assert.deepEqual(entry.tags, ['damaged', 'retry']);
  assert.equal(createStore(root).paper(id).name, 'Reimported original.pdf');
  assert.equal(createStore(root).paper(id).libraryTitle, 'Reimport requested');
});

test('a corrupt index primary uses its valid backup and clearData removes both without resurrection', t => {
  const root = workspace(t, 'paperbridge-library-index-backup-');
  const id = 'c'.repeat(64);
  const store = createStore(root);
  store.savePaper(paper(id));
  store.updateLibraryMetadata({ id, title: 'Backup label', tags: ['kept'] });
  const index = path.join(root, 'library-index.json');
  fs.copyFileSync(index, `${index}.backup`);
  fs.writeFileSync(index, '{broken index');
  assert.equal(createStore(root).list()[0].name, 'Backup label');
  createStore(root).clearData();
  assert.equal(fs.existsSync(index), false);
  assert.equal(fs.existsSync(`${index}.backup`), false);
  assert.deepEqual(createStore(root).list(), []);
});

test('explicit paper and metadata writes report index failures without pretending labels are durable', t => {
  const root = workspace(t, 'paperbridge-library-write-failure-');
  const id = 'd'.repeat(64);
  fs.mkdirSync(root, { recursive: true });
  const blockedIndex = path.join(root, 'library-index.json');
  fs.mkdirSync(blockedIndex);
  const store = createStore(root);
  assert.throws(() => store.savePaper(paper(id)), /EISDIR|EPERM|EEXIST/);
  assert.equal(store.paper(id).name, 'Original document.pdf', 'body write happens before the failed index write');
  fs.rmSync(blockedIndex, { recursive: true, force: true });
  const recovered = createStore(root).list();
  assert.equal(recovered[0].id, id);
  assert.equal(recovered[0].workspaceAvailable, true);

  const index = path.join(root, 'library-index.json');
  fs.copyFileSync(index, `${index}.backup`);
  fs.unlinkSync(index);
  fs.mkdirSync(index);
  assert.throws(() => store.updateLibraryMetadata({ id, title: 'Must not appear', tags: ['lost'] }), /EISDIR|EPERM|EEXIST/);
  fs.rmSync(index, { recursive: true, force: true });
  assert.equal(store.list()[0].name, 'Original document.pdf');
  assert.deepEqual(store.list()[0].tags, []);
});

test('invalid legacy JSON shapes and block collections fall back only to a valid matching backup', t => {
  const root = workspace(t, 'paperbridge-library-invalid-');
  const papers = path.join(root, 'papers');
  fs.mkdirSync(papers, { recursive: true });
  fs.writeFileSync(path.join(papers, `${'e'.repeat(64)}.json`), 'null');
  fs.writeFileSync(path.join(papers, `${'f'.repeat(64)}.json`), '[]');
  fs.writeFileSync(path.join(papers, `${'1'.repeat(64)}.json`), JSON.stringify({ id: '2'.repeat(64), name: 'Wrong ID' }));
  const recoverableId = '3'.repeat(64);
  const recoverablePath = path.join(papers, `${recoverableId}.json`);
  fs.writeFileSync(recoverablePath, JSON.stringify({ id: recoverableId, name: 'Broken primary', blocks: 'broken' }));
  fs.writeFileSync(`${recoverablePath}.backup`, JSON.stringify(paper(recoverableId, { name: 'Valid backup.pdf' })));
  const store = createStore(root);
  assert.deepEqual(store.list().map(item => item.id), [recoverableId]);
  assert.equal(store.paper(recoverableId).name, 'Valid backup.pdf');
});

test('invalid blocks cannot be opened or overwrite an existing workspace', t => {
  const root = workspace(t, 'paperbridge-library-invalid-blocks-');
  const id = '4'.repeat(64);
  const store = createStore(root);
  store.savePaper(paper(id));
  store.updateLibraryMetadata({ id, title: 'Keep label', tags: ['keep'] });
  store.markPaperOpened(id);
  const primary = path.join(root, 'papers', `${id}.json`);
  const index = path.join(root, 'library-index.json');
  const primaryBefore = fs.readFileSync(primary, 'utf8');
  const indexBefore = fs.readFileSync(index, 'utf8');

  assert.throws(() => store.savePaper({ ...paper(id), blocks: 'broken' }), /Invalid paper workspace/);
  assert.throws(() => store.savePaper({ ...paper(id), blocks: [null] }), /Invalid paper workspace/);
  assert.equal(fs.readFileSync(primary, 'utf8'), primaryBefore);
  assert.equal(fs.readFileSync(index, 'utf8'), indexBefore);

  fs.writeFileSync(primary, JSON.stringify({ id, name: 'Broken workspace', blocks: [null] }));
  const backup = `${primary}.backup`;
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  assert.equal(store.paper(id), null);
  assert.equal(store.list()[0].workspaceAvailable, false);
  assert.equal(store.lastPaperId(), null);
  assert.throws(() => store.markPaperOpened(id), /could not be loaded/);
});

test('read-time legacy index migration stays available and exposes a retryable persistence warning', t => {
  const root = workspace(t, 'paperbridge-library-read-warning-');
  const id = '5'.repeat(64);
  const papers = path.join(root, 'papers');
  fs.mkdirSync(papers, { recursive: true });
  fs.writeFileSync(path.join(papers, `${id}.json`), JSON.stringify(paper(id, { libraryTitle: 'Legacy label', tags: ['legacy'] })));
  const blockedIndex = path.join(root, 'library-index.json');
  fs.mkdirSync(blockedIndex);
  const store = createStore(root);

  const list = store.list();
  assert.equal(list[0].name, 'Legacy label');
  assert.equal(list[0].workspaceAvailable, true);
  assert.match(store.libraryPersistenceWarning(), /labels and metadata were not persisted.*retry/i);
  const snapshot = bootstrapSnapshot(store, 'test');
  assert.equal(snapshot.library[0].id, id);
  assert.match(snapshot.libraryPersistenceWarning, /labels and metadata were not persisted.*retry/i);

  fs.rmSync(blockedIndex, { recursive: true, force: true });
  assert.equal(store.list()[0].id, id);
  assert.equal(store.libraryPersistenceWarning(), '');
  assert.equal(fs.existsSync(blockedIndex), true);
});
