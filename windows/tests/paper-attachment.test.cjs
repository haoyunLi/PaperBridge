const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { keepMineruResult } = require('../electron/mineru-resources.cjs');
const { openPaperAttachment } = require('../electron/paper-attachment.cjs');

function fixture(t, legacy = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-attach-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const markdown = '# Experiment\n\n[Notes](support/notes.md)\n';
  const id = createHash('sha256').update(markdown).digest('hex');
  const source = legacy ? path.join(root, 'mineru', id, 'auto') : path.join(root, 'input');
  fs.mkdirSync(path.join(source, 'support'), { recursive: true });
  fs.writeFileSync(path.join(source, 'paper.md'), markdown);
  fs.writeFileSync(path.join(source, 'support', 'notes.md'), '![Panel](../plot.jpg)\n');
  fs.writeFileSync(path.join(source, 'plot.jpg'), Buffer.from([255, 216, 255, 217]));
  fs.writeFileSync(path.join(source, 'reference.pdf'), '%PDF-1.4\n');
  fs.writeFileSync(path.join(source, 'tool.cmd'), 'sample');
  const paper = { id, mineruMarkdown: markdown };
  if (!legacy) paper.mineruResourceId = keepMineruResult(root, id, path.join(source, 'paper.md'), markdown);
  const opened = [];
  const open = (href, from = '', handoff = file => { opened.push(file); return ''; }) => openPaperAttachment(root, paper, href, from, handoff);
  return { paper, open, opened };
}

for (const legacy of [false, true]) {
  test('Reading attachments from ' + (legacy ? 'an older MinerU workspace' : 'a retained paper resource set'), async t => {
    const { open, opened } = fixture(t, legacy);
    const notes = await open('support/notes.md#plot');
    assert.equal(notes.fragment, '#plot');
    assert.match(notes.content, /data:image\/jpeg;base64,/);
    assert.equal((await open('../reference.pdf', notes.path)).kind, 'pdf');
    assert.equal(path.basename(opened[0]), 'reference.pdf');
    assert.equal(opened.length, 1);
  });
}

test('Unavailable attachments leave the paper open and report the reason', async t => {
  const { paper, open, opened } = fixture(t);
  await assert.rejects(open('missing.pdf'), /missing from the saved paper/);
  await assert.rejects(open('../outside.pdf'), /outside the saved paper/);
  await assert.rejects(open('tool.cmd'), /cannot preview/);
  await assert.rejects(open('notes.md', 'outside.exe'), /Invalid paper attachment/);
  await assert.rejects(open('reference.pdf', '', () => 'No application is associated with this file.'), /Windows could not open the PDF/);
  paper.mineruMarkdown += 'Changed workspace';
  await assert.rejects(open('reference.pdf'), /no saved attachment folder/);
  assert.deepEqual(opened, []);
});
