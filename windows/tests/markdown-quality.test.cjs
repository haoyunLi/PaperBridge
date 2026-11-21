const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = import('../src/academicMarkdown.mjs');
const paper = import('../src/paper.mjs');
test('structured section names preserve identifiers on import and in searches of older workspaces', async () => {
  const { parsedMarkdownBlocks } = await markdown;
  const { documentOutline, sectionRanges } = await import('../src/documentOutline.mjs');
  const { filteredReaderBlocks } = await import('../src/textSearch.mjs');
  const fixture = require('./mac-parity/fixtures.json').papers.find(p => p.name === 'distinct scientific section identifiers');
  const imported = parsedMarkdownBlocks(fixture.blocks.map(b => b.sourceMarkdown || b.text).join('\n\n'));
  assert.deepEqual(imported.map(b => b.text), fixture.blocks.map(b => b.text));
  const old = imported.map(b => Object.freeze({ ...b, text: b.text.replace(/[#*_]/g, '') }));
  for (const blocks of [imported, old]) {
    const headings = [0, 2, 4].map(i => ({ id: i + 1, title: fixture.blocks[i].text }));
    assert.deepEqual(documentOutline({ sourceMode: 'mineru', blocks }), headings);
    assert.deepEqual(sectionRanges(blocks).map(s => [s.title, s.ids]), headings.map(h => [h.title, [h.id, h.id + 1]]));
    assert.deepEqual(filteredReaderBlocks(blocks, 'model_A').map(b => b.id), [1]);
    assert.deepEqual(filteredReaderBlocks(blocks, 'modelA').map(b => b.id), [3]);
    assert.deepEqual(filteredReaderBlocks(blocks, 'C#').map(b => b.id), [1, 3]);
  }
});

test('scientific literals survive Markdown analysis, search, citation validation and old workspaces', async () => {
  const { parsedMarkdownBlocks, analysisSourceText, anchorText } = await markdown;
  const { summarySourceBlocks, revalidateSummaryClaims, summaryNeedsTextRefresh, markdownSummaryTextVersion } = await paper;
  const { filteredReaderBlocks } = await import('../src/textSearch.mjs');
  const source = 'We compare `model_A` and `modelA` using C# and **paired** A* search. ' +
    'The `x**2 + [$a$](path) + <T>` result uses [p_value](url) and $x_y$ with ![plot](chart.png).';
  const [fresh] = parsedMarkdownBlocks(source);
  const original = 'We compare model_A and modelA using C# and paired A* search. ' +
    'The x**2 + [$a$](path) + <T> result uses p_value and [Formula] with [Figure].';
  assert.equal(fresh.text, original);
  const legacyText = 'We compare modelA and modelA using C and paired A search. The x2 + [[Formula]](path) +  result uses pvalue and [Formula] with [Figure].';
  const old = Object.freeze({ ...fresh, text: legacyText });
  const claim = { text: 'Method', sources: [{ paragraphID: 1, quote: 'model_A and modelA using C#' }] };
  for (const block of [old, fresh]) {
    assert.equal(analysisSourceText(block), original);
    assert.equal(summarySourceBlocks([block])[0].text, original);
    assert.deepEqual(filteredReaderBlocks([block], 'p_value'), [block]);
    assert.deepEqual(revalidateSummaryClaims([claim], [block]), [claim]);
  }
  assert.equal(anchorText(old, 'source'), legacyText);
  const edited = { ...old, text: 'Locally edited paragraph.' };
  assert.equal(analysisSourceText(edited), edited.text);
  assert.deepEqual(revalidateSummaryClaims([claim], [edited])[0].sources, []);
  assert.equal(summaryNeedsTextRefresh({ blocks: [old], summary: {} }), true);
  assert.equal(summaryNeedsTextRefresh({ blocks: [fresh], summary: {} }), false);
  assert.equal(summaryNeedsTextRefresh({ blocks: [old], summary: { markdownTextVersion: markdownSummaryTextVersion } }), false);
  const [escaped] = parsedMarkdownBlocks('Unicode λ_fit and \\_escaped\\_ with `__init__` and &#95;.');
  assert.equal(escaped.text, 'Unicode λ_fit and _escaped_ with __init__ and _.');
  const operators = parsedMarkdownBlocks('Pass **kwargs through.\n\nEvaluate x**2 for A*.');
  assert.deepEqual(operators.map(block => block.text), ['Pass **kwargs through.', 'Evaluate x**2 for A*.']);
});

test('resource boundaries keep table cells and code out of model requests while preserving the prose that follows', async () => {
  const { parsedMarkdownBlocks } = await markdown;
  const { summarySourceBlocks, translationRangeIds } = await paper;
  const fixtures = require('./mac-parity/fixtures.json').resourceBoundaries;
  const expected = [
    ['list', 'list', 'paragraph'], ['paragraph', 'table', 'paragraph'], ['paragraph', 'table', 'paragraph'],
    ['html', 'paragraph'], ['html', 'paragraph'], ['code', 'paragraph']
  ];
  for (const [i, source] of fixtures.entries()) {
    const blocks = parsedMarkdownBlocks(source);
    assert.deepEqual(blocks.map(block => block.markdownKind), expected[i]);
    const paragraphs = blocks.filter(block => !block.resource);
    assert.deepEqual(translationRangeIds(blocks), paragraphs.map(block => block.id));
    assert.deepEqual(summarySourceBlocks(blocks).map(block => block.text), paragraphs.map(block => block.text));
    assert.equal(paragraphs.at(-1).text, source.split('\n').at(-1));
  }
  for (const row of ['--- | not a divider', '--- | --- | ---']) {
    assert.equal(parsedMarkdownBlocks(['| A | B |', row, 'plain text'].join('\n')).some(block => block.resource), false);
  }
  assert.equal(parsedMarkdownBlocks('| One |\n| --- |\n| 12 |')[0].resource, true);
});

test('older table layouts offer recovery without changing the saved blocks or translations', async () => {
  const { parsedMarkdownBlocks } = await markdown;
  const { qualityIssues } = await paper;
  const [table, mixed] = require('./mac-parity/fixtures.json').resourceBoundaries.slice(1, 3);
  const old = [
    { id: 16, sourceMarkdown: table, text: 'Original saved text', status: 'ok', translation: '保存的译文' },
    { id: 19, resource: true, markdownKind: 'table', sourceMarkdown: mixed.slice(mixed.indexOf('<TABLE>')), text: '12.5 28 The difference remained significant.', bookmark: true }
  ];
  const snapshot = structuredClone(old);
  assert.deepEqual(qualityIssues(old).filter(issue => issue.reextract).map(issue => issue.id), [16, 19]);
  assert.deepEqual(old, snapshot);
  for (const input of [table, mixed]) assert.equal(qualityIssues(parsedMarkdownBlocks(input)).some(issue => issue.reextract), false);
});

const prose = 'The analysis describes the input data, filtering decisions, measurement assumptions and uncertainty bounds for the proposed comparison';

test('new Markdown blocks retain their parser kind without changing source, IDs or translation participation', async () => {
  const { parsedMarkdownBlocks, markdownBlockKind } = await markdown;
  const { qualityIssues, summarySourceBlocks, translationRangeIds } = await paper;
  const sources = ['# Methods', prose, '- ' + prose, '> ' + prose, '![Figure](figure.png)',
    '$$x = y$$', '| A | B |\n| --- | --- |\n| 1 | 2 |', '<div>Supplementary material</div>'];
  const blocks = parsedMarkdownBlocks(sources.join('\n\n'));
  assert.deepEqual(blocks.map(block => block.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(blocks.map(block => block.sourceMarkdown), sources);
  assert.deepEqual(blocks.map(block => block.markdownKind), ['heading', 'paragraph', 'list', 'quote', 'image', 'formula', 'table', 'html']);
  assert.deepEqual(blocks.map(markdownBlockKind), blocks.map(block => block.markdownKind));
  assert.deepEqual(qualityIssues(blocks).map(issue => issue.id), [2]);
  assert.deepEqual(summarySourceBlocks(blocks).map(block => block.id), [1, 2, 3, 4]);
  assert.deepEqual(translationRangeIds(blocks), [1, 2, 3, 4]);
});

test('legacy lists and quotations are protected without rewriting saved output or annotations', async () => {
  const { parsedMarkdownBlocks, markdownBlockKind } = await markdown;
  const { qualityIssues } = await paper;
  const blocks = parsedMarkdownBlocks([
    '- ' + prose,
    '* This item ends with an extracted frag-',
    '1. ' + prose,
    '2) ' + prose,
    '> This quotation ends with an extracted frag-\n> ' + prose
  ].join('\n\n')).map((block, index) => {
    const { markdownKind, ...legacy } = block;
    return { ...legacy, id: 10 + index * 3, bookmark: true, status: 'ok', translation: '已保存的译文',
      highlights: [{ text: 'analysis', offset: 6, color: 'amber' }],
      notes: [{ id: 'note-' + index, text: 'analysis', offset: 6, kind: 'source', body: 'Keep this note' }] };
  });
  const before = JSON.stringify(blocks);
  assert.deepEqual(blocks.map(markdownBlockKind), ['list', 'list', 'list', 'list', 'quote']);
  assert.deepEqual(qualityIssues(blocks), []);
  assert.equal(JSON.stringify(blocks), before);
  assert.ok(blocks.every(block => !Object.hasOwn(block, 'markdownKind')));
});

test('a structural prefix or stale kind cannot suppress warnings for real paragraph content', async () => {
  const { parsedMarkdownBlocks, markdownBlockKind } = await markdown;
  const { qualityIssues } = await paper;
  const list = parsedMarkdownBlocks('- ' + prose)[0];
  const blocks = [
    { id: 1, text: '- ' + prose },
    { id: 2, text: prose, sourceMarkdown: prose, markdownKind: 'list' },
    { id: 3, text: '- List item\n\n' + prose, sourceMarkdown: '- List item\n\n' + prose },
    { id: 4, text: '> Quoted line\n' + prose, sourceMarkdown: '> Quoted line\n' + prose },
    { ...list, id: 5, text: prose },
    { ...list, id: 6, markdownKind: 'unknown' },
    { id: 7, text: '\\- ' + prose, sourceMarkdown: '\\- ' + prose },
    { id: 8, text: prose, sourceMarkdown: '' }
  ];
  assert.deepEqual(blocks.map(markdownBlockKind), [null, 'paragraph', null, null, null, null, 'paragraph', null]);
  assert.deepEqual(qualityIssues(blocks).map(issue => issue.id), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('normal paragraph diagnostics and explicit reference exclusions remain intact', async () => {
  const { parsedMarkdownBlocks } = await markdown;
  const { qualityIssues } = await paper;
  const blocks = parsedMarkdownBlocks([
    'This sentence ends with an extracted frag-',
    'The continuation is given by',
    '123 + 456',
    prose,
    'A complete source sentence.'
  ].join('\n\n'));
  assert.deepEqual(qualityIssues(blocks).map(issue => issue.id), [1, 2, 3, 4]);
  assert.match(qualityIssues(blocks)[0].reason, /cut-off word/);
  assert.match(qualityIssues(blocks)[1].reason, /phrase appears unfinished/);
  assert.match(qualityIssues(blocks)[2].reason, /detached number/);
  assert.match(qualityIssues(blocks)[3].reason, /sentence-ending punctuation/);
  assert.deepEqual(qualityIssues(blocks, new Set([1, 3])).map(issue => issue.id), [2, 4]);
  const combined = 'e\u0301';
  const boundary = [
    { id: 1, text: 'Abstract: These introductory details are deliberately long enough to reach the warning threshold '.repeat(2) },
    { id: 2, text: combined.repeat(100) }, { id: 3, text: combined.repeat(101) }, { id: 4, text: '３ + ２０' }
  ];
  const issues = qualityIssues(boundary);
  assert.deepEqual(issues.map(issue => issue.id), [3, 4]);
  assert.match(issues[0].reason, /sentence-ending punctuation/);
  assert.match(issues[1].reason, /detached number/);
});
