const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');
const { verifyAppArchive } = require('../scripts/verify-app-archive.cjs');

test('a packed reader must contain its expected version, entry points and intact assets', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-asar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'reader');
  fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(source, 'electron'));
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '1.2.3', main: 'electron/main.cjs' }));
  fs.writeFileSync(path.join(source, 'electron', 'main.cjs'), 'exports.name = "Reader";');
  fs.writeFileSync(path.join(source, 'electron', 'preload.cjs'), 'exports.ready = true;');
  const page = '<title>Calibration paper</title>';
  fs.writeFileSync(path.join(source, 'dist', 'index.html'), page);
  const archive = path.join(directory, 'app.asar');
  await asar.createPackage(source, archive);
  assert.equal(verifyAppArchive(archive, '1.2.3'), 4);
  assert.throws(() => verifyAppArchive(archive, '1.2.4'), /Unexpected reader version/);

  const packed = fs.readFileSync(archive);
  const position = packed.indexOf(page);
  assert.ok(position > 0);
  packed[position] = 0;
  fs.writeFileSync(archive, packed);
  assert.throws(() => verifyAppArchive(archive, '1.2.3'), /failed its ASAR integrity check: dist[\\/]index\.html/);
});

