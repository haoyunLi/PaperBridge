const test = require('node:test');
const assert = require('node:assert/strict');
const undo = import('../src/paperUndo.mjs');
const paperHelpers = import('../src/paper.mjs');

function paper(blocks, extra = {}) { return { id: 'test-paper', blocks: blocks.map((block, index) => ({ id: index + 1, status: 'pending', ...block })), ...extra }; }

test('undoing a bookmark keeps translations, summaries, explanation caches and settings written later', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const before = paper([{ text: 'One sentence.' }, { text: 'Another sentence.' }]);
  const after = { ...before, blocks: before.blocks.map((block, index) => index ? block : { ...block, bookmark: true }) };
  const current = { ...after, blocks: after.blocks.map(block => ({ ...block, translation: 'New translation', status: 'ok' })), summary: { source: 'New summary' }, connectedTranslation: 'New full translation', taskSettings: { targetLanguage: 'French' }, paragraphExplanations: { example: 'New explanation' } };
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.equal(Boolean(restored.blocks[0].bookmark), false);
  assert.equal(restored.blocks[0].translation, 'New translation');
  assert.equal(restored.blocks[1].status, 'ok');
  for (const field of ['summary', 'connectedTranslation', 'taskSettings', 'paragraphExplanations']) assert.deepEqual(restored[field], current[field]);
  assert.equal(current.blocks[0].bookmark, true);
});

test('undoing annotations preserves later unrelated notes and later edits to existing note bodies', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const initialNote = { id: 'note', text: 'One', offset: 0, body: 'Initial note' };
  const before = paper([{ text: 'One sentence.', notes: [initialNote] }], { pdfHighlights: [] });
  const after = { ...before, blocks: [{ ...before.blocks[0], notes: [{ ...initialNote, body: 'Edited note' }] }], pdfHighlights: [{ id: 'highlight', page: 1, text: 'PDF', offset: 0 }] };
  const current = { ...after, blocks: [{ ...after.blocks[0], notes: [{ ...initialNote, body: 'Later note' }, { id: 'new-note', text: 'sentence', offset: 4, body: 'Keep me' }] }], viewNotes: [{ id: 'view-note', body: 'Keep me too' }] };
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks[0].notes, current.blocks[0].notes);
  assert.deepEqual(restored.pdfHighlights, []);
  assert.deepEqual(restored.viewNotes, current.viewNotes);
});

test('undo restores deleted highlights and does not remove a newly edited note', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const highlight = { id: 'highlight', text: 'One', offset: 0, color: 'amber' };
  const before = paper([{ text: 'One sentence.', highlights: [highlight], notes: [] }]);
  const after = paper([{ ...before.blocks[0], highlights: [], notes: [{ id: 'note', text: 'One', offset: 0, body: 'Added' }] }]);
  const current = paper([{ ...after.blocks[0], notes: [{ ...after.blocks[0].notes[0], body: 'Later edit' }] }]);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks[0].highlights, [highlight]);
  assert.equal(restored.blocks[0].notes[0].body, 'Later edit');
});

test('saved annotation single and atomic deletion undo retain duplicate IDs, every historical body and original order', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { savedAnnotations, removeSavedAnnotationRecords } = await import('../src/savedAnnotations.mjs');
  const first = { id: 'duplicate', text: 'quote', offset: 0, body: 'First historical body' };
  const second = { ...first, body: 'Second historical body' };
  for (const location of ['block', 'view', 'pdf']) {
    const items = location === 'view' ? [first, second].map(item => ({ ...item, scope: 'summarySource' }))
      : location === 'pdf' ? [first, second].map(item => ({ ...item, scope: 'pdf', page: 1 })) : [first, second];
    const before = paper([{ text: 'quote', ...(location === 'block' && { notes: items }) }], {
      summary: { source: 'quote' }, ...(location === 'view' && { viewNotes: items }), ...(location === 'pdf' && { pdfNotes: items })
    });
    const group = savedAnnotations(before)[0];
    for (const refs of [[group.notes[0]], [group.notes[1]], group.records]) {
      const after = removeSavedAnnotationRecords(before, refs);
      const restored = applyUndoEntry(after, createUndoEntry(before, after));
      assert.deepEqual(restored, before, `${location}: deleted ${refs.map(ref => ref.item.body).join(', ')}`);
    }
  }
});

