const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findMineruMarkdown, readMineruMarkdown } = require('../electron/mineru-output.cjs');

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
  assert.ok(content.includes('![Unavailable](images/not-found.jpg)'));
  assert.ok(content.includes('![Outside](../elsewhere.png)'));
  assert.ok(content.startsWith('Readable extracted body text.'));
});
