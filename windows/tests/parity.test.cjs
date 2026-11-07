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
    '<IMG src="images/panel.png" alt="Observed score > 42">',
    'Figure 2: Summary of outcomes.',
    '',
    '```python',
    'print(42)',
    '```'
  ].join('\n');
  const blocks = parsedMarkdownBlocks(markdown);
  assert.deepEqual(blocks.map(block => [block.heading, block.resource]), [
    [true, false], [false, false], [false, true], [false, false],
    [false, false], [false, true], [false, true], [false, true], [false, false], [false, true]
  ]);
  assert.equal(blocks[3].text, 'Figure 1: Architecture.');
  assert.equal(blocks[4].text, 'Table 1: Scores.');
  assert.equal(blocks[7].text, '[Figure]');
  assert.equal(blocks[8].text, 'Figure 2: Summary of outcomes.');
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

test('reference ranges recognize inline and unlabelled bibliographies without losing later body text', async () => {
  const { referenceBlockIds, summarySourceBlocks, translationRangeIds } = await import('../src/paper.mjs');
  const { planConnectedBatches } = await import('../src/connectedTranslation.mjs');
  const blocks = [
    { id: 11, text: 'The team calibrated the sensors.' },
    { id: 23, text: 'References to previous studies informed the baseline.' },
    { id: 26, text: 'The control and treatment differed.' },
    { id: 31, text: '[1] Ng, A. (2021). Results for the previous sensor. Journal of Testing.' },
    { id: 32, text: '[2] J. Lee and P. Moss. Sensors in the field. Proceedings of Testing, 2022.' },
    { id: 33, text: '[3] Renée Moreau, Liam Clarke, and Amy Gold. Estimating calibration error, 2018.' },
    { id: 41, text: 'Appendix A. The team repeated the calibration with cold water.' },
    { id: 43, text: 'The cold-water measurements agreed with the baseline.' }
  ];
  for (const prefix of ['', '9. References: ']) {
    const sample = blocks.map(block => block.id === 31 ? { ...block, text: prefix + block.text } : block);
    assert.deepEqual([...referenceBlockIds(sample)], [31, 32, 33]);
    assert.deepEqual(summarySourceBlocks(sample).map(block => block.id), [11, 23, 26, 41, 43]);
    assert.deepEqual(translationRangeIds(sample), [11, 23, 26, 41, 43]);
    const plan = planConnectedBatches(sample);
    assert.deepEqual(plan.map(batch => batch.kind), ['translation', 'original', 'original', 'original', 'translation']);
    assert.deepEqual(plan.slice(1, 4).map(batch => batch.source), sample.slice(3, 6).map(block => block.text));
    assert.match(plan.at(-1).source, /Appendix A\./);
  }
  const protocol = [
    '1. Repeat the 2021 calibration with a fresh sensor.',
    '2. Apply the 2022 baseline using https://example.test/protocol.',
    '3. Compare the 2024 measurements with the workshop notes.'
  ];
  assert.deepEqual([...referenceBlockIds([...blocks.slice(0, 3), ...protocol.map((text, i) => ({ id: 90 + i, text }))])], []);
  const discussion = [
    'Lee (2021) tested an earlier implementation.',
    'Moreau et al. (2022) reported a smaller margin of error.',
    'Ng and Moss (2023) repeated the calibration with a new sensor.'
  ];
  assert.deepEqual([...referenceBlockIds([...blocks.slice(0, 3), ...discussion.map((text, i) => ({ id: 91 + i, text }))])], []);
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
  assert.deepEqual(translationRangeIds(blocks, [2], references, 2), [2], 'an explicit single-paragraph retry may replace an existing result');
  assert.deepEqual(translationRangeIds(blocks, [2], references, 1), [], 'retrying another paragraph must not bypass completed filtering');
  assert.deepEqual(translationRangeIds(blocks, [3], references, 3), [], 'resources remain protected');
  assert.deepEqual(translationRangeIds(blocks, [5], references, 5), [], 'excluded references remain protected');
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

test('structured Markdown editions preserve the source, unfinished passages, and ready translations', async () => {
  const { markdownDocuments } = await import('../src/exportDocuments.mjs');
  const blocks = [
    { id: 1, sourceMarkdown: '# Study', heading: true, status: 'ok', translationMarkdown: '# Étude' },
    { id: 2, sourceMarkdown: 'A completed paragraph.', status: 'ok', translationMarkdown: 'Une phrase.\n\nUne autre phrase.' },
    { id: 3, sourceMarkdown: 'A paragraph awaiting translation.', status: 'pending' },
    { id: 4, sourceMarkdown: 'A paragraph awaiting retry.', status: 'failed', error: 'Model timed out', translation: 'Stale output' },
    { id: 5, sourceMarkdown: '![Figure](images/plot.png)', resource: true, status: 'ok', translation: 'Wrong figure' }
  ];
  const mineruMarkdown = blocks.map(block => block.sourceMarkdown).join('\n\n\n');
  const paper = { name: 'Study', sourceMode: 'mineru', mineruMarkdown, blocks, connectedTranslation: 'An older saved draft',
    taskSettings: { sourceLanguage: 'English', targetLanguage: 'French' } };
  const docs = Object.fromEntries(markdownDocuments(paper, 'French').map(document => [document.kind, document.content]));
  assert.equal(docs.original, mineruMarkdown);
  assert.match(docs.translated, /^# Étude\n\nUne phrase\./);
  assert.match(docs.translated, /A paragraph awaiting translation\.\n\nA paragraph awaiting retry\.\n\n!\[Figure\]\(images\/plot\.png\)$/);
  assert.doesNotMatch(docs.translated, /Stale output|Wrong figure|Untranslated block/);
  assert.match(docs.bilingual, /^# Study\n\n# Étude[\s\S]*> \*\*French translation\*\*\n>\n> Une phrase\.\n>\n> Une autre phrase\./);
  assert.equal(docs.full, docs.translated);
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, 'An older saved draft');
  assert.match(docs.analysis, /\[Translation failed\] Model timed out/);
});

test('PDF text bundle retains the original passage when a translation is unavailable', async () => {
  const { markdownDocuments } = await import('../src/exportDocuments.mjs');
  const blocks = [{ id: 1, text: 'Translated paragraph.', status: 'ok', translation: 'Une traduction.' },
    { id: 2, text: 'Pending paragraph.', status: 'pending' }];
  const paper = { name: 'Article.pdf', type: 'pdf', sourceMode: 'pdf', blocks };
  const docs = Object.fromEntries(markdownDocuments(paper, 'French').map(document => [document.kind, document.content]));
  assert.equal(docs.translated, 'Une traduction.\n\nPending paragraph.');
  assert.match(docs.bilingual, /Pending paragraph\.\n\n> \*\*Translation\*\*\n>\n> \[Translation unavailable\]/);
  assert.match(markdownDocuments(paper, 'French', 'translated')[0].content, /\[Untranslated block 2\]/);
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
      { name: 'Original', filename: 'paper_original.md', content: `![plot](${data})` },
      { name: 'Bilingual', filename: 'paper_bilingual_en_fr.md', content: `![plot](${data})` }
    ], pdf);
    const digest = crypto.createHash('sha256').update(image).digest('hex');
    assert.equal(result.assets, 1);
    assert.equal(fs.readFileSync(path.join(result.folder, 'original.pdf')).compare(original), 0);
    assert.equal(fs.readFileSync(path.join(result.folder, 'assets', `${digest}.png`)).compare(image), 0);
    assert.equal(path.basename(result.folder), 'Test Paper_PaperBridge');
    assert.deepEqual(fs.readdirSync(result.folder).sort(), ['assets', 'original.pdf', 'paper_bilingual_en_fr.md', 'paper_original.md']);
    assert.match(fs.readFileSync(path.join(result.folder, 'paper_original.md'), 'utf8'), new RegExp(`assets/${digest}\\.png`));
  } finally {
    if (!path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test folder');
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('portable bundles keep HTML images, retained MinerU files and link fragments and report missing assets', () => {
  const { writeBundle } = require('../electron/bundle.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-bundle-assets-'));
  try {
    const source = path.join(parent, 'parsed');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'support data.csv'), 'a,b\n1,2');
    fs.writeFileSync(path.join(source, 'legacy.png'), 'older image');
    fs.writeFileSync(path.join(parent, 'private.csv'), 'outside parser output');
    fs.mkdirSync(path.join(parent, 'outside'));
    fs.writeFileSync(path.join(parent, 'outside', 'escape.csv'), 'outside via link');
    fs.symlinkSync(path.join(parent, 'outside'), path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const pdf = path.join(parent, 'scan.pdf');
    fs.writeFileSync(pdf, 'exact original');
    const image = `data:image/png;base64,${Buffer.from('embedded image').toString('base64')}`;
    const content = [
      `![Figure](${image} "Caption title")`,
      `<table><tr><td><img src='${image}' alt="Embedded cell"><img src="legacy.png"></td></tr></table>`,
      '[Data](<support data.csv> "Supplement") and [Second link](support%20data.csv#row-1).',
      '[Original](./original.pdf#page=2) [Remote](https://example.org/image.png) [Section](#results)',
      '![Missing](figures/gone.png) [Missing again](figures/gone.png#figure)',
      '[Outside](%2E%2E/private.csv)',
      '[Linked outside](linked/escape.csv)',
      '```html\n<img src="in-a-code-example.png">\n```'
    ].join('\n\n');
    const bundle = writeBundle(parent, { name: 'Scan.pdf', type: 'pdf', sourceMode: 'mineru' }, [{ name: 'Original', filename: 'paper_original.md', content }], pdf, source);
    assert.equal(bundle.assets, 3);
    assert.deepEqual(bundle.missingAssetPaths, ['../private.csv', 'figures/gone.png', 'linked/escape.csv']);
    const exported = fs.readFileSync(path.join(bundle.folder, 'paper_original.md'), 'utf8');
    const embedded = exported.match(/!\[Figure\]\((assets\/\w+\.png) "Caption title"\)/)?.[1];
    const legacy = exported.match(/alt="Embedded cell"><img src="(assets\/local-\w+\.png)"/)?.[1];
    const csv = exported.match(/\[Data\]\(<(assets\/local-\w+\.csv)> "Supplement"\)/)?.[1];
    assert.ok(embedded && legacy && csv);
    assert.ok(exported.includes(`<img src='${embedded}' alt="Embedded cell">`));
    assert.ok(exported.includes(`[Second link](${csv}#row-1)`));
    assert.ok(exported.includes('[Original](original.pdf#page=2) [Remote](https://example.org/image.png) [Section](#results)'));
    assert.ok(exported.includes('```html\n<img src="in-a-code-example.png">\n```'));
    for (const [file, expected] of [[embedded, 'embedded image'], [legacy, 'older image'], [csv, 'a,b\n1,2'], ['original.pdf', 'exact original']]) {
      assert.equal(fs.readFileSync(path.join(bundle.folder, file), 'utf8'), expected);
    }
  } finally {
    if (!path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test folder');
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('bundle filenames are safe, case-insensitively unique and preserve generated PDF index names', () => {
  const { writeBundle, writeBundleFacsimile, safeName } = require('../electron/bundle.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-bundle-names-'));
  try {
    for (const name of ['CON', 'prn', 'NUL.txt', 'com1', 'LPT9']) assert.equal(safeName(name), `_${name}`);
    assert.equal(safeName('a<bad>:name?. . '), 'a-bad--name-');
    assert.equal(safeName('...'), 'PaperBridge');
    const pdf = path.join(parent, 'source.pdf');
    fs.writeFileSync(pdf, 'unchanged original PDF');
    const documents = [
      { name: 'Original label stays readable', filename: 'paper_original.md', content: 'first' },
      { name: 'Same name with different casing', filename: 'PAPER_ORIGINAL.md', content: 'second' },
      { name: 'Device', filename: 'CON.md', content: 'device' },
      { name: 'Unsafe', filename: '../escape.md', content: 'contained' },
      { name: 'Trailing', filename: 'trailing. .md', content: 'trimmed' },
      { name: 'Index collision', filename: 'Original Pages.md', content: 'user document' }
    ];
    const result = writeBundle(parent, { name: 'Paper.draft.pdf', type: 'pdf' }, documents, pdf);
    assert.equal(path.basename(result.folder), 'Paper.draft_PaperBridge');
    assert.deepEqual(fs.readdirSync(result.folder).sort(), ['..-escape.md', 'Original Pages-2.md', 'PAPER_ORIGINAL-2.md', '_CON.md', 'original.pdf', 'paper_original.md', 'trailing.md'].sort());
    assert.equal(fs.readFileSync(path.join(result.folder, 'paper_original.md'), 'utf8'), 'first');
    assert.equal(fs.readFileSync(path.join(result.folder, 'PAPER_ORIGINAL-2.md'), 'utf8'), 'second');
    assert.equal(fs.existsSync(path.join(parent, 'escape.md')), false);
    writeBundleFacsimile({ ...result, renderedPages: new Set() }, 0, false);
    assert.equal(fs.readFileSync(path.join(result.folder, 'Original Pages-2.md'), 'utf8'), 'user document');
    assert.match(fs.readFileSync(path.join(result.folder, 'Original Pages.md'), 'utf8'), /could not be opened for page previews/);
    const second = writeBundle(parent, { name: 'Paper.draft.pdf' }, [{ name: 'Legacy name', content: 'legacy compatibility' }]);
    assert.equal(path.basename(second.folder), 'Paper.draft_PaperBridge-2');
    assert.equal(fs.readFileSync(path.join(second.folder, 'Legacy name.md'), 'utf8'), 'legacy compatibility');
    const third = writeBundle(parent, { name: 'Paper.draft.pdf' }, [{ name: 'Third', filename: 'paper_original.md', content: 'third' }]);
    assert.equal(path.basename(third.folder), 'Paper.draft_PaperBridge-3');
    assert.equal(fs.readFileSync(path.join(result.folder, 'paper_original.md'), 'utf8'), 'first');
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
      { kind: 'full', name: 'Full Translation', filename: 'paper_full_translation_fr.md', content: 'Saved translated text.' },
      { kind: 'analysis', name: 'Analysis', filename: 'paper_analysis_notes.md', content: 'Exact notes.' }
    ];
    const bundle = writeBundle(parent, { name: 'PDF text.pdf', type: 'pdf', facsimile: true }, documents, pdf);
    writeBundleFacsimile({ ...bundle, renderedPages: new Set([1, 120]) }, 125, true);
    const full = fs.readFileSync(path.join(bundle.folder, 'paper_full_translation_fr.md'), 'utf8');
    assert.match(full, /first 120 of 125 pages/);
    assert.match(full, /Page export stopped/);
    assert.match(full, /\(original\.pdf\)/);
    assert.deepEqual([...full.matchAll(/pages\/page-(\d+)\.png/g)].map(match => match[1]), ['001', '120']);
    assert.match(full, /# Full translation of selectable text\n\nSaved translated text\.\n$/);
    assert.equal(fs.readFileSync(path.join(bundle.folder, 'paper_analysis_notes.md'), 'utf8'), 'Exact notes.');

    const structured = writeBundle(parent, { name: 'MinerU.pdf', type: 'pdf' }, documents, pdf);
    writeBundleFacsimile({ ...structured, renderedPages: new Set() }, 1, false);
    assert.match(fs.readFileSync(path.join(structured.folder, 'Original Pages.md'), 'utf8'), /previews are unavailable/);
    assert.equal(fs.readFileSync(path.join(structured.folder, 'paper_full_translation_fr.md'), 'utf8'), 'Saved translated text.');
  } finally {
    if (!path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test folder');
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('PDF page archives share exact PDF bytes, detect damaged entries and clear with workspace data', async () => {
  const { createPageArchive } = require('../electron/pdf-page-archive.cjs');
  const { createStore } = require('../electron/storage.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-page-archive-'));
  const pdfBytes = Buffer.from('%PDF-1.4\narchive fixture');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xf1sAAAAASUVORK5CYII=', 'base64');
  try {
    const store = createStore(root);
    const hash = crypto.createHash('sha256').update(pdfBytes).digest('hex');
    const pdf = store.pdfPath(hash);
    fs.mkdirSync(path.dirname(pdf));
    fs.writeFileSync(pdf, pdfBytes);
    const { version } = require('pdfjs-dist/package.json');
    const cache = path.join(root, 'pdf-page-cache');
    const legacy = path.join(cache, `pdfjs-png-v1-${version}`, hash);
    fs.mkdirSync(legacy, { recursive: true });
    const legacyEntry = (name, bytes) => fs.writeFileSync(path.join(legacy, name),
      Buffer.concat([crypto.createHash('sha256').update(bytes).digest(), bytes]));
    legacyEntry('page-001.png.entry', image);
    legacyEntry('page-count.entry', Buffer.from('2'));
    const archive = await createPageArchive(root, pdf);
    assert.deepEqual(archive.status(), { cachedPageCount: 0, cachedPages: [] }, 'Previous preview dimensions must be regenerated');
    assert.equal(archive.readPage(1), null);
    archive.savePage(1, image);
    archive.savePageCount(2);
    const copy = path.join(root, 'new extraction.pdf');
    fs.copyFileSync(pdf, copy);
    const same = await createPageArchive(root, copy, { expectedFingerprint: hash });
    assert.deepEqual(same.status(), { cachedPageCount: 2, cachedPages: [1] });
    assert.deepEqual(same.readPage(1), image);
    assert.equal(same.readPage(2), null);
    fs.appendFileSync(copy, ' changed');
    assert.equal(await createPageArchive(root, copy, { expectedFingerprint: hash }), null);
    assert.equal(await createPageArchive(root, copy, { isCurrent: () => false }), null);
    const changed = await createPageArchive(root, copy);
    assert.deepEqual(changed.status(), { cachedPageCount: 0, cachedPages: [] });
    assert.equal(same.matches(fs.readFileSync(copy)), false);
    const folder = path.join(cache, `pdfjs-png-v2-${version}`, hash);
    const imageFile = path.join(folder, 'page-001.png.entry');
    const damaged = fs.readFileSync(imageFile);
    damaged[damaged.length - 1] ^= 1;
    fs.writeFileSync(imageFile, damaged);
    assert.equal(same.readPage(1), null);
    same.savePage(1, image);
    assert.deepEqual(same.readPage(1), image);
    fs.writeFileSync(path.join(folder, 'page-count.entry'), 'damaged');
    assert.deepEqual(same.status(), { cachedPageCount: 0, cachedPages: [1] });
    assert.ok(fs.existsSync(path.join(legacy, 'page-001.png.entry')));
    store.clearData();
    assert.equal(fs.existsSync(cache), false);
    assert.deepEqual(fs.readFileSync(pdf), pdfBytes);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test folder');
    fs.rmSync(root, { recursive: true, force: true });
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

test('edited source retains unresolved notes and both highlight sides for review', async () => {
  const { editedBlock, revalidateSummaryClaims } = await import('../src/paper.mjs');
  const before = { id: 1, text: 'A unique phrase explains the result.', translation: 'old', status: 'ok',
    highlights: [{ text: 'unique phrase', offset: 2, color: 'amber' }], translationHighlights: [{ text: 'old', offset: 0, color: 'teal' }],
    notes: [{ id: 'note', text: 'unique phrase', offset: 2, kind: 'source', body: 'Saved idea' }] };
  const changed = editedBlock(before, 'A different result appears here.');
  assert.deepEqual(changed.highlights, [{ ...before.highlights[0], needsReview: true }]);
  assert.deepEqual(changed.translationHighlights, [{ ...before.translationHighlights[0], needsReview: true }]);
  assert.equal(changed.notes[0].needsReview, true);
  assert.equal(changed.notes[0].body, 'Saved idea');
  assert.equal(changed.status, 'pending');
  const claims = [{ text: 'A claim', sources: [{ paragraphID: 1, quote: 'A unique phrase explains the result.' }] }];
  assert.deepEqual(revalidateSummaryClaims(claims, [changed])[0].sources, []);
});

test('summary evidence follows structural edits only within the original passage or its replacements', async () => {
  const { remapSummaryEvidence } = await import('../src/paper.mjs');
  const quote = 'The same exact evidence words were printed.';
  const blocks = (...texts) => texts.map((text, index) => ({ id: index + 1, text }));
  const before = blocks('Introductory paragraph.', quote, `The final finding. ${quote}`);
  const sources = id => ({ paragraphID: id, quote });
  const summary = { source: 'A finding.', claims: [{ text: 'A finding.', sources: [sources(3)] }] };
  const remapped = (after, range, current = summary) => remapSummaryEvidence(current, before, after, range);

  const shifted = remapped(blocks('Introductory paragraph.', 'New paragraph.', quote, before[2].text),
    { start: 0, beforeEnd: 1, afterEnd: 2 });
  assert.equal(shifted.stale, true);
  assert.deepEqual(shifted.claims[0].sources, [sources(4)]);
  assert.deepEqual(remapped(blocks(before[0].text, quote, 'Revised final finding.'),
    { start: 2, beforeEnd: 3, afterEnd: 3 }).claims[0].sources, []);
  assert.deepEqual(remapped(blocks(before[0].text, quote, quote, quote),
    { start: 2, beforeEnd: 3, afterEnd: 4 }).claims[0].sources, []);
  assert.deepEqual(remapped(blocks(before[0].text, `${quote} ${before[2].text}`),
    { start: 1, beforeEnd: 3, afterEnd: 2 },
    { ...summary, claims: [{ ...summary.claims[0], sources: [sources(2), sources(3)] }] }).claims[0].sources, [sources(2)]);
});

test('MinerU paragraph pages follow unique source text without changing saved work', async () => {
  const { locateMineruPages, readableMineruBlocks } = await import('../src/academicMarkdown.mjs');
  const longText = 'A distinct passage verified against the selectable text layer.';
  const crossPage = 'A PDF block stitched across two pages has no reliable single-page location.';
  const ambiguous = 'A recurring passage appears in both portions of the document.';
  const parts = 'Two OCR fragments together describe the same exact result.';
  const blocks = readableMineruBlocks(['# Section on the second page', parts, ambiguous, longText, crossPage, '![Image](photo.png)'].join('\n\n'));
  blocks[3].translation = 'Existing translation';
  blocks[3].notes = [{ body: 'Existing note' }];
  const hints = [{ page: 2, text: 'Section on the second page' }, { page: 2, text: 'Two OCR fragments together' },
    { page: 2, text: 'describe the same exact result.' }, { page: 2, text: ambiguous }, { page: 3, text: ambiguous },
    { page: 99, text: longText }];
  const pdf = [{ page: 4, text: longText }, { page: 2, text: ambiguous }, { page: 4, endPage: 5, text: crossPage }];
  const located = locateMineruPages(blocks, hints, pdf, 5);
  assert.deepEqual(located.map(block => block.page), [2, 2, null, 4, null, null]);
  assert.deepEqual(located[3], { ...blocks[3], page: 4 });
  assert.equal(locateMineruPages(located, hints, pdf, 5), located);
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

test('safe splitting and reflow recognize closing quotes and CJK sentences while keeping abbreviations intact', async () => {
  const { reflowBlock, splitBlockNearMiddle } = await import('../src/paper.mjs');
  const english = { text: 'Dr. Smith described Fig. 2. They wrote “The result is stable.” The later trial confirmed it.' };
  assert.deepEqual(reflowBlock(english, 40).map(block => block.text), [
    'Dr. Smith described Fig. 2.', 'They wrote “The result is stable.”', 'The later trial confirmed it.'
  ]);
  const chinese = { text: '作者解释机制。研究结果一致！后续仍需验证。', bookmark: true,
    translationHighlights: [{ id: 'translated', text: 'mechanism', offset: 4, color: 'amber' }] };
  const pieces = reflowBlock(chinese, 8);
  assert.deepEqual(pieces.map(block => block.text), ['作者解释机制。', '研究结果一致！', '后续仍需验证。']);
  assert.ok(pieces.every(block => block.bookmark));
  assert.deepEqual(pieces.flatMap(block => block.translationHighlights), [{ ...chinese.translationHighlights[0], needsReview: true }]);
  assert.deepEqual(splitBlockNearMiddle({ text: '作者解释机制。研究结果一致！' }).map(block => block.text), ['作者解释机制。', '研究结果一致！']);
  assert.equal(splitBlockNearMiddle({ text: 'Dr. Smith measured the outcome.' }).length, 1);
});

test('merging repairs a hyphenated word and preserves annotations with verified positions', async () => {
  const { mergeBlocks } = await import('../src/paper.mjs');
  const left = { text: 'Our trans-', highlights: [{ text: 'trans-', offset: 4, color: 'amber' }],
    translationHighlights: [{ id: 'left', text: 'a', offset: 0, color: 'amber' }] };
  const right = { text: 'lation succeeds.', notes: [{ id: 'note', text: 'succeeds', offset: 7, displayOffset: 7, body: 'Keep' }],
    translationHighlights: [{ id: 'right', text: 'b', offset: 0, color: 'teal' }] };
  const merged = mergeBlocks(left, right);
  assert.equal(merged.text, 'Our translation succeeds.');
  assert.equal(merged.highlights[0].needsReview, true);
  assert.equal(merged.notes[0].offset, merged.text.indexOf('succeeds'));
  assert.equal(merged.notes[0].displayOffset, merged.notes[0].offset);
  assert.equal(merged.notes[0].needsReview, false);
  assert.deepEqual(merged.translationHighlights.map(item => [item.id, item.needsReview]), [['left', true], ['right', true]]);
});

test('saving a manual edit splits at blank lines and moves exact annotations into their new blocks', async () => {
  const { editedParagraphs } = await import('../src/paper.mjs');
  const original = { id: 2, text: 'First sentence. Second sentence.', translation: 'old', status: 'ok', bookmark: true,
    notes: [{ id: 'exact', text: 'Second', offset: 16, kind: 'source', body: 'Keep this' },
      { id: 'crossing', text: 'sentence. Second', offset: 6, kind: 'source', body: 'Review this' }],
    highlights: [{ text: 'Second', offset: 16, color: 'amber' }] };
  const parts = editedParagraphs(original, ' First sentence.\r\n \r\nSecond\r\n  sentence. ');
  assert.deepEqual(parts.map(block => block.text), ['First sentence.', 'Second sentence.']);
  assert.ok(parts.every(block => block.bookmark && block.status === 'pending' && !block.translation));
  assert.equal(parts[0].notes[0].needsReview, true);
  assert.equal(parts[1].notes[0].id, 'exact');
  assert.equal(parts[1].notes[0].offset, 0);
  assert.equal(parts[1].highlights[0].offset, 0);
  assert.deepEqual(editedParagraphs(original, ' \n \n '), []);
  assert.equal(editedParagraphs(original, ` ${original.text} `)[0], original);

  const repeated = { ...original, text: 'Same phrase. Same phrase.', highlights: [],
    notes: [{ id: 'second', text: 'Same phrase', offset: 13, kind: 'source', body: 'Second occurrence' }] };
  const [first, second] = editedParagraphs(repeated, 'Same phrase.\n\nSame phrase.');
  assert.deepEqual(first.notes, []);
  assert.equal(second.notes[0].offset, 0);
  assert.equal(second.notes[0].needsReview, false);
});
