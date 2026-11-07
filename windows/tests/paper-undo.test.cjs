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
