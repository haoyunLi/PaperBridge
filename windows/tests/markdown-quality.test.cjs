const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = import('../src/academicMarkdown.mjs');
const paper = import('../src/paper.mjs');
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
  assert.deepEqual(summarySourceBlocks(blocks).map(block => block.id), [2, 3, 4]);
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
});