test('deletion undo restores original array order and identical duplicate multiplicity', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const first = { id: 'same', text: 'One', offset: 0, body: 'Same body' };
  const other = { id: 'other', text: 'sentence', offset: 4, body: 'Other body' };
  const before = paper([{ text: 'One sentence.', notes: [first, other, { ...first }] }]);
  for (const notes of [[other, before.blocks[0].notes[2]], [other], []]) {
    const after = paper([{ ...before.blocks[0], notes }]);
    assert.deepEqual(applyUndoEntry(after, createUndoEntry(before, after)).blocks[0].notes, before.blocks[0].notes);
  }
});

test('duplicate-ID deletion undo keeps later note edits, same-ID new anchors and unrelated highlight changes', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const first = { id: 'same', text: 'One', offset: 0, body: 'First body' };
  const second = { ...first, body: 'Second body' };
  const unrelated = { id: 'other', text: 'sentence', offset: 4, body: 'Other body' };
  const highlight = { id: 'highlight', text: 'One', offset: 0, color: 'amber' };
  const before = paper([{ text: 'One sentence.', notes: [first, second, unrelated], highlights: [highlight] }]);
  const after = paper([{ ...before.blocks[0], notes: [second, unrelated] }]);
  const laterSecond = { ...second, body: 'Later second body' };
  const laterUnrelated = { ...unrelated, body: 'Later unrelated body' };
  const newSameID = { ...first, text: 'sentence', offset: 4, body: 'New occurrence with reused ID' };
  const current = paper([{ ...after.blocks[0], notes: [laterSecond, laterUnrelated, newSameID],
    highlights: [{ ...highlight, color: 'teal' }] }]);
  const entry = createUndoEntry(before, after);
  const restored = applyUndoEntry(current, entry);
  assert.deepEqual(restored.blocks[0].notes, [first, laterSecond, laterUnrelated, newSameID]);
  assert.deepEqual(restored.blocks[0].highlights, current.blocks[0].highlights);
  assert.deepEqual(applyUndoEntry(restored, entry).blocks[0].notes, restored.blocks[0].notes, 'Restored occurrences are not duplicated by a repeat application');

  const cleared = paper([{ ...before.blocks[0], notes: [] }]);
  const later = paper([{ ...cleared.blocks[0], notes: [newSameID], highlights: current.blocks[0].highlights }]);
  const restoredAll = applyUndoEntry(later, createUndoEntry(before, cleared));
  assert.deepEqual(restoredAll.blocks[0].notes, [first, second, unrelated, newSameID]);
  assert.deepEqual(restoredAll.blocks[0].highlights, current.blocks[0].highlights);
});

test('duplicate-ID edit undo changes only unambiguous occurrences and preserves later bodies', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const first = { id: 'same', text: 'One', offset: 0, body: 'First body' };
  const second = { ...first, body: 'Second body' };
  const before = paper([{ text: 'One sentence.', notes: [first, second] }]);
  const changed = { ...first, body: 'Changed first body' };
  const after = paper([{ ...before.blocks[0], notes: [changed, second] }]);
  const later = { ...changed, body: 'Later first body' };
  const current = paper([{ ...after.blocks[0], notes: [later, second] }]);
  assert.deepEqual(applyUndoEntry(current, createUndoEntry(before, after)).blocks[0].notes, [later, second]);

  const bothChanged = paper([{ ...before.blocks[0], notes: [changed, { ...second, body: 'Changed second body' }] }]);
  const ambiguous = paper([{ ...bothChanged.blocks[0], notes: [later, { ...second, body: 'Later second body' }] }]);
  assert.deepEqual(applyUndoEntry(ambiguous, createUndoEntry(before, bothChanged)).blocks[0].notes, ambiguous.blocks[0].notes,
    'Do not guess which historical body belongs to indistinguishable later duplicates');
});

