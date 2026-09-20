const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('reference exclusion stops when methods resume after bibliography', async () => {
  const { referenceBlockIds, sectionRanges } = await import('../src/paper.mjs');
  const blocks = [
    { id: 1, text: 'Introduction', heading: true },
    { id: 2, text: 'The actual study body.' },
    { id: 3, text: 'References', heading: true },
    { id: 4, text: '[1] Example paper, 2024.' },
    { id: 5, text: 'STAR Methods', heading: true },
    { id: 6, text: 'Reproducible methods after references.' }
  ];
  assert.deepEqual([...referenceBlockIds(blocks)], [3, 4]);
  assert.deepEqual(sectionRanges(blocks).map(section => section.title), ['Introduction', 'References', 'STAR Methods']);
});

test('summary source links require an exact quote in a real source block', async () => {
  const { parseSummaryClaims, summarySourceCandidates } = await import('../src/paper.mjs');
  const passage = 'The measured intervention improved response time in the tested sample by twelve percent.';
  const blocks = [{ id: 7, text: passage }];
  const quote = 'improved response time in the tested sample';
  const output = JSON.stringify({ claims: [{ text: 'A supported claim', sources: [{ paragraphID: 7, quote }, { paragraphID: 99, quote }, { paragraphID: 7, quote: 'invented source quotation here' }] }] });
  const claims = parseSummaryClaims(output, blocks, null, `[P7]\n${passage}`);
  assert.deepEqual(claims[0].sources, [{ paragraphID: 7, quote }]);
  assert.deepEqual(parseSummaryClaims('Model wrote plain text [7].', blocks)[0].sources, []);
  assert.deepEqual(parseSummaryClaims(output, blocks, [], `[P7]\n${passage}`)[0].sources, []);
  assert.deepEqual(summarySourceCandidates(JSON.stringify({ claims: [{ text: 'A claim', sources: [{ paragraphID: 'P7' }, { paragraphID: 'P99' }] }] }), blocks), [[7]]);
  assert.deepEqual(summarySourceCandidates('unstructured summary', blocks), []);
});

test('portable bundle writes real image assets and the unchanged original PDF', () => {
  const { writeBundle } = require('../electron/bundle.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-bundle-'));
  const pdf = path.join(parent, 'source.pdf');
  const original = Buffer.from('%PDF-1.4\nsource bytes');
  fs.writeFileSync(pdf, original);
  try {
    const image = Buffer.from('image bytes');
    const data = `data:image/png;base64,${image.toString('base64')}`;
    const result = writeBundle(parent, { name: 'Test Paper.pdf', type: 'pdf' }, [
      { name: 'Original', content: `![plot](${data})` },
      { name: 'Bilingual', content: `![plot](${data})` }
    ], pdf);
    const digest = crypto.createHash('sha256').update(image).digest('hex');
    assert.equal(result.assets, 1);
    assert.equal(fs.readFileSync(path.join(result.folder, 'original.pdf')).compare(original), 0);
    assert.equal(fs.readFileSync(path.join(result.folder, 'assets', `${digest}.png`)).compare(image), 0);
    assert.match(fs.readFileSync(path.join(result.folder, 'Original.md'), 'utf8'), new RegExp(`assets/${digest}\\.png`));
  } finally {
    if (!path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test folder');
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('split and merge retain exact note and highlight anchors', async () => {
  const { splitBlockAt, mergeBlocks } = await import('../src/paper.mjs');
  const original = { id: 1, text: 'First sentence. Second sentence.', status: 'ok', translation: 'old', bookmark: true,
    highlights: [{ text: 'Second', offset: 16, color: 'amber' }],
    notes: [{ id: 'n', text: 'Second', offset: 16, kind: 'source', body: 'Keep this' }] };
  const [left, right] = splitBlockAt(original, 15);
  assert.equal(right.text, 'Second sentence.');
  assert.equal(right.highlights[0].offset, 0);
  assert.equal(right.notes[0].offset, 0);
  assert.equal(left.bookmark, true);
  const merged = mergeBlocks(left, right);
  assert.equal(merged.text, original.text);
  assert.equal(merged.highlights[0].offset, 16);
  assert.equal(merged.notes[0].offset, 16);
});

test('edited source preserves notes but invalidates ambiguous highlights and source links', async () => {
  const { editedBlock, revalidateSummaryClaims } = await import('../src/paper.mjs');
  const before = { id: 1, text: 'A unique phrase explains the result.', translation: 'old', status: 'ok',
    highlights: [{ text: 'unique phrase', offset: 2, color: 'amber' }],
    notes: [{ id: 'note', text: 'unique phrase', offset: 2, kind: 'source', body: 'Saved idea' }] };
  const changed = editedBlock(before, 'A different result appears here.');
  assert.deepEqual(changed.highlights, []);
  assert.equal(changed.notes[0].needsReview, true);
  assert.equal(changed.notes[0].body, 'Saved idea');
  assert.equal(changed.status, 'pending');
  const claims = [{ text: 'A claim', sources: [{ paragraphID: 1, quote: 'A unique phrase explains the result.' }] }];
  assert.deepEqual(revalidateSummaryClaims(claims, [changed])[0].sources, []);
});

test('sentence reflow keeps the annotated phrase in its new block', async () => {
  const { reflowBlock } = await import('../src/paper.mjs');
  const original = { id: 1, text: 'First complete sentence. Second complete sentence. Third complete sentence.',
    notes: [{ id: 'n', text: 'Third', offset: 51, kind: 'source', body: 'Remember this' }],
    highlights: [{ text: 'Third', offset: 51, color: 'blue' }] };
  const pieces = reflowBlock(original, 30);
  assert.equal(pieces.length, 3);
  assert.equal(pieces[2].text, 'Third complete sentence.');
  assert.equal(pieces[2].notes[0].offset, 0);
  assert.equal(pieces[2].highlights[0].offset, 0);
  assert.equal(reflowBlock({ text: 'One very long sentence without a safe boundary.' }, 10).length, 1);
});
