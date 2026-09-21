const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, safeId, bootstrapSnapshot } = require('../electron/storage.cjs');
const { vendorOf } = require('../electron/hardware.cjs');

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
    store.clearData();
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

test('bootstrap remembers the last opened paper even when another paper was edited more recently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-last-opened-'));
  try {
    const store = createStore(root);
    const olderId = 'c'.repeat(64);
    const newerId = 'd'.repeat(64);
    store.savePaper({ id: olderId, name: 'Opened without editing', blocks: [] });
    await new Promise(resolve => setTimeout(resolve, 10));
    store.savePaper({ id: newerId, name: 'Edited later', blocks: [] });
    store.markPaperOpened(olderId);
    const restarted = bootstrapSnapshot(createStore(root), '0.2.0');
    assert.equal(restarted.library[0].id, newerId);
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
