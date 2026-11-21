import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sectionRanges, overviewSectionIds, qualityIssues, mergeBlocks, reflowBlock } from '../../src/paper.mjs';
import { blocksFromText, practiceParagraphs, readingMap } from '../../src/text.mjs';
import { protectMarkdown, restoreMarkdown } from '../../src/prompts.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const practice = blocksFromText(practiceParagraphs.join('\n\n'));
assert.deepEqual(practice.map(block => block.text), reference.practice, 'Built-in practice paper text and segmentation');
const papers = [...fixtures.papers, { name: 'built-in practice', blocks: practice }];
assert.deepEqual(reference.papers.map(paper => paper.name), papers.map(paper => paper.name));
for (const [index, fixture] of papers.entries()) {
  const blocks = fixture.blocks.map((block, index) => ({ ...block, id: index + 1 }));
  const sections = sectionRanges(blocks);
  const actual = {
    name: fixture.name,
    sections,
    overview: overviewSectionIds(sections),
    guide: readingMap(blocks, sections),
    issues: qualityIssues(blocks).map(({ id, reason }) => ({ id, reason }))
  };
  assert.deepEqual(actual, reference.papers[index], fixture.name);
}

assert.equal(reference.merges.length, fixtures.merges.length);
let preservedWindowsJoins = 0;
for (const [index, { name, left, right, windowsText, marks = [] }] of fixtures.merges.entries()) {
  const source = (text, id) => ({ text, notes: marks.filter(mark => mark.paragraph === id).map(mark =>
    ({ text: mark.quote, offset: mark.offset, body: mark.body, kind: mark.translation ? 'translation' : 'source' })) });
  const merged = mergeBlocks(source(left, 1), source(right, 2));
  const actual = merged.text;
  const notes = marks.map(mark => {
    const note = merged.notes.find(note => note.body === mark.body);
    return { paragraph: 1, quote: note.text, offset: note.offset, body: note.body, review: Boolean(note.needsReview) };
  });
  assert.deepEqual(notes, reference.annotations[index], name + ' annotations');
  if (windowsText !== undefined) {
    assert.equal(actual, windowsText, name);
    if (actual !== reference.merges[index]) {
      preservedWindowsJoins++;
      console.log(`${name}: macOS ${JSON.stringify(reference.merges[index])}, Windows ${JSON.stringify(actual)}`);
    }
  } else assert.equal(actual, reference.merges[index], name);
}
assert.equal(reference.reflows.length, fixtures.reflows.length);
for (const [index, { name, text, target }] of fixtures.reflows.entries()) {
  assert.deepEqual(reflowBlock({ text }, target).map(block => block.text), reference.reflows[index], name);
}

const restored = fixtures.markdown.map(source => {
  const { text, tokens } = protectMarkdown(source);
  return restoreMarkdown(text.replaceAll('Before', '前文').replaceAll('After', '后文'), tokens);
});
assert.deepEqual(restored, reference.markdown);
assert.deepEqual(restored, fixtures.markdown.map(source => source.replaceAll('Before', '前文').replaceAll('After', '后文')));
console.log(`Checked ${papers.length} papers, ${restored.length} translations, ${fixtures.merges.length} merges and ${fixtures.reflows.length} reflows against native macOS. ${preservedWindowsJoins} joins preserved Windows scientific punctuation.`);
