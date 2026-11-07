const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crc32, deflateRawSync } = require('node:zlib');
const { findMineruMarkdown, readMineruMarkdown, readMineruPageHints, unpackMineruArchive } = require('../electron/mineru-output.cjs');
const { keepMineruResult, findPaperMineruMarkdown, removeMineruResult } = require('../electron/mineru-resources.cjs');
const { writeBundle } = require('../electron/bundle.cjs');

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

function archive(entries) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const { name, content, deflated = false, uncompressedSize, mode = 0o100644 } of entries) {
    const filename = Buffer.from(name);
    const source = Buffer.from(content);
    const bytes = deflated ? deflateRawSync(source) : source;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 file names.
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt32LE(crc32(source), 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(uncompressedSize ?? source.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4); // Unix permissions and file type.
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes);
    directory.push(central, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test('MinerU 4.x ZIP keeps referenced attachments through saved resources and portable export', async t => {
  const file = fixture(t);
  const id = 'd'.repeat(64);
  const csv = Buffer.from('method,score\nA,42\n');
  const supplement = 'Supplementary material\n'.repeat(50);
  const markdown = [
    '# Main result',
    '[Measurements](./data/%E8%AF%95%E9%AA%8C%20results.csv?view=table#rows)',
    '[Appendix](supplements/paper.md)',
    '<img src="figures/panel%201.png">',
    '[Code only](https://example.org) `[Hidden](data/ignored.csv)`',
    '[Duplicate](data/duplicate.csv) [Device](data/CON.txt)',
    '[Link](data/symlink.csv) [Reserved](.paperbridge-result.json)',
    '[Escape](%2e%2e%2foutside.csv)'
  ].join('\n\n');
  const zip = file('parser.zip', archive([
    { name: 'data/试验 results.csv', content: csv, deflated: true },
    { name: 'supplements/paper.md', content: supplement },
    { name: 'figures/panel 1.png', content: 'Figure bytes' },
    { name: 'images/standard.png', content: 'Standard MinerU figure' },
    { name: 'data/ignored.csv', content: 'Unreferenced bytes' },
    { name: 'data/duplicate.csv', content: 'One candidate' },
    { name: 'data/Duplicate.csv', content: 'Conflicting candidate' },
    { name: 'data/CON.txt', content: 'Reserved device path' },
    { name: 'data/symlink.csv', content: '../outside.csv', mode: 0o120777 },
    { name: '.paperbridge-result.json', content: 'Reserved application marker' },
    { name: 'structured_content.json', content: '{"pages":[{"page_idx":4,"blocks":[{"content":"Main result"}]}]}' },
    { name: 'markdown.md', content: markdown }
  ]));
  file('outside.csv', 'Do not change');
  const source = await unpackMineruArchive(zip, file('result'), () => {});
  assert.equal(source, file('result/markdown.md'));
  assert.equal(fs.readFileSync(source, 'utf8'), markdown);
  assert.deepEqual(fs.readdirSync(file('result/data')), ['试验 results.csv']);
  assert.equal(fs.readFileSync(file('outside.csv'), 'utf8'), 'Do not change');
  assert.equal(fs.existsSync(file('result/.paperbridge-result.json')), false);
  assert.equal(fs.readFileSync(file('result/images/standard.png'), 'utf8'), 'Standard MinerU figure');
  const embedded = readMineruMarkdown(source);
  const mineruResourceId = keepMineruResult(file(''), id, source, embedded);
  const restored = findPaperMineruMarkdown(file(''), { id, mineruResourceId, mineruMarkdown: embedded });
  assert.deepEqual(readMineruPageHints(restored), [{ page: 5, text: 'Main result' }]);
  const bundle = writeBundle(file(''), { name: 'Kit', type: 'text', sourceMode: 'mineru' },
    [{ kind: 'original', name: 'Original', filename: 'paper_original.md', content: embedded }], null, path.dirname(restored));
  const original = fs.readFileSync(path.join(bundle.folder, 'paper_original.md'), 'utf8');
  const measurements = original.match(/\[Measurements\]\((assets\/[^?]+\.csv)\?view=table#rows\)/)?.[1];
  const appendix = original.match(/\[Appendix\]\((assets\/[^)]+\.md)\)/)?.[1];
  assert.ok(measurements && appendix);
  assert.deepEqual(fs.readFileSync(path.join(bundle.folder, measurements)), csv);
  assert.equal(fs.readFileSync(path.join(bundle.folder, appendix), 'utf8'), supplement);
  assert.equal(bundle.assets, 3);
  assert.ok(bundle.missingAssetPaths.includes('.paperbridge-result.json'));
});

test('MinerU ZIP skips oversized optional files and removes an attachment interrupted during extraction', async t => {
  const file = fixture(t);
  const markdown = '[Too large](large.bin) and [Data](data/result.csv)';
  const zip = file('parser.zip', archive([
    { name: 'markdown.md', content: markdown },
    { name: 'large.bin', content: 'declared too large', deflated: true, uncompressedSize: 256 * 1024 * 1024 + 1 },
    { name: 'data/result.csv', content: Buffer.alloc(512 * 1024, 0x61) }
  ]));
  const cancelledFile = file('cancelled/data/result.csv');
  const cancelled = new Error('Parsing cancelled');
  let interrupted = false;
  await assert.rejects(unpackMineruArchive(zip, file('cancelled'), () => {
    interrupted ||= fs.existsSync(cancelledFile) && fs.statSync(cancelledFile).size > 0;
    if (interrupted) throw cancelled;
  }), error => error === cancelled);
  assert.equal(fs.existsSync(cancelledFile), false);
  const source = await unpackMineruArchive(zip, file('retry'), () => {});
  assert.equal(fs.readFileSync(source, 'utf8'), markdown);
  assert.equal(fs.existsSync(file('retry/large.bin')), false);
  assert.equal(fs.statSync(file('retry/data/result.csv')).size, 512 * 1024);
});

test('MinerU ZIP refuses archive paths outside staging and ambiguous primary Markdown', async t => {
  const file = fixture(t);
  const escaped = file('escaped.zip', archive([
    { name: 'markdown.md', content: '# Main' },
    { name: '../outside.txt', content: 'must not be written' }
  ]));
  await assert.rejects(unpackMineruArchive(escaped, file('escaped'), () => {}), /invalid relative path/);
  assert.equal(fs.existsSync(file('outside.txt')), false);
  const duplicate = file('duplicate.zip', archive([
    { name: 'markdown.md', content: '# Main' },
    { name: 'Markdown.md', content: '# Other main' }
  ]));
  await assert.rejects(unpackMineruArchive(duplicate, file('duplicate'), () => {}), /without a unique Markdown file/);
  assert.equal(fs.existsSync(file('duplicate')), false);
});

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

test('saved MinerU generations keep their own attachments and page hints even with identical Markdown', t => {
  const file = fixture(t);
  const id = 'a'.repeat(64);
  const markdown = '# A paper\n\nRead the [measurements](tables/result.csv#rows).';
  const old = file('pipeline/paper/auto/paper.md', markdown);
  file('pipeline/paper/auto/tables/result.csv', 'previous bytes');
  file('pipeline/paper/auto/paper_content_list.json', '[{"page_idx":1,"text":"A paper"}]');
  const latest = file('kit/paper.md', markdown);
  file('kit/tables/result.csv', 'current bytes');
  file('kit/structured_content.json', '{"pages":[{"page_idx":4,"blocks":[{"content":"A paper"}]}]}');
  const oldId = keepMineruResult(file(''), id, old, markdown);
  const currentId = keepMineruResult(file(''), id, latest, markdown);
  const paper = { id, mineruMarkdown: markdown };
  const previous = findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: oldId });
  const current = findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: currentId });
  assert.notEqual(previous, current);
  assert.equal(fs.readFileSync(path.join(path.dirname(previous), 'tables/result.csv'), 'utf8'), 'previous bytes');
  assert.equal(fs.readFileSync(path.join(path.dirname(current), 'tables/result.csv'), 'utf8'), 'current bytes');
  assert.equal(readMineruPageHints(previous)[0].page, 2);
  assert.equal(readMineruPageHints(current)[0].page, 5);
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, id: 'b'.repeat(64), mineruResourceId: currentId }), null);
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, mineruMarkdown: 'Different paper', mineruResourceId: currentId }), null);
  fs.appendFileSync(current, ' changed');
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: currentId }), null);
  removeMineruResult(file(''), currentId);
  assert.equal(fs.existsSync(path.dirname(current)), false);
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: oldId }), previous);
});

test('legacy MinerU assets require a unique match with the saved Markdown', t => {
  const file = fixture(t);
  const id = 'c'.repeat(64);
  const old = file(`mineru/${id}/pipeline/paper.md`, '# An older and longer extraction\n'.repeat(20));
  const markdown = '# Current text\n\n![Preview](images/preview.png)';
  const current = file(`mineru/${id}/kit/paper.md`, markdown);
  file(`mineru/${id}/kit/images/preview.png`, 'current image');
  const paper = { id, mineruMarkdown: readMineruMarkdown(current) };
  assert.equal(findMineruMarkdown(file(`mineru/${id}`), 'paper'), old);
  assert.equal(findPaperMineruMarkdown(file(''), paper), current);
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: null }), null);
  assert.equal(findPaperMineruMarkdown(file(''), { ...paper, mineruResourceId: '../kit' }), null);
  file(`mineru/${id}/older-kit/paper.md`, markdown);
  file(`mineru/${id}/older-kit/images/preview.png`, 'current image');
  assert.equal(findPaperMineruMarkdown(file(''), paper), null);
});