test('undoing a split restores old anchors and translations while retaining later notes and unaffected AI outputs', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { splitBlockAt } = await paperHelpers;
  const before = paper([{ text: 'First sentence. Second sentence.', translation: 'Old translation', status: 'ok', notes: [{ id: 'old-note', text: 'Second', offset: 16, body: 'Before' }] }, { text: 'Unchanged paragraph.', translation: '', status: 'pending' }], { position: { block: 2 } });
  const split = splitBlockAt(before.blocks[0], 15);
  const after = paper([...split, before.blocks[1]], { position: { block: 3 } });
  const current = { ...after, blocks: after.blocks.map((block, index) => ({ ...block, id: index + 1, ...(index === 1 ? { notes: [{ ...block.notes[0], body: 'Edited after split' }, { id: 'new-note', text: 'sentence', offset: 7, body: 'Ambiguous but keep' }, { id: 'unique-note', text: 'Second', offset: 0, body: 'New note' }] } : {}), ...(index === 2 ? { translation: 'New unaffected translation', status: 'ok' } : {}) })), summary: { source: 'New summary' }, connectedTranslation: 'New full translation', taskSettings: { targetLanguage: 'German' } };
  // Structural helpers return duplicated IDs until the renderer renumbers them.
  after.blocks = after.blocks.map((block, index) => ({ ...block, id: index + 1 }));
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks.map(block => block.text), before.blocks.map(block => block.text));
  assert.equal(restored.blocks[0].translation, 'Old translation');
  assert.equal(restored.blocks[1].translation, 'New unaffected translation');
  assert.equal(restored.blocks[0].notes.find(note => note.id === 'old-note').offset, 16);
  assert.equal(restored.blocks[0].notes.find(note => note.id === 'old-note').body, 'Edited after split');
  assert.equal(restored.blocks[0].notes.find(note => note.id === 'unique-note').offset, 16);
  assert.equal(restored.blocks[0].notes.find(note => note.id === 'new-note').needsReview, true);
  assert.equal(restored.summary.source, 'New summary');
  assert.equal(restored.summary.stale, true);
  assert.equal(restored.connectedTranslation, 'New full translation');
  assert.equal(restored.connectedStale, true);
  assert.equal(restored.taskSettings.targetLanguage, 'German');
  assert.equal(restored.position.block, 2);
});

test('undoing an edit restores reviewed highlights and respects later explicit deletion of retained notes', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { editedBlock } = await paperHelpers;
  const before = paper([{ text: 'Old passage and shared word.', highlights: [{ id: 'highlight', text: 'Old passage', offset: 0, color: 'amber' }], notes: [{ id: 'note', text: 'shared', offset: 16, body: 'Old note' }] }]);
  const after = paper([editedBlock(before.blocks[0], 'New passage and shared word.')]);
  const current = paper([{ ...after.blocks[0], notes: [] }]);
  assert.equal(current.blocks[0].highlights[0].needsReview, true);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks[0].highlights, before.blocks[0].highlights);
  assert.deepEqual(restored.blocks[0].notes, []);
});

test('undo restores the original summary or keeps a replacement with remapped citations', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { remapSummaryEvidence } = await paperHelpers;
  const quote = 'A distinct finding.';
  const summary = { source: 'Original summary', claims: [{ text: 'Finding', sources: [{ paragraphID: 2, quote }] }] };
  const before = paper([{ text: 'Introduction.' }, { text: quote }], { summary });
  const after = paper([{ text: 'Introduction.' }, { text: 'New paragraph.' }, { text: quote }]);
  const range = { start: 0, beforeEnd: 1, afterEnd: 2 };
  after.summary = remapSummaryEvidence(before.summary, before.blocks, after.blocks, range);
  const entry = createUndoEntry(before, after, range);
  assert.deepEqual(applyUndoEntry(after, entry).summary, summary);

  const newer = { source: 'New summary', claims: [{ text: 'Reworded finding', sources: [{ paragraphID: 3, quote }] }] };
  const restored = applyUndoEntry({ ...after, summary: newer }, entry);
  assert.deepEqual(restored.summary, {
    source: newer.source, stale: true, claims: [{ ...newer.claims[0], sources: [{ paragraphID: 2, quote }] }]
  });
});

