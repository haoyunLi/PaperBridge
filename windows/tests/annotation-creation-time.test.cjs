const test = require('node:test');
const assert = require('node:assert/strict');

const modules = Promise.all([
  import('../src/annotationCreationTime.mjs'), import('../src/noteAnnotations.mjs'), import('../src/savedAnnotations.mjs')
]);
const oldDate = '2020-01-02T03:04:05.000Z';
const laterDate = '2021-02-03T04:05:06.000Z';
const fixture = () => ({ id: 'dates', blocks: [{ id: 1, text: 'Alpha Alpha', translation: 'Alpha Alpha' }],
  summary: { source: 'Alpha Alpha', target: 'Alpha Alpha' }, connectedTranslation: 'Alpha Alpha' });
const reader = { scope: 'reader', id: 1, kind: 'source', text: 'Alpha', offset: 0 };
const record = selection => {
  const { id, pageText, ...anchor } = selection;
  return anchor;
};
const freshTime = (callback) => {
  const before = Date.now(), result = callback(), after = Date.now();
  assert.equal(typeof result, 'string');
  assert.ok(Date.parse(result) >= before && Date.parse(result) <= after, `Expected a new creation time, got ${result}`);
  return result;
};

test('both creation orders retain one annotation age after either part is cleared, in each storage category', async () => {
  const [{ annotationCreationTime }, { applySelectionNote }, { savedAnnotations }] = await modules;
  const contexts = [
    [reader, paper => paper.blocks[0], 'highlights'],
    [{ ...reader, kind: 'translation' }, paper => paper.blocks[0], 'translationHighlights'],
    [{ ...reader, scope: 'paper' }, paper => paper.blocks[0], 'highlights'],
    [{ scope: 'summarySource', kind: 'source', text: 'Alpha', offset: 0 }, paper => paper, 'viewHighlights'],
    [{ scope: 'summaryTarget', kind: 'translation', text: 'Alpha', offset: 0 }, paper => paper, 'viewHighlights'],
    [{ scope: 'fullTranslation', kind: 'translation', text: 'Alpha', offset: 0 }, paper => paper, 'viewHighlights'],
    [{ scope: 'pdf', kind: 'source', text: 'Alpha', offset: 0, page: 1, pageText: 'Alpha Alpha' }, paper => paper, 'pdfHighlights'],
    [{ scope: 'paperPdf', kind: 'source', text: 'Alpha', offset: 0, page: 1, pageText: 'Alpha Alpha' }, paper => paper, 'pdfHighlights']
  ];
  for (const [selection, container, field] of contexts) {
    let paper = fixture();
    const highlight = { ...record(selection), id: 'first-highlight', color: 'amber', createdAt: oldDate };
    if (selection.id) delete highlight.kind;
    container(paper)[field] = [highlight];
    const inputPaper = paper, original = structuredClone(paper);
    paper = applySelectionNote(paper, selection, 'A later note.', () => 'second-note');
    assert.equal(savedAnnotations(paper).length, 1);
    assert.equal(savedAnnotations(paper)[0].notes[0].item.createdAt, oldDate);
    assert.deepEqual(inputPaper, original, 'Creating a counterpart cannot mutate the original paper or highlight');
    const withoutNote = applySelectionNote(paper, selection, '');
    const withoutHighlight = structuredClone(paper); container(withoutHighlight)[field] = [];
    for (const version of [paper, withoutNote, withoutHighlight]) assert.equal(savedAnnotations(version)[0].time, Date.parse(oldDate));

    paper = applySelectionNote(fixture(), selection, 'The note came first.', () => 'first-note');
    const noteDate = savedAnnotations(paper)[0].notes[0].item.createdAt;
    container(paper)[field] = [{ ...record(selection), id: 'second-highlight', color: 'teal', createdAt: annotationCreationTime(paper, selection) }];
    assert.equal(container(paper)[field][0].createdAt, noteDate);
    assert.equal(savedAnnotations(paper)[0].time, Date.parse(noteDate));
    const noteCleared = applySelectionNote(paper, selection, '');
    assert.equal(savedAnnotations(noteCleared)[0].time, Date.parse(noteDate));
    container(paper)[field] = [];
    assert.equal(savedAnnotations(paper)[0].time, Date.parse(noteDate));
  }
});

test('new annotations get a current ISO time while earliest original timestamp spelling is inherited', async () => {
  const [{ annotationCreationTime }] = await modules;
  freshTime(() => annotationCreationTime(fixture(), reader));
  const paper = fixture();
  const earliest = '2020-01-02T05:04:05+02:00';
  paper.blocks[0].notes = [{ ...record(reader), id: 'one', createdAt: laterDate },
    { ...record(reader), id: 'two', createdAt: earliest }];
  paper.blocks[0].highlights = [{ ...record(reader), id: 'mark', createdAt: '2020-06-02T03:04:05Z' }];
  const original = structuredClone(paper);
  assert.equal(annotationCreationTime(paper, reader), earliest);
  assert.deepEqual(paper, original);
});

test('missing, null and invalid historical dates propagate unknown without rewriting edited notes', async () => {
  const [{ annotationCreationTime }, { applySelectionNote }, { savedAnnotations }] = await modules;
  for (const createdAt of [undefined, null, '', 'not a date', 12345]) {
    const paper = fixture();
    paper.blocks[0].highlights = [{ ...record(reader), id: 'old-highlight', createdAt },
      { ...record(reader), id: 'dated-highlight', createdAt: oldDate }];
    assert.equal(annotationCreationTime(paper, reader), null);
    const withNote = applySelectionNote(paper, reader, 'New counterpart.', () => 'new-note');
    assert.equal(withNote.blocks[0].notes[0].createdAt, null);
    assert.equal(savedAnnotations(withNote)[0].time, null);
    const onlyNote = { ...withNote, blocks: [{ ...withNote.blocks[0], highlights: [] }] };
    assert.equal(savedAnnotations(onlyNote)[0].time, null);
    const legacy = fixture();
    legacy.blocks[0].notes = [{ ...record(reader), id: 'legacy', body: 'Old body.', createdAt }];
    legacy.blocks[0].highlights = [{ ...record(reader), id: 'dated-highlight', createdAt: oldDate }];
    assert.equal(applySelectionNote(legacy, reader, 'Edited body.').blocks[0].notes[0].createdAt, createdAt);
  }
});

