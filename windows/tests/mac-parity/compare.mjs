import assert from 'node:assert/strict';
import { verifyJournalAnalysis } from './journal-analysis.mjs';
import { verifyPDFJournal } from './pdf-journal.mjs';
import { verifyJournalDraft } from './journal-draft.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../../electron/storage.cjs';
import { applyUndoEntry, createUndoEntry, recordUndoEntry } from '../../src/paperUndo.mjs';
import { libraryLabel } from '../../electron/library-metadata.mjs';
import { writeBundle } from '../../electron/bundle.cjs';
import { claimsMarkdown, parseSummaryClaims, summarySourceBlocks, summarySourceBatches, referenceBlockIds, sectionRanges, overviewSectionIds, qualityIssues, mergeBlocks, reflowBlock } from '../../src/paper.mjs';
import { blocksFromText, chunkText, isHeading, practiceParagraphs, readingMap } from '../../src/text.mjs';
import { stitchPageBlocks } from '../../src/pdfDecorations.mjs';
import { createHash } from 'node:crypto';
import { markdownAnnotationOffset } from '../../src/markdownAnchors.mjs';
import { filteredReaderBlocks } from '../../src/textSearch.mjs';
import { planConnectedBatches } from '../../src/connectedTranslation.mjs';
import { protectMarkdown, restoreMarkdown } from '../../src/prompts.mjs';
import { parsedMarkdownBlocks } from '../../src/academicMarkdown.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bundleFixture = JSON.parse(readFileSync(new URL('./bundle-fixture.json', import.meta.url), 'utf8'));
const work = mkdtempSync(path.join(os.tmpdir(), 'paperbridge-native-bundle-'));
try {
  verifyJournalDraft(reference.journalDraft, work);
  verifyPDFJournal(reference.pdfJournal, work);
  verifyJournalAnalysis(reference.journalAnalysis);
  const libraryRoot = path.join(work, 'library');
  const store = createStore(libraryRoot);
  const first = 'a'.repeat(64), recent = 'b'.repeat(64);
  for (const [index, id] of [first, recent].entries()) {
    store.savePaper({ id, name: 'Paper', blocks: Array.from({ length: 7 + index }, () => ({ text: 'Paragraph' })) });
  }
  store.markPaperOpened(recent);
  renameSync(path.join(libraryRoot, 'papers'), path.join(libraryRoot, 'unavailable-papers'));
  const listed = store.list();
  assert.deepEqual(listed.map(entry => entry.id), reference.library.ids);
  assert.deepEqual(listed.map(entry => entry.blockCount), reference.library.counts);
  const edits = JSON.parse(readFileSync(new URL('./library-labels.json', import.meta.url), 'utf8'));
  const labels = edits.map(({ name, title, tags }) => {
    const label = libraryLabel(title, tags.join(', '));
    store.updateLibraryMetadata({ id: first, title: label.libraryTitle, tags: label.tags });
    const entry = createStore(libraryRoot).list().find(item => item.id === first);
    return { name, title: entry.name, tags: entry.tags };
  });
  assert.deepEqual(labels, reference.library.labels, 'Index-only library edits and Unicode tag order match native macOS');
  const extraction = path.join(work, 'extraction');
  const files = {
    'supplements/guide.md': bundleFixture.guide,
    'data/measurements.csv': bundleFixture.csv,
    'data/wrapped.csv': bundleFixture.csv,
    'figures/wrapped.png': Buffer.from(bundleFixture.imageBase64, 'base64'),
    'figures/response.png': Buffer.from(bundleFixture.imageBase64, 'base64')
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(extraction, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const documents = Object.entries(bundleFixture.documents).map(([filename, content]) => ({ filename, content }));
  const result = writeBundle(work, { name: 'Calibration', sourceMode: 'mineru' }, documents, null, extraction);
  const moved = path.join(work, 'Moved journal bundle');
  renameSync(result.folder, moved);
  const { wrapped: wrappedHashes, literalDocument, ...expectedBundle } = reference.bundle;
  if (literalDocument) {
    const authored = readFileSync(new URL('./literal-asset-examples.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(literalDocument, authored, 'The native portable document kept the example source');
    const examples = writeBundle(work, { name: 'Calibration code examples' }, [
      { filename: 'examples.md', content: authored }
    ], null, extraction);
    const saved = readFileSync(path.join(examples.folder, 'examples.md'), 'utf8');
    const printed = authored.slice(authored.indexOf('    ![Example'), authored.indexOf('![Measured response]'));
    assert.ok(saved.includes(printed), 'The Windows portable document kept the same literal paths and spacing');
    assert.equal(examples.assets, 2);
  }
  assert.deepEqual(Object.keys(wrappedHashes).sort(), ['data/wrapped.csv', 'figures/wrapped.png']);
  const wrappedDocument = readFileSync(path.join(moved, 'paper_wrapped.md'), 'utf8');
  let expectedMarkdown = bundleFixture.documents['paper_wrapped.md'];
  for (const [relative, macHash] of Object.entries(wrappedHashes)) {
    const exported = 'assets/source/' + relative;
    const bytes = readFileSync(path.join(moved, exported));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), macHash, relative);
    expectedMarkdown = expectedMarkdown.replace(relative, exported);
  }
  assert.equal(wrappedDocument, expectedMarkdown, 'Wrapped captions, titles and line endings survive relocation');
  for (const edition of ['paper_original.md', 'paper_bilingual_en_zh.md']) {
    const main = readFileSync(path.join(moved, edition), 'utf8');
    const guidePath = path.join(moved, main.match(/\[Supplement\]\(([^#)]+)#calibration\)/)[1]);
    const guide = readFileSync(guidePath, 'utf8');
    const targets = {};
    for (const [, relative] of guide.matchAll(/\]\(([^)?#]+)(?:[?#][^)]*)?\)/g)) {
      const bytes = readFileSync(path.resolve(path.dirname(guidePath), relative));
      targets[path.posix.join('supplements', relative)] = createHash('sha256').update(bytes).digest('hex');
    }
    assert.deepEqual({ copied: result.assets, missing: result.missingAssetPaths, guide, targets }, expectedBundle, edition);
  }
  console.log('Verified relocated supplement links and file contents against the native macOS export.');
} finally {
  assert.equal(path.dirname(work), path.resolve(os.tmpdir()));
  rmSync(work, { recursive: true, force: true });
}
const pasted = new Map(fixtures.pastedFrontMatter.map(({ name, text }, index) => {
  const win = blocksFromText(text).map(block => block.text);
  assert.equal(win.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '), name + ' retains the printed text');
  return [name, { win, mac: reference.pastedFrontMatter[index] }];
}));
assert.equal(pasted.size, reference.pastedFrontMatter.length);
for (const name of ['scientific title containing numerals', 'single line breaks from the clipboard', 'single physical newlines']) {
  assert.deepEqual(pasted.get(name).win, pasted.get(name).mac, name);
}
const inlineMethods = pasted.get('heading with body in a single paragraph');
assert.equal(inlineMethods.win.length, 2);
assert.equal(inlineMethods.win[0], inlineMethods.mac[0]);
assert.ok(inlineMethods.win[1].startsWith('2 Methods '));
assert.equal(inlineMethods.win[1].slice(2), inlineMethods.mac[1].replace(/^2\s+/, '').replace('\n', ' '));
const citation = pasted.get('printed reference heading before first citation');
assert.equal(citation.win.length, 2);
assert.equal(citation.win[0], citation.mac[0]);
assert.ok(citation.win[1].startsWith('[1]') && citation.win[1].endsWith('.'));
assert.equal(citation.win[1].replace(/^\[|\.$/g, ''), citation.mac[1].replace(/^\[|\.$/g, ''));
for (const name of ['joined title and names', 'separate names and numbered affiliations', 'isolated section heading between sentences']) {
  const { win, mac } = pasted.get(name);
  assert.ok(mac.at(-1).split('\n').at(-1) === win.at(-1), name + ' preserves the same following body sentence');
}
console.log('Compared eight clipboard layouts with native macOS and checked the original numbering and citation punctuation.');
const searchBlocks = fixtures.readerSearch.blocks.map(({ source, translation }, index) => ({ id: index + 1, text: source, translation }));
assert.deepEqual(fixtures.readerSearch.queries.map(query => filteredReaderBlocks(searchBlocks, query).map(block => block.id)),
  reference.readerSearch, 'Search the source and translation independently, using native case and accent boundaries');
console.log(`Verified ${fixtures.readerSearch.queries.length} Reader queries against native macOS search.`);
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
    issues: qualityIssues(blocks).map(({ id, reason, excerpt }) => ({ id, reason, excerpt }))
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
function taggedSummaryBatches(blocks) {
  return summarySourceBatches(blocks).map(batch => batch.map(block => `[P${block.id}]\n${block.text}`).join('\n\n'));
}
assert.equal(reference.summaryBatches.length, fixtures.summaryBatches.length);
for (const [index, { name, paragraphs }] of fixtures.summaryBatches.entries()) {
  const blocks = paragraphs.map(({ text, repeat = 1, prefix = '', suffix = '' }, i) => ({ id: i + 1, text: prefix + text.repeat(repeat) + suffix }));
  assert.deepEqual(taggedSummaryBatches(blocks), reference.summaryBatches[index], name);
}

const connectedSources = paragraphs => planConnectedBatches(paragraphs.map((text, i) => ({ id: i + 1, text }))).map(batch => batch.source);
assert.equal(reference.connectedBatches.length, fixtures.connectedBatches.length);
for (const [index, { name, paragraphs }] of fixtures.connectedBatches.entries()) {
  const text = paragraphs.map(({ text, repeat = 1, prefix = '', suffix = '' }) => prefix + text.repeat(repeat) + suffix);
  assert.deepEqual(connectedSources(text), reference.connectedBatches[index], name);
}
const published = reference.publishedPaper;
{
  const blocks = published.paragraphs.map((text, index) => ({ id: index + 1, text, notes: [] }));
  const note = { id: 'note', kind: 'source', text: blocks[0].text.slice(0, 12), offset: 0, body: 'Check this passage' };
  const before = { id: published.sha256, blocks: [{ ...blocks[0], notes: [note] }, ...blocks.slice(1)] };
  const deleted = { ...before, blocks };
  const bookmarked = { ...deleted, blocks: blocks.map((block, i) => i === 1 ? { ...block, bookmark: true } : block) };
  const history = [createUndoEntry(before, deleted), createUndoEntry(deleted, bookmarked)];
  const restored = applyUndoEntry(bookmarked, history.findLast(entry => entry.type === 'annotations'));
  const index = blocks.findIndex((block, i) => i >= 2 && [...block.text].length > 150 && block.text.includes('. '));
  assert.ok(index >= 2);
  const edited = restored.blocks[index];
  const cut = edited.text.indexOf('. ') + 1;
  const pieces = [edited.text.slice(0, cut), edited.text.slice(cut).trim()].map(text => ({ ...edited, text }));
  const split = { ...restored, blocks: restored.blocks.toSpliced(index, 1, ...pieces).map((block, i) => ({ ...block, id: i + 1 })) };
  const structure = createUndoEntry(restored, split);
  const afterSplit = recordUndoEntry(history, structure);
  const laterDeletion = { ...split, blocks: [{ ...split.blocks[0], notes: [] }, ...split.blocks.slice(1)] };
  const result = applyUndoEntry(laterDeletion, structure);
  // The desktop test compares highlightColors and restoredColor by operating the Inspector.
  const { highlightColors, restoredColor, ...annotationUndo } = published.annotationUndo;
  assert.deepEqual({
    noteRestored: restored.blocks[0].notes[0]?.body === note.body, bookmarkKept: restored.blocks[1].bookmark,
    shiftedQuote: markdownAnnotationOffset('🔎 ' + blocks[0].text, note) ?? -1,
    ambiguousQuote: markdownAnnotationOffset('🔎 ' + note.text + ' ' + note.text, note) ?? -1,
    missingQuote: markdownAnnotationOffset('', note) ?? -1,
    splitCount: split.blocks.length, annotationUndoAfterSplit: afterSplit.some(entry => entry.type === 'annotations'),
    restoredSources: result.blocks.every((block, i) => block.text === published.paragraphs[i]) && result.blocks.length === published.paragraphs.length,
    laterDeletionKept: !result.blocks[0].notes.length, reopenedBookmark: result.blocks[1].bookmark
  }, annotationUndo);
}
const publishedBytes = readFileSync(new URL('./emcee-v3.pdf', import.meta.url));
assert.equal(createHash('sha256').update(publishedBytes).digest('hex'), published.sha256);
assert.ok(published.paragraphs.join(' ').includes('emcee') && published.paragraphs.length > 5);
const nativeBlocks = published.paragraphs.map((text, i) => ({ id: i + 1, text }));
assert.deepEqual(taggedSummaryBatches(nativeBlocks), published.summaryBatches, 'Exact summary inputs and source IDs for the native-extracted journal article');
for (const { limit, chunks } of published.paragraphChunks) {
  assert.deepEqual(published.paragraphs.map(text => chunkText(text, limit)), chunks,
    'Per-paragraph translation of the native-extracted emcee paper at ' + limit + ' characters');
}
assert.deepEqual(connectedSources(published.paragraphs), published.batches, 'All full-translation batches for the same native-extracted journal article');
console.log(`Verified ${fixtures.connectedBatches.length} full-translation cases and all ${published.batches.length} batches of the ${published.paragraphs.length}-paragraph emcee paper against macOS.`);

for (const [index, source] of fixtures.resourceBoundaries.entries()) {
  const blocks = parsedMarkdownBlocks(source);
  assert.deepEqual(blocks.map(block => ({
    kind: ({ html: 'rawHTML', list: 'listItem' })[block.markdownKind] ?? block.markdownKind, source: block.sourceMarkdown
  })), reference.resourceBoundaries[index], 'MinerU resource boundaries and following text, fixture ' + index);
}
const notationBlocks = parsedMarkdownBlocks(fixtures.scientificNotation.join('\n\n'));
assert.deepEqual(summarySourceBlocks(notationBlocks).map(block => block.text), reference.scientificNotation,
  'Scientific identifiers in newly imported MinerU paragraphs match native Mac summary sources');
const legacyNotation = notationBlocks.map(block => ({ ...block, text: block.text.replace(/[#*_]/g, '') }));
assert.deepEqual(summarySourceBlocks(legacyNotation).map(block => block.text), reference.scientificNotation,
  'Reading an earlier MinerU workspace recovers the same identifiers without changing its saved offsets');

const structuredText = readFileSync(new URL('./emcee-v3-mineru.md', import.meta.url), 'utf8');
const structuredSource = summarySourceBlocks(parsedMarkdownBlocks(structuredText));
assert.deepEqual(structuredSource.filter(block => block.heading).map(block => block.text), reference.structuredJournal.headings,
  'All body headings from the same MinerU paper appear in summary source order');
const nativeJournal = reference.structuredJournal;
assert.equal(structuredSource.length, nativeJournal.body.length);
assert.deepEqual(sectionRanges(structuredSource), nativeJournal.translationRanges,
  'The MinerU journal has the same named ranges and paragraph membership as the native Mac paper');
const byline = structuredSource.find(block => block.text.startsWith('Daniel Foreman-Mackey'));
assert.ok(byline, 'Numbered author byline is included in the summary');
const nativeByline = nativeJournal.body[byline.id - 1];
// Windows keeps the printed affiliation numbers attached to names. Native Markdown plaintext inserts spaces around superscripts.
assert.equal(byline.text.replace(/\s/g, ''), nativeByline.replace(/\s/g, ''));
const taggedByline = text => `[P${byline.id}]\n${text}`;
assert.deepEqual(taggedSummaryBatches(structuredSource), nativeJournal.summaryBatches.map(batch =>
  batch.replace(taggedByline(nativeByline), taggedByline(byline.text))), 'All MinerU journal passages and Reader IDs in the summary input');

if (reference.longBibliographies) {
  assert.deepEqual(reference.longBibliographies.map(sample => sample.references.length), [1, 2]);
  for (const sample of reference.longBibliographies) {
    const blocks = sample.paragraphs.map((text, index) => ({ id: index + 1, text }));
    const excluded = referenceBlockIds(blocks);
    assert.deepEqual(blocks.filter(block => excluded.has(block.id)).map(block => block.text), sample.references);
    assert.deepEqual(summarySourceBlocks(blocks).map(block => block.text), sample.body);
  }
}
assert.equal(reference.bibliographies.length, fixtures.bibliographies.length);
for (const [index, fixture] of fixtures.bibliographies.entries()) {
  const blocks = blocksFromText(fixture.paragraphs.join('\n\n'));
  const excluded = referenceBlockIds(blocks);
  assert.deepEqual([...excluded], fixture.referenceIds, fixture.name);
  assert.deepEqual(summarySourceBlocks(blocks).map(block => block.text), reference.bibliographies[index].body,
    fixture.name + ' summary includes all headings outside the reference section');
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
for (const [index, { name, text, target, windowsParagraphs }] of fixtures.reflows.entries()) {
  const actual = reflowBlock({ text }, target).map(block => block.text);
  const native = reference.reflows[index];
  if (windowsParagraphs) {
    // The tokenizers can assign a quote mark or adjacent space to different
    // paragraphs. Keep the original marks and phrase on the same Windows line.
    const words = part => part.replace(/[「『»› ]/gu, '');
    const joined = paragraphs => paragraphs.join('').replaceAll(' ', '');
    assert.deepEqual(actual, windowsParagraphs, name);
    assert.equal(joined(actual), joined([text]), name + ' original punctuation and wording');
    assert.equal(joined(native), joined([text]), name + ' native source');
    assert.deepEqual(actual.map(words), native.map(words), name + ' sentence groups');
  } else assert.deepEqual(actual, native, name);
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
