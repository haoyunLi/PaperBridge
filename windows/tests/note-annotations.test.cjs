const test = require('node:test');
const assert = require('node:assert/strict');

test('cross-page notes retain exact ranges and validate every selected page', async () => {
  const { applySelectionNote, findSelectionNote, noteSelectionIdentity, validNoteSelection } = await import('../src/noteAnnotations.mjs');
  const paper = { id: 'pdf', blocks: [] };
  const selection = {
    scope: 'pdf', page: 1, offset: 5, text: 'end\nstart', quote: 'end start',
    anchors: [
      { page: 1, offset: 5, text: 'end', pageText: 'page end' },
      { page: 2, offset: 0, text: 'start', pageText: 'start of page two' }
    ]
  };
  assert.equal(validNoteSelection(paper, selection), true);
  const saved = applySelectionNote(paper, selection, 'two pages', () => 'note');
  assert.deepEqual(saved.pdfNotes[0].anchors, [
    { page: 1, offset: 5, text: 'end' },
    { page: 2, offset: 0, text: 'start' }
  ]);
  assert.equal(findSelectionNote(saved, selection).body, 'two pages');
  assert.equal(findSelectionNote(saved, { ...selection, scope: 'paperPdf' }), null);
  const mismatch = { ...selection, anchors: [selection.anchors[0], { ...selection.anchors[1], offset: 1 }] };
  assert.notEqual(noteSelectionIdentity(paper.id, selection), noteSelectionIdentity(paper.id, mismatch));
  assert.equal(validNoteSelection(paper, mismatch), false);
  assert.equal(applySelectionNote(saved, mismatch, 'must not replace'), saved);
});
const annotations = import('../src/noteAnnotations.mjs');

const basePaper = () => ({
  id: 'paper-a',
  blocks: [{ id: 1, text: 'Alpha source text', translation: '阿尔法译文', notes: [], highlights: [{ id: 'h', text: 'Alpha', offset: 0, color: 'amber' }] }],
  summary: { source: 'Source summary', target: '摘要译文' },
  connectedTranslation: 'Connected translation'
});

test('note updates preserve whitespace and one exact empty value clears only the note', async () => {
  const { applySelectionNote, findSelectionNote } = await annotations;
  const selection = { scope: 'reader', id: 1, kind: 'source', text: 'Alpha', offset: 0, displayOffset: 0 };
  const body = '  keep leading and trailing  \n';
  const saved = applySelectionNote(basePaper(), selection, body, () => 'note');
  assert.equal(findSelectionNote(saved, selection).body, body);
  const cleared = applySelectionNote(saved, selection, '', () => 'unused');
  assert.equal(findSelectionNote(cleared, selection), null);
  assert.deepEqual(cleared.blocks[0].highlights, basePaper().blocks[0].highlights);
  const whitespace = applySelectionNote(cleared, selection, '   ', () => 'spaces');
  assert.equal(findSelectionNote(whitespace, selection).body, '   ');
});

test('review-needed notes never match or get silently reused', async () => {
  const { applySelectionNote, findSelectionNote } = await annotations;
  const selection = { scope: 'reader', id: 1, kind: 'source', text: 'Alpha', offset: 0 };
  const paper = basePaper();
  paper.blocks[0].notes = [{ id: 'old', text: 'Alpha', offset: 0, kind: 'source', body: 'stale', needsReview: true }];
  assert.equal(findSelectionNote(paper, selection), null);
  const saved = applySelectionNote(paper, selection, 'fresh', () => 'new');
  assert.deepEqual(saved.blocks[0].notes.map(item => [item.id, item.body, item.needsReview]), [['old', 'stale', true], ['new', 'fresh', undefined]]);
});

test('Paper and Reader notes stay separate while legacy notes default to Reader', async () => {
  const { applySelectionNote, findSelectionNote } = await annotations;
  const reader = { scope: 'reader', id: 1, kind: 'source', text: 'Alpha', offset: 0 };
  const preview = { ...reader, scope: 'paper' };
  let paper = basePaper();
  paper.blocks[0].notes = [{ id: 'legacy', text: 'source', offset: 6, kind: 'source', body: 'Legacy Reader note' }];
  paper = applySelectionNote(paper, reader, 'Reader note', () => 'reader-note');
  paper = applySelectionNote(paper, preview, 'Paper note', () => 'paper-note');
  assert.equal(findSelectionNote(paper, reader).body, 'Reader note');
  assert.equal(findSelectionNote(paper, preview).body, 'Paper note');
  assert.equal(findSelectionNote(paper, { ...reader, text: 'source', offset: 6 }).body, 'Legacy Reader note');
  assert.equal(findSelectionNote(paper, { ...preview, text: 'source', offset: 6 }), null);
  assert.deepEqual(paper.blocks[0].notes.map(item => [item.id, item.scope]), [['legacy', undefined], ['reader-note', 'reader'], ['paper-note', 'paper']]);
});