test('an exact edit range restores results when one replacement matches an old paragraph', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { editedParagraphs } = await paperHelpers;
  const before = paper([{ text: 'Original sentence.', status: 'ok', translation: 'Original translation' },
    { text: 'Untouched paragraph.' }]);
  const replacements = editedParagraphs(before.blocks[0], 'Original sentence.\n\nNew paragraph.');
  const after = paper([...replacements, before.blocks[1]].map((block, index) => ({ ...block, id: index + 1 })));
  const current = { ...after, blocks: [...after.blocks.slice(0, 2), { ...after.blocks[2], status: 'ok', translation: 'Untouched translation' }] };
  const restored = applyUndoEntry(current, createUndoEntry(before, after, { start: 0, beforeEnd: 1, afterEnd: 2 }));
  assert.deepEqual(restored.blocks.map(block => block.text), before.blocks.map(block => block.text));
  assert.deepEqual(restored.blocks.map(block => block.translation), ['Original translation', 'Untouched translation']);
});

test('entries cannot undo into another paper or a different extraction, and AI-only changes create no entry', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const before = paper([{ text: 'Original.' }]);
  const after = paper([{ text: 'Edited.' }]);
  const entry = createUndoEntry(before, after);
  const otherPaper = { ...after, id: 'other' };
  const otherSource = { ...after, sourceMode: 'mineru' };
  const changedAgain = paper([{ text: 'Further edit.' }]);
  assert.equal(applyUndoEntry(otherPaper, entry), otherPaper);
  assert.equal(applyUndoEntry(otherSource, entry), otherSource);
  assert.equal(applyUndoEntry(changedAgain, entry), changedAgain);
  assert.equal(createUndoEntry(before, paper([{ ...before.blocks[0], translation: 'AI output', status: 'ok' }], { summary: { source: 'Summary' } })), null);
});

test('undoing a merge restores legacy anchors once and maps newly written notes to the correct original block', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { mergeBlocks } = await paperHelpers;
  const before = paper([{ text: 'First passage.' }, { text: 'Second passage.', notes: [{ text: 'Second', offset: 0, body: 'Legacy note' }], translation: 'Old second translation', status: 'ok' }]);
  const after = paper([mergeBlocks(before.blocks[0], before.blocks[1])]);
  const current = paper([{ ...after.blocks[0], notes: [{ ...after.blocks[0].notes[0], body: 'Later legacy body' }, { id: 'new', text: 'Second passage', offset: 15, body: 'New note after merge' }] }]);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.equal(restored.blocks.length, 2);
  assert.equal(restored.blocks[0].notes.length, 0);
  assert.equal(restored.blocks[1].notes.length, 2);
  assert.equal(restored.blocks[1].notes[0].body, 'Later legacy body');
  assert.equal(restored.blocks[1].notes[0].offset, 0);
  assert.equal(restored.blocks[1].notes[1].offset, 0);
  assert.equal(restored.blocks[1].notes[1].needsReview, false);
  assert.equal(restored.blocks[1].translation, 'Old second translation');
});

test('real split and merge undo retain every duplicate-ID body and same-value occurrence', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { splitBlockAt, mergeBlocks } = await paperHelpers;
  const first = { id: 'duplicate', text: 'Shared', offset: 0, body: 'First body' };
  const notes = [first, { ...first, body: 'Second body' }, { ...first }];
  const highlights = [{ id: 'duplicate-highlight', text: 'Shared', offset: 0, color: 'amber' },
    { id: 'duplicate-highlight', text: 'Shared', offset: 0, color: 'teal' }];
  const beforeSplit = paper([{ text: 'Shared first sentence. Shared second sentence.', notes, highlights }]);
  const afterSplit = paper(splitBlockAt(beforeSplit.blocks[0], 23).map((block, index) => ({ ...block, id: index + 1 })));
  const restoredSplit = applyUndoEntry(afterSplit, createUndoEntry(beforeSplit, afterSplit));
  assert.deepEqual(restoredSplit.blocks[0].notes, notes);
  assert.deepEqual(restoredSplit.blocks[0].highlights, highlights);

  const beforeMerge = paper([{ text: 'Shared first sentence.', notes, highlights },
    { text: 'Shared second sentence.', notes: [{ ...first }], highlights: [{ ...highlights[0] }] }]);
  const afterMerge = paper([mergeBlocks(...beforeMerge.blocks)]);
  const restoredMerge = applyUndoEntry(afterMerge, createUndoEntry(beforeMerge, afterMerge));
  for (const field of ['notes', 'highlights']) assert.deepEqual(restoredMerge.blocks.map(block => block[field]), beforeMerge.blocks.map(block => block[field]));
});

