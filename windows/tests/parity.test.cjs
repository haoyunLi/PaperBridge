const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('MinerU Markdown keeps figures and tables separate from translatable captions', async () => {
  const { parsedMarkdownBlocks, anchorText } = await import('../src/academicMarkdown.mjs');
  const markdown = [
    '# Results',
    '',
    'Ashish Vaswani<sup>∗</sup> measured the result.',
    '',
    '![plot](data:image/png;base64,AAAA)  ',
    'Figure 1: Architecture.',
    '',
    'Table 1: Scores.',
    '<table><tr><td>42</td></tr></table>',
    '',
    '$$E=mc^2$$',
    '',
    '```python',
    'print(42)',
    '```'
  ].join('\n');
  const blocks = parsedMarkdownBlocks(markdown);
  assert.deepEqual(blocks.map(block => [block.heading, block.resource]), [
    [true, false], [false, false], [false, true], [false, false],
    [false, false], [false, true], [false, true], [false, true]
  ]);
  assert.equal(blocks[3].text, 'Figure 1: Architecture.');
  assert.equal(blocks[4].text, 'Table 1: Scores.');
  assert.equal(anchorText(blocks[1], 'source'), 'Ashish Vaswani∗ measured the result.');
});

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

test('translation range counts exactly the unfinished queue including headings', async () => {
  const { referenceBlockIds, translationRangeIds } = await import('../src/paper.mjs');
  const blocks = [
    { id: 1, text: 'Abstract', heading: true, status: 'pending' },
    { id: 2, text: 'Body', status: 'ok' },
    { id: 3, text: 'Figure', resource: true, status: 'pending' },
    { id: 4, text: 'Methods', heading: true, status: 'failed' },
    { id: 5, text: 'References', heading: true, status: 'pending' },
    { id: 6, text: 'Citation entry', status: 'pending' }
  ];
  const references = referenceBlockIds(blocks);
  assert.deepEqual(translationRangeIds(blocks, null, references), [1, 4]);
  assert.deepEqual(translationRangeIds(blocks, [2, 3, 4, 5], references), [4]);
  assert.deepEqual(translationRangeIds(blocks, [], references), []);
});

test('MinerU imports require readable structured text while preserving companion resources', async () => {
  const { readableMineruBlocks } = await import('../src/academicMarkdown.mjs');
  for (const markdown of ['', ' \n ', '![Cover](cover.png)', '$$x^2$$', '# References\n\nAn excluded citation.']) {
    assert.throws(() => readableMineruBlocks(markdown), /MinerU returned no readable blocks/);
  }
  const blocks = readableMineruBlocks('# Methods\n\nThe model compares two groups.\n\n![Result](figure.png)');
  assert.deepEqual(blocks.map(block => block.resource), [false, false, true]);
  assert.equal(blocks[2].sourceMarkdown, '![Result](figure.png)');
});

test('library labels preserve Unicode graphemes and bound sorted, unique tags', async () => {
  const { libraryLabel } = await import('../src/paper.mjs');
  const grapheme = '👩‍🔬';
  const longTag = '文'.repeat(50);
  const tags = Array.from({ length: 24 }, (_, index) => `t${String(index).padStart(2, '0')}`).reverse();
  const label = libraryLabel(`  ${grapheme.repeat(201)}  `, ` Beta, Alpha, Beta,, ${longTag}, ${tags.join(', ')}`);
  assert.equal(label.libraryTitle, grapheme.repeat(200));
  assert.deepEqual(label.tags, ['Alpha', 'Beta', ...tags.reverse().slice(0, 18)]);
  assert.deepEqual(libraryLabel('  Title  ', ` ${longTag}, ${longTag} `), { libraryTitle: 'Title', tags: ['文'.repeat(40)] });
});

