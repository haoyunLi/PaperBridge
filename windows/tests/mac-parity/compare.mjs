import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimsMarkdown, parseSummaryClaims, summarySourceBatches, referenceBlockIds, sectionRanges, overviewSectionIds, qualityIssues, mergeBlocks, reflowBlock } from '../../src/paper.mjs';
import { blocksFromText, isHeading, practiceParagraphs, readingMap } from '../../src/text.mjs';
import { stitchPageBlocks } from '../../src/pdfDecorations.mjs';
import { createHash } from 'node:crypto';
import { filteredReaderBlocks } from '../../src/textSearch.mjs';
import { planConnectedBatches } from '../../src/connectedTranslation.mjs';
import { protectMarkdown, restoreMarkdown } from '../../src/prompts.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const searchBlocks = fixtures.readerSearch.blocks.map(({ source, translation }, index) => ({ id: index + 1, text: source, translation }));
assert.deepEqual(fixtures.readerSearch.queries.map(query => filteredReaderBlocks(searchBlocks, query).map(block => block.id)),
  reference.readerSearch, 'Search the source and translation independently, using native case and accent boundaries');
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

const consolidation = fixtures.summaryConsolidation;
const evidenceBlocks = consolidation.paragraphs.map((text, i) => ({ id: i + 1, text }));
const excerpts = parseSummaryClaims(JSON.stringify(consolidation.excerpt), evidenceBlocks);
const merged = parseSummaryClaims(JSON.stringify(consolidation.merge), evidenceBlocks, excerpts.flatMap(claim => claim.sources));
assert.deepEqual([excerpts, merged].map(stage => ({
  numbered: claimsMarkdown(stage), sources: stage.map(claim => claim.sources)
})), reference.summaryStages, 'Numbered summary and evidence after extraction and consolidation');
assert.deepEqual(merged.map(claim => claim.sources.map(source => source.paragraphID)), [[2, 1], [], [3], []]);
assert.equal(reference.summaryEvidence.length, fixtures.summaryEvidence.length);
for (const [index, fixture] of fixtures.summaryEvidence.entries()) {
  const text = fixture.source.repeat(fixture.repeat ?? 1);
  const quote = fixture.quote.repeat(fixture.repeat ?? 1);
  const output = JSON.stringify({ claims: [{ text: 'Study result', sources: [{ paragraphID: 1, quote }] }] });
  const [claim] = parseSummaryClaims(output, [{ id: 1, text }]);
  assert.deepEqual(claim.sources.map(source => source.quote.normalize('NFC')),
    reference.summaryEvidence[index].map(q => q.normalize('NFC')), fixture.name);
  assert.deepEqual(claim.sources, fixture.valid ? [{ paragraphID: 1, quote: text }] : [], fixture.name);
}
assert.equal(reference.summaryBatches.length, fixtures.summaryBatches.length);
for (const [index, { name, paragraphs }] of fixtures.summaryBatches.entries()) {
  const blocks = paragraphs.map(({ text, repeat = 1, prefix = '', suffix = '' }, i) => ({ id: i + 1, text: prefix + text.repeat(repeat) + suffix }));
  const rendered = summarySourceBatches(blocks).map(batch => batch.map(block => `[P${block.id}]\n${block.text}`).join('\n\n'));
  assert.deepEqual(rendered, reference.summaryBatches[index], name);
}

const connectedSources = paragraphs => planConnectedBatches(paragraphs.map((text, i) => ({ id: i + 1, text }))).map(batch => batch.source);
assert.equal(reference.connectedBatches.length, fixtures.connectedBatches.length);
for (const [index, { name, paragraphs }] of fixtures.connectedBatches.entries()) {
  const text = paragraphs.map(({ text, repeat = 1, prefix = '', suffix = '' }) => prefix + text.repeat(repeat) + suffix);
  assert.deepEqual(connectedSources(text), reference.connectedBatches[index], name);
}
const published = reference.publishedPaper;
const publishedBytes = readFileSync(new URL('./emcee-v3.pdf', import.meta.url));
assert.equal(createHash('sha256').update(publishedBytes).digest('hex'), published.sha256);
assert.ok(published.paragraphs.join(' ').includes('emcee') && published.paragraphs.length > 5);
assert.deepEqual(connectedSources(published.paragraphs), published.batches, 'All full-translation batches for the same native-extracted journal article');
console.log(`Verified ${fixtures.connectedBatches.length} full-translation cases and all ${published.batches.length} batches of the ${published.paragraphs.length}-paragraph emcee paper against macOS.`);

assert.equal(reference.bibliographies.length, fixtures.bibliographies.length);
for (const [index, fixture] of fixtures.bibliographies.entries()) {
  const blocks = blocksFromText(fixture.paragraphs.join('\n\n'));
  const excluded = referenceBlockIds(blocks);
  assert.deepEqual([...excluded], fixture.referenceIds, fixture.name);
  assert.deepEqual({
    body: blocks.filter(block => !excluded.has(block.id)).map(block => block.text),
    references: blocks.filter(block => excluded.has(block.id)).map(block => block.text)
  }, reference.bibliographies[index], fixture.name);
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

assert.equal(reference.pageBoundaries.length, fixtures.pageBoundaries.length);
for (const [index, { name, left, right, windowsText }] of fixtures.pageBoundaries.entries()) {
  const actual = stitchPageBlocks([left, right].map((text, page) => ({ text, page: page + 1, heading: isHeading(text) })));
  const native = reference.pageBoundaries[index];
  assert.equal(actual.length, native.length, name + ' segmentation');
  assert.deepEqual(actual.map(block => block.text), windowsText ? [windowsText] : native, name);
  assert.deepEqual(actual.map(block => [block.page, block.endPage ?? block.page]),
    native.length === 1 ? [[1, 2]] : [[1, 1], [2, 2]], name + ' provenance');
}

const restored = fixtures.markdown.map(source => {
  const { text, tokens } = protectMarkdown(source);
  return restoreMarkdown(text.replaceAll('Before', '前文').replaceAll('After', '后文'), tokens);
});
assert.deepEqual(restored, reference.markdown);
assert.deepEqual(restored, fixtures.markdown.map(source => source.replaceAll('Before', '前文').replaceAll('After', '后文')));
console.log(`Checked ${reference.summaryEvidence.length} summary citations, ${reference.summaryBatches.length} summary batch fixtures, ${papers.length} papers, ${fixtures.bibliographies.length} bibliography boundaries, ${restored.length} translations, ${fixtures.merges.length} merges, ${fixtures.reflows.length} reflows and ${fixtures.pageBoundaries.length} page boundaries against native macOS. ${preservedWindowsJoins} joins preserved Windows scientific punctuation.`);