test('split undo preserves duplicate-ID later body/color edits and each independently deleted occurrence', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { splitBlockAt } = await paperHelpers;
  const first = { id: 'duplicate', text: 'Second', offset: 16, body: 'First body' };
  const second = { ...first, body: 'Second body' };
  const highlights = [{ id: 'same-highlight', text: 'Second', offset: 16, color: 'amber' },
    { id: 'same-highlight', text: 'Second', offset: 16, color: 'teal' }];
  const before = paper([{ text: 'First sentence. Second sentence.', notes: [first, second], highlights }]);
  const after = paper(splitBlockAt(before.blocks[0], 15).map((block, index) => ({ ...block, id: index + 1 })));
  const entry = createUndoEntry(before, after);
  const added = { id: 'duplicate', text: 'First sentence', offset: 0, body: 'New same-ID anchor' };
  const edited = { ...after, blocks: after.blocks.map((block, index) => index === 0 ? { ...block, notes: [added] }
    : { ...block, notes: block.notes.map((note, at) => at ? note : { ...note, body: 'Later first body' }),
      highlights: block.highlights.map((highlight, at) => at ? highlight : { ...highlight, color: 'coral' }) }) };
  const restored = applyUndoEntry(edited, entry);
  assert.deepEqual(restored.blocks[0].notes.map(note => note.body), ['Later first body', 'Second body', 'New same-ID anchor']);
  assert.deepEqual(restored.blocks[0].notes.map(note => note.offset), [16, 16, 0]);
  assert.equal(restored.blocks[0].notes[2].needsReview, false);
  assert.deepEqual(restored.blocks[0].highlights.map(highlight => highlight.color), ['coral', 'teal']);

  for (const removed of [0, 1]) {
    const current = { ...after, blocks: after.blocks.map((block, index) => index === 0 ? block
      : { ...block, notes: block.notes.filter((_, at) => at !== removed), highlights: block.highlights.filter((_, at) => at !== removed) }) };
    const undone = applyUndoEntry(current, entry);
    assert.deepEqual(undone.blocks[0].notes, [removed === 0 ? second : first]);
    assert.deepEqual(undone.blocks[0].highlights, [highlights[removed === 0 ? 1 : 0]]);
  }
});

test('merge undo maps duplicate IDs by full historical record and keeps later same-ID new anchors', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { mergeBlocks } = await paperHelpers;
  const first = { id: 'same', text: 'First', offset: 0, body: 'First body' };
  const second = { id: 'same', text: 'Second', offset: 0, body: 'Second body' };
  const before = paper([{ text: 'First passage.', notes: [first] }, { text: 'Second passage.', notes: [second] }]);
  const after = paper([mergeBlocks(...before.blocks)]);
  const added = { id: 'same', text: 'Second passage', offset: after.blocks[0].text.indexOf('Second'), body: 'New same-ID note' };
  const current = paper([{ ...after.blocks[0], notes: [{ ...after.blocks[0].notes[1], body: 'Later second body' }, added] }]);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks[0].notes, [], 'Later deletion of the first record remains deleted');
  assert.deepEqual(restored.blocks[1].notes.map(note => note.body), ['Later second body', 'New same-ID note']);
  assert.deepEqual(restored.blocks[1].notes.map(note => note.offset), [0, 0]);
  assert.equal(restored.blocks[1].notes[1].needsReview, false);
});