test('notes map across reader translation, PDF, summary and full translation scopes', async () => {
  const { applySelectionNote, findSelectionNote, noteSelectionIdentity, sameNoteSelection, validNoteSelection } = await annotations;
  let paper = basePaper();
  const selections = [
    { scope: 'reader', id: 1, kind: 'translation', text: '阿尔法', offset: 0 },
    { scope: 'paper', id: 1, kind: 'source', text: 'Alpha', offset: 0 },
    { scope: 'pdf', page: 2, pageText: 'PDF exact quote', text: 'exact', offset: 4 },
    { scope: 'paperPdf', page: 2, pageText: 'PDF exact quote', text: 'exact', offset: 4 },
    { scope: 'summarySource', text: 'summary', offset: 7 },
    { scope: 'summaryTarget', text: '摘要', offset: 0 },
    { scope: 'fullTranslation', text: 'translation', offset: 10 }
  ];
  for (const [index, selection] of selections.entries()) {
    assert.equal(validNoteSelection(paper, selection), true);
    paper = applySelectionNote(paper, selection, `body-${index}`, () => `id-${index}`);
    assert.equal(findSelectionNote(paper, selection).body, `body-${index}`);
    assert.ok(noteSelectionIdentity(paper.id, selection));
  }
  const identity = noteSelectionIdentity(paper.id, selections[0]);
  assert.equal(sameNoteSelection(paper.id, selections[0], identity), true);
  assert.equal(sameNoteSelection('another-paper', selections[0], identity), false);
  assert.equal(sameNoteSelection(paper.id, selections[1], identity), false);
});

test('Paper article notes keep their reading source and reject edits through a stale selection', async () => {
  const { applySelectionNote, findSelectionNote, validNoteSelection } = await annotations;
  const { paperArticleAnchorAvailable, paperArticleSource, selectionOffsets } = await import('../src/markdownAnchors.mjs');
  const blocks = [{ id: 1, text: 'A rendered heading' }, { id: 2, text: 'A rendered paragraph' }];
  const paper = { id: 'article', type: 'pdf', sourceMode: 'mineru', mineruMarkdown: '# A rendered heading', blocks };
  const captured = { text: 'heading\nA rendered', context: 'A rendered heading\nA rendered paragraph', offset: 11 };
  const selection = { ...selectionOffsets(captured, null, paperArticleSource(paper)), text: captured.text,
    scope: 'paperArticle', displayMode: 'bilingual', sourceMode: 'mineru', kind: 'source' };
  const saved = applySelectionNote(paper, selection, 'Across the heading', () => 'article-note');
  assert.equal(findSelectionNote(saved, selection).body, 'Across the heading');
  assert.equal(saved.viewNotes[0].renderedSource, undefined);
  assert.equal(findSelectionNote(saved, { ...selection, displayMode: 'translation' }), null);
  const otherSource = { ...saved, sourceMode: 'pdf', blocks: [{ id: 1, text: 'PDF text' }], mineruBlocks: blocks };
  assert.equal(paperArticleAnchorAvailable(otherSource, saved.viewNotes[0]), true);
  assert.equal(validNoteSelection(otherSource, selection), false);
  const annotationOnly = { ...saved, blocks: [{ ...blocks[0], bookmark: true }, blocks[1]] };
  assert.equal(validNoteSelection(annotationOnly, selection), true);
  const edited = { ...saved, blocks: [blocks[0], { ...blocks[1], text: 'Edited while selected' }] };
  assert.equal(applySelectionNote(edited, selection, 'Do not overwrite'), edited);
});

test('Markdown recovery preserves verified coordinates and rejects ambiguous displaced quotes', async () => {
  const { markdownAnnotationOffset, renderedAnchorOffset } = await import('../src/markdownAnchors.mjs');
  const saved = { text: 'N=6', offset: null, renderedAnchor: { offset: 2, before: 'A ', after: ' layers.' } };
  const original = 'A N=6 layers.';
  assert.equal(markdownAnnotationOffset(original, saved), 2);
  const moved = 'Revision. Now N=6 layers.';
  assert.equal(markdownAnnotationOffset(moved, saved), moved.indexOf(saved.text));
  assert.equal(renderedAnchorOffset(moved, saved), null, 'a pending edit still requires current exact coordinates');
  assert.equal(markdownAnnotationOffset(moved + ' Another N=6.', saved), null);
  assert.equal(markdownAnnotationOffset(moved, { ...saved, needsReview: true }), null);
  assert.equal(markdownAnnotationOffset('A N=8 layers.', saved), null);

  const legacy = { text: 'repeat', offset: 11, displayOffset: 0 };
  assert.equal(markdownAnnotationOffset('repeat and repeat', legacy, 'repeat and repeat'), 11);
  assert.equal(markdownAnnotationOffset('Now repeat and repeat', legacy, 'Now repeat and repeat'), null);
  assert.equal(markdownAnnotationOffset('Only repeat remains.', legacy, 'Only **repeat** remains.'), 5);
});
