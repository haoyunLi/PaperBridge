const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { writeBundleFacsimile } = require('../electron/bundle.cjs');
const { withWindowsReadLock } = require('./windows-read-lock.cjs');

for (const temporary of [true, false]) {
  test(temporary ? 'a briefly locked Windows edition finishes with one copy of each page index'
    : 'a persistently locked Windows edition keeps its original Markdown', { skip: process.platform !== 'win32' }, async t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-index-lock-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 4 }));
    const editions = [
      { name: 'paper_original.md', heading: 'Original' },
      { name: 'paper_bilingual.md', heading: 'Bilingual' }
    ];
    const original = 'A measurement at 532 nm.\n';
    for (const edition of editions) fs.writeFileSync(path.join(folder, edition.name), original);
    const locked = path.join(folder, editions[1].name);
    await withWindowsReadLock(locked, async release => {
      const write = writeBundleFacsimile({ folder, facsimileDocuments: editions, renderedPages: new Set([1]) }, 1, false);
      if (temporary) await Promise.all([write, delay(160).then(release)]);
      else await assert.rejects(write, error => ['EPERM', 'EBUSY', 'EACCES'].includes(error.code));
    });
    for (const edition of editions) {
      const file = path.join(folder, edition.name);
      const text = fs.readFileSync(file, 'utf8');
      if (file === locked && !temporary) assert.equal(text, original);
      else {
        assert.equal(text.split('# Original PDF facsimile').length - 1, 1);
        assert.equal(text.split('A measurement at 532 nm.').length - 1, 1);
        assert.match(text, /pages\/page-001\.png/);
      }
    }
    assert.deepEqual(fs.readdirSync(folder).sort(), ['Original Pages.md', ...editions.map(edition => edition.name)].sort());
  });
}