test('structural undo retains ambiguous historical bodies and keeps later edits separately for review', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { mergeBlocks } = await paperHelpers;
  const item = { id: 'same', text: 'Shared', offset: 0, body: 'Same historical body' };
  const before = paper([{ text: 'Shared first passage.', notes: [{ ...item }] },
    { text: 'Shared second passage.', notes: [{ ...item }] }]);
  const after = paper([mergeBlocks(...before.blocks)]);
  const later = { ...after.blocks[0].notes[1], body: 'Later body with ambiguous original owner' };
  const current = paper([{ ...after.blocks[0], notes: [after.blocks[0].notes[0], later] }]);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks.map(block => block.notes[0].body), ['Same historical body', 'Same historical body']);
  const retained = restored.blocks.flatMap(block => block.notes).filter(note => note.body === later.body);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].needsReview, true);
  assert.equal(current.blocks[0].notes[1].needsReview, false, 'The live input remains unchanged');
});

test('structural undo independently restores selection and the saved viewport without changing current view preferences', async () => {
  const { createUndoEntry, applyUndoEntry, remapPositionAfterStructureChange } = await undo;
  const { splitBlockAt } = await paperHelpers;
  const before = paper([
    { text: 'Selected introduction.' },
    { text: 'First sentence. Second sentence.', notes: [{ id: 'note', text: 'Second', offset: 16, body: 'Before split' }] },
    { text: 'Visible conclusion.' }
  ], { selectedParagraphID: 1, position: { block: 3, page: 2, tab: 'Reader', displayMode: 'source',
    pdfZoom: 1, scrollByTab: { Reader: 430, Paper: 81, Summary: 52, 'Full Translation': 65, 'Pdf:pdf:2': 204 } } });
  const range = { start: 1, beforeEnd: 2, afterEnd: 3 };
  const blocks = [before.blocks[0], ...splitBlockAt(before.blocks[1], 15), before.blocks[2]]
    .map((block, index) => ({ ...block, id: index + 1 }));
  const after = { ...before, blocks, selectedParagraphID: 2,
    position: remapPositionAfterStructureChange(before.position, before.blocks, blocks, range) };
  assert.equal(after.position.block, 4, 'splitting another paragraph remaps the viewport, not the selection');
  const entry = createUndoEntry(before, after, range);
  const current = { ...after, selectedParagraphID: 4, position: { block: 2, page: 8, tab: 'Original',
    displayMode: 'translation', pdfZoom: 1.75, scrollByTab: { Reader: 90, 'Original:8': 930 } },
    blocks: after.blocks.map((block, index) => index === 2
      ? { ...block, bookmark: true, notes: [{ ...block.notes[0], body: 'Written after split' }] }
      : index === 3 ? { ...block, status: 'ok', translation: 'Later conclusion translation', bookmark: true } : block) };
  const restored = applyUndoEntry(current, entry);
  assert.equal(restored.selectedParagraphID, 1);
  assert.equal(restored.position.block, 3, 'undo restores the pre-edit viewport rather than the selected or edited paragraph');
  assert.equal(restored.position.page, 2);
  assert.deepEqual(restored.position.scrollByTab, before.position.scrollByTab);
  assert.equal(restored.position.tab, 'Original');
  assert.equal(restored.position.displayMode, 'translation');
  assert.equal(restored.position.pdfZoom, 1.75);
  assert.equal(restored.blocks[1].notes[0].body, 'Written after split');
  assert.equal(restored.blocks[1].notes[0].offset, 16);
  assert.equal(restored.blocks[1].bookmark, true);
  assert.equal(restored.blocks[2].bookmark, true);
  assert.equal(restored.blocks[2].translation, 'Later conclusion translation');
  assert.equal(current.position.block, 2, 'undo must not mutate the live input object');
  restored.position.scrollByTab.Reader = 1;
  assert.equal(entry.beforePosition.scrollByTab.Reader, 430, 'restored positions do not alias the undo snapshot');
  before.position.scrollByTab.Reader = 2;
  assert.equal(entry.beforePosition.scrollByTab.Reader, 430, 'the snapshot does not alias the original position');
});

