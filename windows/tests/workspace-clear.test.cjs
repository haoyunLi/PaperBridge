const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createStore } = require('../electron/storage.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-interrupted-clear-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createStore(root), id = 'a'.repeat(64);
  store.savePaper({ id, name: 'Retained experiment', blocks: [{ id: 1, text: '532 nm', bookmark: true }] });
  store.saveGlossary([{ source: 'peak', target: '峰' }]);
  const pdf = store.pdfPath(id);
  fs.mkdirSync(path.dirname(pdf), { recursive: true }); fs.writeFileSync(pdf, 'archived original');
  const image = path.join(root, 'mineru-results', 'b'.repeat(16), 'panel.png');
  fs.mkdirSync(path.dirname(image), { recursive: true }); fs.writeFileSync(image, 'retained panel');
  return { root, id, pdf, image };
}

function interrupt(root, when) {
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs'), path = require('node:path');
    const [root, when, moduleName] = process.argv.slice(1);
    const store = require(moduleName).createStore(root);
    const rename = fs.renameSync, write = fs.writeFileSync;
    fs.renameSync = function(from, to) {
      const result = rename.apply(this, arguments);
      if (when === 'stage' && path.basename(to) === '1' && path.basename(path.dirname(to)).startsWith('.paperbridge-clear-')) process.exit(71);
      return result;
    };
    fs.writeFileSync = function(file) {
      const result = write.apply(this, arguments);
      if (when === 'commit' && typeof file === 'string' && path.basename(file) === 'committed') process.exit(71);
      return result;
    };
    store.clearData();
  `, root, when, require.resolve('../electron/storage.cjs')], { windowsHide: true, encoding: 'utf8' });
  assert.equal(child.status, 71, child.stderr);
}

test('a process exit during staging restores the same paper, glossary, source copy and figure', t => {
  const { root, id, pdf, image } = fixture(t);
  const file = path.join(root, 'papers', id + '.json');
  const previous = fs.readFileSync(file);
  interrupt(root, 'stage');
  assert.equal(fs.existsSync(file), false);
  const reopened = createStore(root);
  assert.deepEqual(fs.readFileSync(file), previous);
  assert.ok(reopened.paper(id).blocks[0].bookmark);
  assert.equal(reopened.glossary()[0].target, '峰');
  assert.equal(fs.readFileSync(pdf, 'utf8'), 'archived original');
  assert.equal(fs.readFileSync(image, 'utf8'), 'retained panel');
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.paperbridge-clear-')), false);
});

test('restarting after the commit purges only staged records and keeps newly created files', t => {
  const { root, id, pdf, image } = fixture(t);
  interrupt(root, 'commit');
  fs.mkdirSync(path.dirname(image), { recursive: true }); fs.writeFileSync(image, 'new panel');
  const reopened = createStore(root);
  assert.equal(reopened.paper(id), null);
  assert.deepEqual(reopened.glossary(), []);
  assert.equal(fs.readFileSync(image, 'utf8'), 'new panel');
  assert.equal(fs.readFileSync(pdf, 'utf8'), 'archived original');
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.paperbridge-clear-')), false);
});

test('staged originals never replace documents created after an interruption', t => {
  const { root, id } = fixture(t);
  interrupt(root, 'stage');
  const file = path.join(root, 'papers', id + '.json');
  fs.writeFileSync(file, 'newer document');
  const reopened = createStore(root);
  assert.match(reopened.libraryPersistenceWarning(), /interrupted data removal/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'newer document');
  const folder = fs.readdirSync(root).find(name => name.startsWith('.paperbridge-clear-'));
  const entries = JSON.parse(fs.readFileSync(path.join(root, folder, 'records.json')));
  const slot = entries.indexOf('papers/' + id + '.json');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, folder, String(slot)))).blocks[0].bookmark, true);
});
