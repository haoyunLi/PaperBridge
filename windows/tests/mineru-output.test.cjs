const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findMineruMarkdown, readMineruMarkdown, readMineruPageHints } = require('../electron/mineru-output.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-mineru-output-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return (name, content) => {
    const file = path.join(root, name);
    if (content !== undefined) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return file;
  };
}

test('MinerU selects the main Markdown over notes, fragments, hidden files and empty outputs', t => {
  const file = fixture(t);
  file('output/00-README.md', 'Auxiliary parse information'.repeat(50));
  file('output/parts/page-1.md', 'An individual page.');
  file('output/.temporary/paper.md', 'An incomplete hidden file.'.repeat(50));
  file('output/empty/paper.md', '');
  const full = file('output/parts/full_content.md', 'A combined output from an older parser.');
  const main = file('output/paper/auto/PAPER.MD', 'The primary output.');
  assert.equal(findMineruMarkdown(file('output'), 'paper'), main);
  fs.unlinkSync(main);
  assert.equal(findMineruMarkdown(file('output'), 'paper'), full);
  fs.unlinkSync(full);
  assert.equal(findMineruMarkdown(file('output'), 'paper'), file('output/00-README.md'));
  assert.equal(findMineruMarkdown(file('missing'), 'paper'), null);
});

test('MinerU figure loading tolerates literal percent signs and keeps unavailable links intact', t => {
  const file = fixture(t);
  file('output/images/figure 1.png', 'first figure');
  file('output/images/95% confidence.png', 'second figure');
  file('elsewhere.png', 'outside the export');
  const markdown = file('output/paper.md', [
    'Readable extracted body text.',
    '![First](images/figure%201.png)',
    '![Second](<images/95% confidence.png>)',
    `<table><tr><td><img alt="Signal > 95%" data-src="images/not-found.jpg" SRC = 'images/figure%201.png?mode=preview'></td></tr></table>`,
    '<img src=images/figure%201.png alt="Unquoted source">',
    '[Supporting data](images/figure%201.png)',
    '```html\n<img src="images/figure%201.png">\n```',
    '`<img src="images/figure%201.png">`',
    'Literal backtick ` before a new paragraph.',
    '',
    '[![Linked figure](images/figure%201.png)](https://example.org/figure) and an unrelated ` mark.',
    '<img-widget src="images/figure%201.png">',
    '![Unavailable](images/not-found.jpg)',
    '![Outside](../elsewhere.png)'
  ].join('\n'));
  const content = readMineruMarkdown(markdown);
  assert.ok(content.includes(`![First](data:image/png;base64,${Buffer.from('first figure').toString('base64')})`));
  assert.ok(content.includes(`![Second](<data:image/png;base64,${Buffer.from('second figure').toString('base64')}>)`));
  const first = `data:image/png;base64,${Buffer.from('first figure').toString('base64')}`;
  assert.ok(content.includes(`data-src="images/not-found.jpg" SRC = '${first}'`));
  assert.ok(content.includes(`<img src="${first}" alt="Unquoted source">`));
  assert.ok(content.includes('[Supporting data](images/figure%201.png)'));
  assert.ok(content.includes('```html\n<img src="images/figure%201.png">\n```'));
  assert.ok(content.includes('`<img src="images/figure%201.png">`'));
  assert.ok(content.includes(`[![Linked figure](${first})](https://example.org/figure)`));
  assert.ok(content.includes('<img-widget src="images/figure%201.png">'));
  assert.ok(content.includes('![Unavailable](images/not-found.jpg)'));
  assert.ok(content.includes('![Outside](../elsewhere.png)'));
  assert.ok(content.startsWith('Readable extracted body text.'));
});

test('page hints accept the companion 4.x structure or 3.x content list and keep the original page index', t => {
  const file = fixture(t);
  const markdown = file('paper.md', '# Document');
  file('structured_content.json', JSON.stringify({ pages: [
    { page_idx: 4, blocks: [{ content: 'Title', captions: [{ content: 'Figure caption' }] }, null, { type: 'text', content: 'A passage' }] },
    { page_idx: 5, blocks: [{ type: 'text', content: 'continues here.', continues_prev: true }] },
    { page_idx: -1, blocks: [{ content: 'Invalid page' }] },
    { page_idx: '5', blocks: [{ content: 'Invalid type' }] }
  ] }));
  assert.deepEqual(readMineruPageHints(markdown), [{ page: 5, text: 'Title' }, { page: 5, text: 'Figure caption' },
    { page: 5, text: 'A passage' }, { page: 6, text: 'continues here.' }, { page: 5, text: 'A passage continues here.' }]);
  file('structured_content.json', '{invalid');
  file('other_content_list.json', JSON.stringify([{ page_idx: 1, text: 'A different extraction.' }]));
  assert.deepEqual(readMineruPageHints(markdown), []);
  file('paper_content_list.json', JSON.stringify([{ page_idx: 7, text: 'Legacy source.', list_items: ['A list item'] }]));
  assert.deepEqual(readMineruPageHints(markdown), [{ page: 8, text: 'Legacy source.' }, { page: 8, text: 'A list item' }]);
});