test('summary source links require an exact quote in a real source block', async () => {
  const { parseSummaryClaims, summarySourceCandidates } = await import('../src/paper.mjs');
  const passage = 'The measured intervention improved response time in the tested sample by twelve percent.';
  const blocks = [{ id: 7, text: passage }];
  const quote = 'improved response time in the tested sample';
  const output = JSON.stringify({ claims: [{ text: 'A supported claim', sources: [{ paragraphID: 7, quote }, { paragraphID: 99, quote }, { paragraphID: 7, quote: 'invented source quotation here' }] }] });
  const claims = parseSummaryClaims(output, blocks);
  assert.deepEqual(claims[0].sources, [{ paragraphID: 7, quote }]);
  assert.deepEqual(parseSummaryClaims('Model wrote plain text [7].', blocks)[0].sources, []);
  assert.deepEqual(parseSummaryClaims(output, blocks, [])[0].sources, []);
  assert.deepEqual(summarySourceCandidates(JSON.stringify({ claims: [{ text: 'A claim', sources: [{ paragraphID: 'P7' }, { paragraphID: 'P99' }] }] }), blocks), [[7]]);
  assert.deepEqual(summarySourceCandidates('unstructured summary', blocks), []);
});

test('summary excerpts keep original paragraph IDs and whole Unicode characters under the tagged limit', async () => {
  const { summarySourceBlocks, summarySourceBatches, parseSummaryClaims } = await import('../src/paper.mjs');
  const tail = 'The last trial showed a clear limitation.';
  const long = `${'文'.repeat(5994)}😀${'字'.repeat(6040)}${tail}`;
  const source = summarySourceBlocks([
    { id: 1, heading: true, text: 'Introduction' },
    { id: 2, text: long },
    { id: 3, resource: true, text: 'Image' },
    { id: 4, heading: true, text: 'References' },
    { id: 5, text: 'Excluded citation.' },
    { id: 6, heading: true, text: 'Appendix' },
    { id: 7, text: 'The appendix remains eligible.' }
  ]);
  assert.deepEqual(source.map(block => block.id), [2, 7]);
  const batches = summarySourceBatches(source);
  assert.equal(batches.flat().filter(block => block.id === 2).map(block => block.text).join(''), long);
  assert.ok(batches.every(batch => batch.map(({ id, text }) => `[P${id}]\n${text}`).join('\n\n').length <= 6000));
  assert.ok(batches.flat().every(block => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(block.text)));
  const response = JSON.stringify({ claims: [{ text: 'Limitation', sources: [{ paragraphID: 'P2', quote: tail }] }] });
  assert.deepEqual(parseSummaryClaims(response, batches[0])[0].sources, []);
  assert.deepEqual(parseSummaryClaims(response, batches.at(-1))[0].sources, [{ paragraphID: 2, quote: tail }]);
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

test('PDF facsimile bundles include only completed page images and preserve the translated body', () => {
  const { writeBundle, writeBundleFacsimile } = require('../electron/bundle.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-facsimile-'));
  const pdf = path.join(parent, 'source.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\nsource bytes');
  try {
    const documents = [
      { kind: 'full', name: 'Full Translation', content: 'Saved translated text.' },
      { kind: 'analysis', name: 'Analysis', content: 'Exact notes.' }
    ];
    const bundle = writeBundle(parent, { name: 'PDF text.pdf', type: 'pdf', facsimile: true }, documents, pdf);
    writeBundleFacsimile({ ...bundle, renderedPages: new Set([1, 120]) }, 125, true);
    const full = fs.readFileSync(path.join(bundle.folder, 'Full Translation.md'), 'utf8');
    assert.match(full, /first 120 of 125 pages/);
    assert.match(full, /Page export stopped/);
    assert.match(full, /\(original\.pdf\)/);
    assert.deepEqual([...full.matchAll(/pages\/page-(\d+)\.png/g)].map(match => match[1]), ['001', '120']);
    assert.match(full, /# Full translation of selectable text\n\nSaved translated text\.\n$/);
    assert.equal(fs.readFileSync(path.join(bundle.folder, 'Analysis.md'), 'utf8'), 'Exact notes.');

    const structured = writeBundle(parent, { name: 'MinerU.pdf', type: 'pdf' }, documents, pdf);
    writeBundleFacsimile({ ...structured, renderedPages: new Set() }, 1, false);
    assert.match(fs.readFileSync(path.join(structured.folder, 'Original Pages.md'), 'utf8'), /previews are unavailable/);
    assert.equal(fs.readFileSync(path.join(structured.folder, 'Full Translation.md'), 'utf8'), 'Saved translated text.');
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
