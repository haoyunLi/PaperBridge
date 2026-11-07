const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../src/savedAnnotations.mjs');

const note = (extra = {}) => ({ id: 'same-id', text: 'quote', offset: 0, body: 'A saved note', ...extra });
const block = (extra = {}) => ({ id: 1, text: 'quote then quote', translation: 'quote then quote', ...extra });
const paper = (extra = {}) => ({ blocks: [block()], summary: { source: 'quote', target: 'quote' },
  connectedTranslation: 'quote', ...extra });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('projection groups one exact highlight/note anchor without losing distinct historical bodies or original refs', async () => {
  const { savedAnnotations } = await helpers;
  const first = note({ body: 'First historical body', createdAt: '2026-01-02T00:00:00Z' });
  const second = note({ body: 'Second historical body', createdAt: '2026-01-03T00:00:00Z' });
  const highlight = note({ body: undefined, color: 'teal', createdAt: '2026-01-01T00:00:00Z' });
  const input = freeze(paper({ blocks: [block({ notes: [first, second], highlights: [highlight] })] }));
  const before = JSON.stringify(input);
  const entries = savedAnnotations(input);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.label, 'Reader · Block 1 · Original');
  assert.equal(entry.review, false);
  assert.equal(entry.time, Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(entry.notes.map(ref => ref.item.body), ['First historical body', 'Second historical body']);
  assert.equal(entry.notes[0].item, first);
  assert.equal(entry.notes[1].item, second);
  assert.equal(entry.highlights[0].item, highlight);
  assert.equal(entry.records.length, 3);
  assert.equal(new Set(entry.records.map(ref => ref.key)).size, 3, 'Reused record IDs cannot collide in the UI');
  assert.deepEqual(entry.records.map(({ category, location, blockId, kind }) => ({ category, location, blockId, kind })), [
    { category: 'note', location: 'block', blockId: 1, kind: 'source' },
    { category: 'note', location: 'block', blockId: 1, kind: 'source' },
    { category: 'highlight', location: 'block', blockId: 1, kind: 'source' }
  ]);
  assert.equal(JSON.stringify(input), before);
});

test('occurrence, side, scope, source/display modes and review status isolate identical quotes', async () => {
  const { savedAnnotations } = await helpers;
  const variants = [{}, { offset: 11 }, { kind: 'translation' }, { scope: 'paper' },
    { sourceMode: 'mineru' }, { sourceMode: 'pdf' }, { displayMode: 'bilingual' },
    { displayMode: 'translation' }, { needsReview: true }].map(note);
  const input = paper({ blocks: [block({ notes: variants })] });
  const entries = savedAnnotations(input);
  assert.equal(entries.length, variants.length);
  assert.equal(entries.filter(entry => entry.review).length, 1);
  assert.equal(entries.find(entry => entry.notes[0].item === variants[2]).label, 'Reader · Block 1 · Translation');
  assert.equal(entries.find(entry => entry.notes[0].item === variants[3]).label, 'Paper · Block 1 · Original');
  const other = block({ id: 2, notes: [note()] });
  assert.equal(savedAnnotations({ ...input, blocks: [...input.blocks, other] }).length, variants.length + 1);
});

test('unresolved legacy anchors never merge by shared ID or quote, and invalid rendered anchors do not fall back', async () => {
  const { savedAnnotations } = await helpers;
  const variants = [note({ offset: undefined }), note({ offset: undefined }), note({ offset: null }),
    note({ offset: -1 }), note({ renderedAnchor: { offset: 0 } }), note({ renderedAnchor: { offset: 0 } })];
  const entries = savedAnnotations(paper({ blocks: [block({ notes: variants, highlights: [note({ offset: undefined, color: 'amber' })] })] }));
  assert.equal(entries.length, 7);
  assert.ok(entries.every(entry => entry.review && entry.records.length === 1));
  assert.equal(new Set(entries.map(entry => entry.key)).size, 7);
  assert.deepEqual(entries.flatMap(entry => entry.notes.map(ref => ref.item.body)), variants.map(item => item.body));
});