test('structural undo uses the Mac first-paragraph fallback for null selection while retaining legacy migration', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const blocks = [{ id: 4, resource: true, text: 'Figure resource' }, { id: 8, text: 'First readable.' }, { id: 12, text: 'Later readable.' }];
  for (const [selection, expected] of [[{ selectedParagraphID: null }, 8], [{ selectedParagraphID: 999 }, 8],
    [{ selectedParagraphID: 4 }, 8], [{ selectedParagraphID: 12 }, 12], [{}, 12]]) {
    const before = paper(blocks, { ...selection, position: { block: 12 } });
    const after = { ...before, selectedParagraphID: 8, blocks: before.blocks.map(block => block.id === 8 ? { ...block, text: 'Repaired readable.' } : block) };
    const restored = applyUndoEntry(after, createUndoEntry(before, after));
    assert.equal(restored.selectedParagraphID, expected, JSON.stringify(selection));
    assert.equal(restored.position.block, 12, 'selection fallback never changes the independent viewport');
  }
});

test('structure mapping uses actual paragraph IDs across split, merge and reflow boundaries', async () => {
  const { remapPositionAfterStructureChange } = await undo;
  const before = [{ id: 10, text: 'Before.' }, { id: 20, text: 'First changed.' },
    { id: 30, text: 'Second changed.' }, { id: 40, text: 'After.' }];
  const cases = [
    { range: { start: 1, beforeEnd: 2, afterEnd: 3 }, ids: [100, 200, 300, 400, 500], expected: [100, 200, 400, 500] },
    { range: { start: 1, beforeEnd: 3, afterEnd: 2 }, ids: [100, 200, 300], expected: [100, 200, 200, 300] },
    { range: { start: 1, beforeEnd: 3, afterEnd: 4 }, ids: [100, 200, 300, 400, 500], expected: [100, 200, 200, 500] }
  ];
  for (const { range, ids, expected } of cases) {
    const after = ids.map(id => ({ id, text: `Result ${id}.` }));
    for (const [index, block] of before.entries()) {
      const position = { block: block.id, page: 3, tab: 'Reader', displayMode: 'translation', pdfZoom: 2,
        scrollByTab: { Reader: 600, Paper: 80, 'Paper:3': 70, Original: 90, 'Original:3': 100,
          'Pdf:pdf:3': 250, 'Pdf:paperPdf:3': 300, Summary: 50, 'Full Translation': 60 } };
      const snapshot = structuredClone(position);
      const mapped = remapPositionAfterStructureChange(position, before, after, range);
      assert.equal(mapped.block, expected[index]);
      assert.deepEqual(mapped.scrollByTab, { Paper: 80, 'Paper:3': 70, Original: 90, 'Original:3': 100,
        'Pdf:pdf:3': 250, 'Pdf:paperPdf:3': 300 });
      for (const field of ['page', 'tab', 'displayMode', 'pdfZoom']) assert.equal(mapped[field], position[field]);
      assert.deepEqual(position, snapshot, 'mapping does not mutate persisted positions');
    }
  }
  assert.equal(Object.hasOwn(remapPositionAfterStructureChange({ block: 999 }, before, cases[0].ids.map(id => ({ id })), cases[0].range), 'block'), false);
});

test('structure mapping and undo use the durable search origin instead of the filtered viewport', async () => {
  const { createUndoEntry, applyUndoEntry, remapPositionAfterStructureChange } = await undo;
  const before = paper([{ text: 'Introduction.' }, { text: 'First. Second.' }, { text: 'Conclusion.' }], {
    selectedParagraphID: 1, position: { tab: 'Reader', block: 1, page: 1, scrollByTab: { Reader: 12, Paper: 45 },
      readerSearchOrigin: { block: 3, scrollTop: 800, offset: -21 } }
  });
  const range = { start: 1, beforeEnd: 2, afterEnd: 3 };
  const after = paper([{ text: 'Introduction.' }, { text: 'First.' }, { text: 'Second.' }, { text: 'Conclusion.' }], { selectedParagraphID: 2 });
  after.position = remapPositionAfterStructureChange(before.position, before.blocks, after.blocks, range);
  assert.equal(after.position.block, 4);
  assert.deepEqual(after.position.scrollByTab, { Paper: 45 });
  assert.equal(Object.hasOwn(after.position, 'readerSearchOrigin'), false);
  const restored = applyUndoEntry(after, createUndoEntry(before, after, range));
  assert.equal(restored.selectedParagraphID, 1);
  assert.equal(restored.position.block, 3);
  assert.deepEqual(restored.position.scrollByTab, { Reader: 800, Paper: 45 });
  assert.equal(Object.hasOwn(restored.position, 'readerSearchOrigin'), false);

  const legacy = { ...before, position: { ...before.position, block: 3, readerSearchOrigin: 720 } };
  assert.equal(remapPositionAfterStructureChange(legacy.position, before.blocks, after.blocks, range).block, 4);
  const legacyRestored = applyUndoEntry(after, createUndoEntry(legacy, after, range));
  assert.equal(legacyRestored.position.block, 3);
  assert.equal(legacyRestored.position.scrollByTab.Reader, 720);
});

