const test = require('node:test');
const assert = require('node:assert/strict');
const helper = import('../src/documentOutline.mjs');
const paper = (texts, sourceMode = 'text') => ({ sourceMode,
  blocks: texts.map((text, index) => ({ id: index + 1, text, heading: false })) });

test('outline detects leading section labels without changing paragraph classification or source', async () => {
  const { documentOutline } = await helper;
  const input = paper([
    'Abstract This study measures the effect of temperature on the sample.',
    '2.3 Methods the authors compare the treatment groups under controlled conditions.',
    'RESULTS the measured values are reported without a terminal period',
    'Discussion: the interpretation remains limited by the available observations.',
    '\n\n  Conclusion\nThis final paragraph records the main observation.'
  ]);
  const before = structuredClone(input);
  assert.deepEqual(documentOutline(input), [
    { id: 1, title: 'Abstract' }, { id: 2, title: '2.3 Methods' },
    { id: 3, title: 'RESULTS' }, { id: 4, title: 'Discussion:' }, { id: 5, title: 'Conclusion' }
  ]);
  assert.deepEqual(input, before);
});

test('outline retains Mac punctuation, case and inline-label thresholds', async () => {
  const { documentOutline } = await helper;
  assert.deepEqual(documentOutline(paper([
    'Abstract. This source has a section prefix ending with a full stop.',
    'methods describe a treatment whose effects have not been measured.',
    'Abstract tiny remainder',
    'Introduction “A clear opening sentence provides the required context.',
    '١٢ Results the authors report the measurements in this section.',
    'Methods:',
    'RESULTS.',
    'A B C D E F G H I J K L M',
    'authors@example.com'
  ])), [
    { id: 4, title: 'Introduction' }, { id: 5, title: '١٢ Results' }, { id: 6, title: 'Methods:' }
  ]);
  assert.deepEqual(documentOutline(paper(['摘要', 'a short source passage.'])), [{ id: 1, title: 'Beginning' }]);
});

test('outline examines only the first nonempty line and counts Unicode graphemes', async () => {
  const { documentOutline } = await helper;
  const title = 'A\u0301'.repeat(120);
  assert.deepEqual(documentOutline(paper([
    '\r\n\u2028methods\r\nThis body remains separate from the heading.',
    'this first line is ordinary prose\nMETHODS',
    title, title + 'A'
  ])), [{ id: 1, title: 'methods' }, { id: 3, title }]);
});

test('MinerU headings take precedence, preserve IDs and have no heuristic length cap', async () => {
  const { documentOutline } = await helper;
  const longTitle = 'a custom heading '.repeat(20).trim();
  const input = { sourceMode: 'mineru', blocks: [
    { id: 2, text: 'Methods', heading: true, sourceMarkdown: 'Methods' },
    { id: 7, text: 'custom lower-case title.', heading: false, sourceMarkdown: '## custom lower-case title.' },
    { id: 9, text: longTitle, heading: true, sourceMarkdown: '# ' + longTitle },
    { id: 12, text: 'Discussion', heading: true, sourceMarkdown: 'Discussion' }
  ] };
  assert.deepEqual(documentOutline(input), [{ id: 7, title: 'custom lower-case title.' }, { id: 9, title: longTitle }]);
  assert.deepEqual(documentOutline({ ...input, sourceMode: 'pdf' }), [{ id: 2, title: 'Methods' }, { id: 12, title: 'Discussion' }]);
});

test('outline excludes resource and reference blocks and falls back to the first readable ID', async () => {
  const { documentOutline } = await helper;
  assert.deepEqual(documentOutline({ sourceMode: 'mineru', blocks: [
    { id: 1, text: '[Figure]', resource: true, sourceMarkdown: '![](figure.png)' },
    { id: 4, text: 'this paragraph has no section heading.' },
    { id: 8, text: 'References', heading: true, sourceMarkdown: '# References' },
    { id: 9, text: '[1] Smith, J. (2020). A reference article. Journal of Examples.' }
  ] }), [{ id: 4, title: 'Beginning' }]);
  assert.deepEqual(documentOutline({ blocks: [{ id: 1, text: '[Figure]', resource: true }] }), []);
  assert.deepEqual(documentOutline({ blocks: [] }), []);
  assert.deepEqual(documentOutline(null), []);
});

test('outline includes every detected section in source order, including duplicate titles', async () => {
  const { documentOutline } = await helper;
  const input = paper(Array.from({ length: 75 }, () => 'Methods'));
  assert.deepEqual(documentOutline(input), input.blocks.map(block => ({ id: block.id, title: 'Methods' })));
});