test('rendered Markdown and article anchors group only complete identical ranges and compatible surfaces', async () => {
  const { savedAnnotations } = await helpers;
  const anchor = { offset: 2, before: 'A ', after: '.' };
  const item = note({ text: 'quote', offset: null, renderedAnchor: anchor });
  const input = paper({ type: 'pdf', sourceMode: 'mineru', mineruMarkdown: 'A $quote$.',
    blocks: [block({ sourceMarkdown: 'A $quote$.', notes: [item], highlights: [{ ...item, color: 'amber' }] })],
    pdfBlocks: [block()], mineruBlocks: [block()], viewNotes: [
      { ...item, scope: 'paperArticle', sourceMode: 'mineru', displayMode: 'bilingual' },
      { ...item, scope: 'paperArticle', sourceMode: 'pdf', displayMode: 'bilingual' },
      { ...item, scope: 'paperArticle', sourceMode: 'mineru', displayMode: 'translation' }
    ], viewHighlights: [
      { ...item, scope: 'paperArticle', sourceMode: 'mineru', displayMode: 'bilingual', color: 'coral' },
      { ...item, scope: 'paperArticle', sourceMode: 'mineru', displayMode: 'bilingual', renderedAnchor: { ...anchor, before: 'B ' } }
    ] });
  const entries = savedAnnotations(input);
  assert.equal(entries.length, 5);
  assert.equal(entries[0].records.length, 2);
  assert.equal(entries[1].records.length, 2);
  assert.equal(entries[1].label, 'Paper · document preview · Original');
  assert.ok(entries.every(entry => !entry.review));
  assert.equal(entries[1].notes[0].item, input.viewNotes[0]);
});

test('friendly labels infer legacy view sides and retain PDF scopes and page ranges', async () => {
  const { savedAnnotations, annotationLabel } = await helpers;
  const scopes = ['summarySource', 'summaryTarget', 'fullTranslation'];
  const entries = savedAnnotations(paper({ viewNotes: scopes.map(scope => note({ scope })) }));
  assert.deepEqual(entries.map(entry => entry.label), ['Source Summary · Original', 'Target Summary · Translation', 'Full Translation · Translation']);
  assert.deepEqual(entries.map(entry => entry.notes[0].kind), ['source', 'translation', 'translation']);
  assert.equal(annotationLabel({ id: 4, scope: 'paper', kind: 'translation' }), 'Paper · Block 4 · Translation');
  assert.equal(annotationLabel({ scope: 'reader' }, { blockId: 3, location: 'block' }), 'Reader · Block 3 · Original');
  assert.equal(annotationLabel({ scope: 'paperArticle', kind: 'translation' }), 'Paper · document preview · Translation');
  assert.equal(annotationLabel({ scope: 'pdf', page: 2 }), 'Original PDF · page 2');
  assert.equal(annotationLabel({ scope: 'paperPdf', page: 2, anchors: [{ page: 2 }, { page: 3 }] }), 'Paper · exact PDF · pages 2–3');
});

test('PDF grouping uses the entire ordered anchor chain, not first page or reused ID', async () => {
  const { savedAnnotations } = await helpers;
  const first = { page: 1, offset: 5, text: 'end' };
  const last = { page: 2, offset: 0, text: 'start' };
  const base = note({ scope: 'pdf', page: 1, offset: 5, text: 'end\nstart', quote: 'end start', anchors: [first, last] });
  const notes = [base, { ...base, anchors: [first, { ...last, offset: 1 }] },
    { ...base, scope: 'paperPdf' }, { ...base, anchors: [first, { ...last, page: 3 }] },
    { ...base, anchors: [first, { ...last, page: 1 }] }, { ...base, anchors: [] }, { ...base, anchors: [] }];
  const highlight = { ...base, color: 'amber' };
  const entries = savedAnnotations(paper({ pdfNotes: notes, pdfHighlights: [highlight] }));
  assert.equal(entries.length, 7);
  assert.equal(entries[0].records.length, 2);
  assert.equal(entries[0].highlights[0].item, highlight);
  assert.equal(entries[0].quote, 'end start');
  assert.equal(entries[0].label, 'Original PDF · pages 1–2');
  assert.equal(entries[2].label, 'Paper · exact PDF · pages 1–2');
  assert.ok(entries.slice(4).every(entry => entry.review));
  const legacy = note({ page: 3, offset: 7 });
  const same = { ...legacy, anchors: [{ page: 3, offset: 7, text: 'quote' }] };
  assert.equal(savedAnnotations(paper({ pdfNotes: [legacy], pdfHighlights: [same] })).length, 1);
});