test('annotation undo and navigation-only changes never restore an earlier selection or viewport', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const before = paper([{ text: 'One.' }, { text: 'Two.' }], { selectedParagraphID: 1, position: { block: 1, scrollByTab: { Reader: 0 } } });
  const after = { ...before, blocks: [{ ...before.blocks[0], bookmark: true }, before.blocks[1]] };
  const current = { ...after, selectedParagraphID: null, position: { block: 2, page: 4, tab: 'Original', scrollByTab: { Reader: 320, 'Original:4': 90 } } };
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.equal(Boolean(restored.blocks[0].bookmark), false);
  assert.equal(restored.selectedParagraphID, null);
  assert.deepEqual(restored.position, current.position);
  assert.equal(createUndoEntry(before, { ...before, selectedParagraphID: 2, position: current.position }), null);
});

test('undo clears a viewport absent from the snapshot without resetting current display preferences', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const before = paper([{ text: 'Original.' }], { selectedParagraphID: null });
  const after = paper([{ text: 'Repaired.' }], { selectedParagraphID: 1 });
  const current = { ...after, position: { tab: 'Reader', displayMode: 'bilingual', pdfZoom: 1.5,
    block: 1, page: 7, scrollByTab: { Reader: 500 }, readerSearchOrigin: 400 } };
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.equal(restored.selectedParagraphID, 1);
  assert.deepEqual(restored.position, { tab: 'Reader', displayMode: 'bilingual', pdfZoom: 1.5 });
});

test('source repairs clear output language with text and structural Undo restores their original pairing', async () => {
  const { splitBlockAt, mergeBlocks, editedBlock } = await paperHelpers;
  const { createUndoEntry, applyUndoEntry } = await undo;
  const chinese = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const german = { sourceLanguage: 'English', targetLanguage: 'German' };
  const before = paper([
    { text: 'First sentence. Second sentence.', translation: '原有中文译文。', translationLanguage: chinese, status: 'ok' },
    { text: 'Independent evidence.', translation: 'Earlier result.', translationLanguage: null, status: 'ok' }
  ]);
  const split = splitBlockAt(before.blocks[0], before.blocks[0].text.indexOf('Second'));
  for (const repaired of [...split, mergeBlocks(...before.blocks), editedBlock(before.blocks[0], 'Repaired source.')]) {
    assert.equal(repaired.translation, '');
    assert.equal(repaired.translationMarkdown, null);
    assert.equal(repaired.translationLanguage, null, 'invalidated output must not retain its old language label');
  }
  const after = { ...before, blocks: [...split, before.blocks[1]].map((block, index) => ({ ...block, id: index + 1 })) };
  const current = { ...after, blocks: after.blocks.map((block, index) => index === 2
    ? { ...block, translation: 'Neue Übersetzung.', translationLanguage: german, status: 'ok' } : block),
    connectedTranslation: 'Newer independent German draft.', connectedLanguage: german };
  const restored = applyUndoEntry(current, createUndoEntry(before, after, { start: 0, beforeEnd: 1, afterEnd: 2 }));
  assert.equal(restored.blocks[0].translation, before.blocks[0].translation);
  assert.deepEqual(restored.blocks[0].translationLanguage, chinese);
  assert.equal(restored.blocks[1].translation, 'Neue Übersetzung.');
  assert.deepEqual(restored.blocks[1].translationLanguage, german);
  assert.equal(restored.connectedTranslation, current.connectedTranslation);
  assert.deepEqual(restored.connectedLanguage, german);
  assert.equal(restored.connectedStale, true);
  assert.equal(before.blocks[0].translation, '原有中文译文。');
});
