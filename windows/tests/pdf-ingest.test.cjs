const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importPdfAsset, independentPdfAsset, selectIndependentPdfAsset, sha256 } = require('../electron/pdf-ingest.cjs');
const { createStore } = require('../electron/storage.cjs');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-pdf-ingest-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test workspace');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const pdf = label => Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`);

test('ordinary import creates a missing asset and leaves an identical asset untouched', t => {
  const root = workspace(t);
  const pdfPath = id => path.join(root, 'pdfs', `${id}.pdf`);
  const source = pdf('source');
  const first = importPdfAsset(source, '../Selected Paper.pdf', pdfPath);
  assert.equal(first.id, sha256(source));
  assert.equal(first.fingerprint, first.id);
  assert.equal(first.name, 'Selected Paper.pdf');
  assert.deepEqual(fs.readFileSync(pdfPath(first.id)), source);

  let writes = 0;
  const trackingFs = Object.create(fs);
  trackingFs.writeFileSync = (...args) => { writes++; return fs.writeFileSync(...args); };
  const second = importPdfAsset(source, 'Selected Paper.pdf', pdfPath, { fileSystem: trackingFs });
  assert.equal(second.id, first.id);
  assert.equal(writes, 0, 'A matching immutable asset must not be rewritten');
});

test('ordinary same-hash import atomically repairs only a mismatched PDF asset', t => {
  const root = workspace(t);
  const source = pdf('correct original');
  const id = sha256(source);
  const destination = path.join(root, 'pdfs', `${id}.pdf`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, pdf('different stored PDF'));

  const imported = importPdfAsset(source, 'Original.pdf', value => {
    assert.equal(value, id);
    return destination;
  });
  assert.equal(imported.id, id);
  assert.deepEqual(fs.readFileSync(destination), source);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), [`${id}.pdf`]);
});

test('repairing an ordinary PDF asset leaves its existing workspace and library metadata byte-identical', t => {
  const root = workspace(t);
  const source = pdf('correct original with saved work');
  const id = sha256(source);
  const store = createStore(root);
  store.savePaper({ id, name: 'Original.pdf', type: 'pdf', createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ id: 1, text: 'Saved source', translation: 'Saved translation', status: 'ok' }] });
  store.updateLibraryMetadata({ id, title: 'Kept library label', tags: ['kept'] });
  fs.mkdirSync(path.dirname(store.pdfPath(id)), { recursive: true });
  fs.writeFileSync(store.pdfPath(id), pdf('wrong internal asset'));
  const paperFile = path.join(root, 'papers', `${id}.json`);
  const indexFile = path.join(root, 'library-index.json');
  const paperBefore = fs.readFileSync(paperFile);
  const indexBefore = fs.readFileSync(indexFile);

  importPdfAsset(source, 'Original.pdf', store.pdfPath);
  assert.deepEqual(fs.readFileSync(store.pdfPath(id)), source);
  assert.deepEqual(fs.readFileSync(paperFile), paperBefore);
  assert.deepEqual(fs.readFileSync(indexFile), indexBefore);
  assert.equal(store.paper(id).blocks[0].translation, 'Saved translation');
  assert.equal(store.paper(id).libraryTitle, 'Kept library label');
});

test('a failed atomic repair preserves the old asset and removes only its owned temporary file', t => {
  const root = workspace(t);
  const source = pdf('correct original');
  const id = sha256(source);
  const destination = path.join(root, 'pdfs', `${id}.pdf`);
  const previous = pdf('old but intact asset');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, previous);
  const failingFs = Object.create(fs);
  failingFs.renameSync = () => { const error = new Error('injected atomic rename failure'); error.code = 'EPERM'; throw error; };

  assert.throws(() => importPdfAsset(source, 'Original.pdf', () => destination,
    { fileSystem: failingFs, temporaryId: () => 'owned' }), /injected atomic rename failure/);
  assert.deepEqual(fs.readFileSync(destination), previous);
  assert.equal(fs.existsSync(`${destination}.${process.pid}.owned.tmp`), false);
});

test('an atomic temporary-name collision never deletes a file it did not create', t => {
  const root = workspace(t);
  const source = pdf('new source');
  const id = sha256(source);
  const destination = path.join(root, 'pdfs', `${id}.pdf`);
  const temporary = `${destination}.${process.pid}.collision.tmp`;
  const unrelated = Buffer.from('pre-existing unrelated temporary file');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, unrelated);

  assert.throws(() => importPdfAsset(source, 'Original.pdf', () => destination,
    { temporaryId: () => 'collision' }), error => error?.code === 'EEXIST');
  assert.deepEqual(fs.readFileSync(temporary), unrelated);
  assert.equal(fs.existsSync(destination), false);
});

test('independent extraction uses selected bytes, selected name, and a Mac-style independent ID', t => {
  const root = workspace(t);
  const source = pdf('new selected original');
  const fingerprint = sha256(source);
  const uuid = '11111111-2222-4333-8444-555555555555';
  const expectedId = sha256(`${fingerprint}${uuid}`);
  const pdfPath = id => path.join(root, 'pdfs', `${id}.pdf`);
  const imported = independentPdfAsset(source, 'Chosen Original.pdf', pdfPath, { randomUUID: () => uuid });

  assert.equal(imported.id, expectedId);
  assert.equal(imported.fingerprint, fingerprint);
  assert.equal(imported.name, 'Chosen Original.pdf (new extraction)');
  assert.equal(imported.existing, null);
  assert.deepEqual(fs.readFileSync(pdfPath(expectedId)), source);
});

test('native re-extraction cancellation returns null without reading or writing an asset', async () => {
  const owner = {};
  let options;
  let reads = 0;
  let destinations = 0;
  const fileSystem = Object.create(fs);
  fileSystem.readFileSync = () => { reads++; throw new Error('cancelled selection must not be read'); };
  const result = await selectIndependentPdfAsset({
    owner,
    showOpenDialog: async (actualOwner, actualOptions) => {
      assert.equal(actualOwner, owner); options = actualOptions;
      return { canceled: true, filePaths: [] };
    },
    pdfPath: () => { destinations++; throw new Error('cancelled selection must not allocate a destination'); },
    fileSystem
  });
  assert.equal(result, null);
  assert.equal(reads, 0);
  assert.equal(destinations, 0);
  assert.equal(options.title, 'Re-extract PDF as New Copy');
  assert.equal(options.buttonLabel, 'Extract New Copy');
  assert.deepEqual(options.properties, ['openFile']);
});

test('an invalid selected file cannot create an independent asset', async t => {
  const root = workspace(t);
  const selected = path.join(root, 'Not a PDF.txt');
  fs.writeFileSync(selected, 'not a PDF');
  const destination = path.join(root, 'pdfs');
  await assert.rejects(selectIndependentPdfAsset({
    owner: {}, showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }),
    pdfPath: id => path.join(destination, `${id}.pdf`)
  }), /not a valid PDF/);
  assert.equal(fs.existsSync(destination), false);
});
