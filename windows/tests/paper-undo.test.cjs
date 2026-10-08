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

test('undoing an edit restores removed source highlights but respects later explicit deletion of retained notes', async () => {
  const { createUndoEntry, applyUndoEntry } = await undo;
  const { editedBlock } = await paperHelpers;
  const before = paper([{ text: 'Old passage and shared word.', highlights: [{ id: 'highlight', text: 'Old passage', offset: 0, color: 'amber' }], notes: [{ id: 'note', text: 'shared', offset: 16, body: 'Old note' }] }]);
  const after = paper([editedBlock(before.blocks[0], 'New passage and shared word.')]);
  const current = paper([{ ...after.blocks[0], notes: [] }]);
  const restored = applyUndoEntry(current, createUndoEntry(before, after));
  assert.deepEqual(restored.blocks[0].highlights, before.blocks[0].highlights);
  assert.deepEqual(restored.blocks[0].notes, []);
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
