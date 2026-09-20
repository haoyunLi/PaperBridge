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

test('repeated PDF running heads and page footers leave the first header and all body text', async () => {
  const { filterRepeatedPageDecorations } = await import('../src/pdfDecorations.mjs');
  const pages = [1, 2, 3].map(number => ({ width: 600, height: 800, lines: [
    { text: 'Journal of Reading 2026', y: 770, height: 12 },
    { text: `Unique body paragraph ${number}`, y: 390, height: 12 },
    { text: `Page ${number}`, y: 30, height: 12 }
  ] }));
  const result = filterRepeatedPageDecorations(pages);
  assert.deepEqual(result.map(page => page.lines.map(line => line.text)), [
    ['Journal of Reading 2026', 'Unique body paragraph 1'],
    ['Unique body paragraph 2'],
    ['Unique body paragraph 3']
  ]);
});

test('PDF page stitching repairs an interrupted word but keeps complete sentences separate', async () => {
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const blocks = stitchPageBlocks([
    { id: 1, page: 1, text: 'The paper describes a reproducible metho-' },
    { id: 2, page: 2, text: 'dology for this experiment.' },
    { id: 3, page: 2, text: 'Results end here.' },
    { id: 4, page: 3, text: 'A new section starts.' }
  ]);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, 'The paper describes a reproducible methodology for this experiment.');
  assert.equal(blocks[0].endPage, 2);
  assert.equal(blocks[1].text, 'Results end here.');
});
