const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, safeId } = require('../electron/storage.cjs');
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