test('block dates do not leak across side, scope, repeated occurrence, block or review-needed records', async () => {
  const [{ annotationCreationTime }] = await modules;
  const paper = fixture();
  paper.blocks[0].notes = [
    { ...record(reader), kind: 'translation', createdAt: null },
    { ...record(reader), scope: 'paper', createdAt: null },
    { ...record(reader), offset: 6, createdAt: null },
    { ...record(reader), needsReview: true, createdAt: null }
  ];
  paper.blocks[0].translationHighlights = [{ text: 'Alpha', offset: 0, createdAt: null }];
  paper.blocks[0].highlights = [{ ...record(reader), needsReview: true, createdAt: null }];
  paper.blocks.push({ id: 2, text: 'Alpha Alpha', notes: [{ ...record(reader), createdAt: null }] });
  paper.viewHighlights = [{ ...record(reader), createdAt: null }];
  freshTime(() => annotationCreationTime(paper, reader));
  assert.equal(annotationCreationTime(paper, { ...reader, kind: 'translation' }), null,
    'Translation highlights have no kind property; their container still determines their side');
  paper.blocks[0].highlights.push({ text: 'Alpha', offset: 0, createdAt: oldDate });
  assert.equal(annotationCreationTime(paper, reader), oldDate, 'Legacy block records default to Reader and Original');
});

test('Markdown view inheritance respects language side and exact document-preview modes', async () => {
  const [{ annotationCreationTime }] = await modules;
  const selection = { scope: 'paperArticle', kind: 'source', sourceMode: 'mineru', displayMode: 'bilingual',
    text: 'Alpha', offset: null, renderedAnchor: { offset: 0, before: '', after: ' Alpha' } };
  const paper = fixture();
  paper.viewNotes = [
    { ...selection, sourceMode: 'pdf', createdAt: null },
    { ...selection, displayMode: 'source', createdAt: null },
    { ...selection, kind: 'translation', createdAt: null },
    { ...selection, scope: 'fullTranslation', createdAt: null },
    { ...selection, renderedAnchor: { offset: 6, before: 'Alpha ', after: '' }, createdAt: null },
    { ...selection, needsReview: true, createdAt: null }
  ];
  freshTime(() => annotationCreationTime(paper, selection));
  paper.viewHighlights = [{ ...selection, createdAt: oldDate }];
  assert.equal(annotationCreationTime(paper, selection), oldDate);
  const target = { scope: 'summaryTarget', kind: 'translation', text: 'Alpha', offset: 0 };
  paper.viewHighlights = [{ scope: 'summarySource', text: 'Alpha', offset: 0, createdAt: null }];
  freshTime(() => annotationCreationTime(paper, target));
  paper.viewHighlights.push({ scope: 'summaryTarget', text: 'Alpha', offset: 0, createdAt: oldDate });
  assert.equal(annotationCreationTime(paper, target), oldDate, 'Old target-summary records infer Translation from their view');
});

test('rendered selection matching uses the actual occurrence rather than only the quoted string', async () => {
  const [{ annotationCreationTime }] = await modules;
  const selection = { ...reader, renderedText: 'Alpha Alpha', displayOffset: 6, offset: 6, anchorSource: 'Alpha Alpha' };
  const paper = fixture();
  paper.blocks[0].highlights = [{ text: 'Alpha', offset: 0, createdAt: null }];
  freshTime(() => annotationCreationTime(paper, selection));
  paper.blocks[0].highlights.push({ text: 'Alpha', offset: 6, createdAt: oldDate });
  assert.equal(annotationCreationTime(paper, selection), oldDate);
});

test('PDF inheritance compares every page anchor and keeps Original PDF separate from exact Paper PDF', async () => {
  const [{ annotationCreationTime }, { applySelectionNote }] = await modules;
  const selection = { scope: 'pdf', kind: 'source', page: 1, text: 'end\nstart', quote: 'end start', offset: 5,
    anchors: [{ page: 1, offset: 5, text: 'end', pageText: 'page end' }, { page: 2, offset: 0, text: 'start', pageText: 'start here' }] };
  const paper = fixture();
  paper.pdfNotes = [
    { ...selection, scope: 'paperPdf', createdAt: null },
    { ...selection, anchors: selection.anchors.slice(0, 1), createdAt: null },
    { ...selection, anchors: [selection.anchors[0], { ...selection.anchors[1], offset: 1 }], createdAt: null },
    { ...selection, anchors: [...selection.anchors].reverse(), createdAt: null },
    { ...selection, needsReview: true, createdAt: null }
  ];
  freshTime(() => annotationCreationTime(paper, selection));
  paper.pdfHighlights = [{ ...selection, quote: 'end\nstart', createdAt: oldDate }];
  assert.equal(annotationCreationTime(paper, selection), oldDate, 'Quote display formatting cannot change an exact PDF anchor identity');
  const withNote = applySelectionNote(paper, selection, 'Both pages.', () => 'new-pdf-note');
  assert.equal(withNote.pdfNotes.find(note => note.id === 'new-pdf-note').createdAt, oldDate);
});