test('creation sorting is descending with earliest group date, stable ties, and unknown groups after known dates', async () => {
  const { savedAnnotations } = await helpers;
  const original = note({ createdAt: '2026-01-01T00:00:00Z' });
  const legacy = note({ offset: 11 });
  const invalid = note({ scope: 'paper', createdAt: 'not-a-date' });
  const latest = note({ scope: 'summarySource', createdAt: '2026-02-01T00:00:00Z' });
  const tied = note({ page: 1, createdAt: latest.createdAt });
  const input = freeze(paper({ blocks: [block({ notes: [original, legacy, invalid],
    highlights: [{ ...original, createdAt: '2026-03-01T00:00:00Z' }, { ...legacy, createdAt: '2026-04-01T00:00:00Z' }] })],
    viewNotes: [latest], pdfNotes: [tied] }));
  const entries = savedAnnotations(input);
  assert.deepEqual(entries.map(entry => entry.notes[0].item), [latest, tied, original, legacy, invalid]);
  assert.equal(entries[2].time, Date.parse(original.createdAt), 'Later highlighting must not move an older note to the top');
  assert.equal(entries[3].time, null, 'One unknown backing date makes the group date unknown');
  assert.deepEqual(savedAnnotations(JSON.parse(JSON.stringify(input))).map(({ key, time }) => ({ key, time })), entries.map(({ key, time }) => ({ key, time })));
});

test('exact-reference deletion preserves reused IDs, unrelated arrays, and old immutable snapshots', async () => {
  const { savedAnnotations, removeSavedAnnotationRecords } = await helpers;
  const first = note();
  const other = note({ offset: 11, body: 'Keep this body despite reused ID' });
  const highlight = { ...first, color: 'amber' };
  const view = note({ scope: 'summarySource' });
  const pdf = note({ page: 1 });
  const input = freeze(paper({ blocks: [block({ notes: [first, other], highlights: [highlight] }), block({ id: 2 })],
    viewNotes: [view], pdfNotes: [pdf], untouched: { value: 'retain' } }));
  const entries = savedAnnotations(input);
  const group = entries.find(entry => entry.notes.some(ref => ref.item === first));
  const onlyNoteRemoved = removeSavedAnnotationRecords(input, group.notes);
  assert.deepEqual(onlyNoteRemoved.blocks[0].notes, [other]);
  assert.equal(onlyNoteRemoved.blocks[0].highlights, input.blocks[0].highlights);
  const removed = removeSavedAnnotationRecords(input, group.records);
  assert.deepEqual(removed.blocks[0].notes, [other]);
  assert.deepEqual(removed.blocks[0].highlights, []);
  assert.equal(removed.blocks[1], input.blocks[1]);
  assert.equal(removed.viewNotes, input.viewNotes);
  assert.equal(removed.pdfNotes, input.pdfNotes);
  assert.equal(removed.untouched, input.untouched);
  assert.deepEqual(input.blocks[0].notes, [first, other]);
  assert.equal(removeSavedAnnotationRecords(input, [{ ...group.notes[0], item: { ...first } }]), input, 'A copied or superseded object cannot delete the current record');
  assert.equal(removeSavedAnnotationRecords(input, [{ ...group.notes[0], blockId: 2 }]), input);
  assert.equal(removeSavedAnnotationRecords(input, []), input);
  assert.equal(removeSavedAnnotationRecords(removed, group.records), removed);
  const all = removeSavedAnnotationRecords(input, entries.flatMap(entry => entry.records));
  assert.deepEqual(all.viewNotes, []);
  assert.deepEqual(all.pdfNotes, []);
  assert.equal(input.viewNotes[0], view);
  assert.equal(input.pdfNotes[0], pdf);
});

test('removal is scoped to its exact backing surface and highlight side', async () => {
  const { savedAnnotations, removeSavedAnnotationRecords } = await helpers;
  const shared = note({ color: 'teal' });
  const input = paper({ blocks: [block({ highlights: [shared], translationHighlights: [shared] })], viewHighlights: [shared] });
  const refs = savedAnnotations(input).flatMap(entry => entry.highlights);
  const ref = refs.find(ref => ref.location === 'block' && ref.kind === 'translation');
  const result = removeSavedAnnotationRecords(input, [ref]);
  assert.equal(result.blocks[0].highlights, input.blocks[0].highlights);
  assert.deepEqual(result.blocks[0].translationHighlights, []);
  assert.equal(result.viewHighlights, input.viewHighlights);
  assert.deepEqual(savedAnnotations(null), []);
  assert.equal(removeSavedAnnotationRecords(null, refs), null);
});
