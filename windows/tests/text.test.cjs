const test = require('node:test');
const assert = require('node:assert/strict');

test('paste text retains paragraphs and identifies sections', async () => {
  const { blocksFromText, readingMap } = await import('../src/text.mjs');
  const blocks = blocksFromText('Abstract\n\nThis is a source passage with enough content to appear in the reading map and link back to its block.\n\n1 Methods\n\nWe tested a careful procedure with a second long passage that has many words.');
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].heading, true);
  assert.equal(blocks[2].heading, true);
  assert.equal(readingMap(blocks)[0].blockId, 2);
});

test('PDF lines split at headings and preserve page provenance', async () => {
  const { blocksFromLines } = await import('../src/text.mjs');
  const blocks = blocksFromLines([{ text: 'Abstract', x: 0, y: 100, height: 12 }, { text: 'A paper about careful reading.', x: 0, y: 80, height: 12 }, { text: 'It compares passages.', x: 0, y: 68, height: 12 }], 3);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].text, 'A paper about careful reading. It compares passages.');
  assert.equal(blocks[1].page, 3);
});

test('long text is chunked without losing characters', async () => {
  const { chunkText } = await import('../src/text.mjs');
  const text = 'First sentence. Second sentence. Third sentence.';
  assert.equal(chunkText(text, 20).join(' ').replace(/\s+/g, ' ').trim(), text);
});
