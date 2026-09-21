const test = require('node:test');
const assert = require('node:assert/strict');
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

test('notes map across reader translation, PDF, summary and full translation scopes', async () => {
  const { applySelectionNote, findSelectionNote, noteSelectionIdentity, sameNoteSelection, validNoteSelection } = await annotations;
  let paper = basePaper();
  const selections = [
    { scope: 'reader', id: 1, kind: 'translation', text: '阿尔法', offset: 0 },
    { scope: 'pdf', page: 2, pageText: 'PDF exact quote', text: 'exact', offset: 4 },
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
