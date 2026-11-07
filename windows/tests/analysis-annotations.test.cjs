const test = require('node:test');
const assert = require('node:assert/strict');

const modules = Promise.all([import('../src/exportDocuments.mjs'), import('../src/annotationsMarkdown.mjs')]);
const at = day => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const occurrences = (text, value) => text.split(value).length - 1;

function paperFixture() {
  return { name: 'Annotation export fixture', blocks: [
    { id: 1, text: 'Alpha beta gamma. Alpha repeats.', translation: 'Alpha translated text.', status: 'ok', bookmark: true,
      notes: [
        { id: 'later', text: 'gamma', offset: 11, body: 'Later paragraph note.', createdAt: at(5) },
        { id: 'first-note', text: 'Alpha', offset: 0, body: 'Combined exact-range note.', createdAt: at(3) },
        { id: 'duplicate-note', text: 'Alpha', offset: 0, body: 'Combined exact-range note.', createdAt: at(3) },
        { id: 'second-occurrence', text: 'Alpha', offset: 18, body: 'Same quote at another position.', createdAt: at(4) },
        { id: 'paper-note', scope: 'paper', text: 'Alpha', offset: 0, body: 'Paper scope note.', createdAt: at(2) },
        { id: 'translated-note', kind: 'translation', text: 'Alpha', offset: 0, body: 'Translation side note.', createdAt: at(6) },
        { id: 'invalid', text: 'Displaced quotation', offset: 0, body: 'Keep the unresolved note.', createdAt: at(7) },
        { id: 'review', text: 'Alpha', offset: 0, body: 'Review this historical note.', needsReview: true, createdAt: at(1) }
      ],
      highlights: [{ id: 'first-highlight', text: 'Alpha', offset: 0, color: 'amber', createdAt: at(1) }],
      translationHighlights: [{ id: 'translated-highlight', text: 'Alpha', offset: 0, color: 'blue', createdAt: at(6) }] },
    { id: 2, text: 'Second paragraph has no saved annotations.', translation: '', status: 'pending' },
    { id: 3, text: 'Figure legend.', resource: true,
      notes: [{ text: 'Figure', offset: 0, body: 'Resource note must remain exported.', createdAt: at(8) }] },
    { id: 4, text: 'References', heading: true },
    { id: 5, text: '[1] Citation text.', bookmark: true, page: 2,
      notes: [{ text: 'Citation', offset: 4, body: 'Reference note must remain exported.', createdAt: at(9) }] }
  ] };
}

test('Analysis places bookmarks and combined chronological Reader annotations inside the matching paragraph', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = paperFixture();
  const before = structuredClone(paper);
  const output = markdownDocuments(paper, 'French', 'analysis')[0].content;
  const first = output.slice(output.indexOf('### Paragraph 1'), output.indexOf('### Paragraph 2'));
  assert.match(first, /^### Paragraph 1\n\n> Bookmarked in PaperBridge\n\n#### Original\n\nAlpha beta gamma/);
  assert.match(first, /\n#### Highlights and Notes\n\n##### Reader · Block 1 · source · amber\n\n> Alpha\n\nNote: Combined exact-range note\./);
  assert.equal(occurrences(output, 'Combined exact-range note.'), 1);
  assert.equal(occurrences(first, '> Alpha\n'), 3, 'A distinct occurrence and the translation side remain separate from the merged note/highlight.');
  assert.ok(first.indexOf('Combined exact-range note.') < first.indexOf('Same quote at another position.'));
  assert.ok(first.indexOf('Same quote at another position.') < first.indexOf('Later paragraph note.'));
  assert.ok(first.indexOf('Later paragraph note.') < first.indexOf('Translation side note.'));
  assert.match(first, /Reader · Block 1 · translation · blue/);
  const second = output.slice(output.indexOf('### Paragraph 2'), output.indexOf('## Other Saved Highlights and Notes'));
  assert.doesNotMatch(second, /Highlights and Notes|Bookmarked/);
  assert.equal(occurrences(output, '> Bookmarked in PaperBridge'), 1);
  assert.deepEqual(paper, before, 'Export leaves annotations, IDs, ranges and timestamps unchanged.');
});

test('other scopes, review-needed or invalid anchors, omitted resources and references go to one appendix', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = paperFixture();
  const output = markdownDocuments(paper, 'French', 'analysis')[0].content;
  const start = output.indexOf('## Other Saved Highlights and Notes');
  assert.ok(start > output.indexOf('### Paragraph 2'));
  const appendix = output.slice(start);
  const body = output.slice(0, start);
  for (const note of ['Paper scope note.', 'Keep the unresolved note.', 'Review this historical note.', 'Resource note must remain exported.', 'Reference note must remain exported.']) {
    assert.equal(occurrences(appendix, note), 1);
    assert.doesNotMatch(body, new RegExp(note.replaceAll('.', '\\.')));
  }
  assert.match(appendix, /### Paper · Block 1 · source/);
  assert.match(appendix, /Reader · Block 1 · source · source changed, review needed/);
  assert.equal(occurrences(appendix, '> Source changed: this note was preserved, but its location could not be verified.'), 2);
  assert.ok(appendix.indexOf('Review this historical note.') < appendix.indexOf('Paper scope note.'));
  assert.match(appendix, /### Other Bookmarks\n\n- Block 5 · page 2: \[1\] Citation text\./);
  assert.doesNotMatch(appendix, /Combined exact-range note|Translation side note/);
});

test('PDF, article modes, summary sides and full-draft annotations keep distinct anchors and deduplicate exact notes', async () => {
  const [{ markdownDocuments }, { annotationsMarkdown }] = await modules;
  const paper = { name: 'Other surfaces', type: 'pdf', sourceMode: 'mineru', mineruMarkdown: 'Article text.',
    blocks: [{ id: 1, text: 'Article text.', sourceMarkdown: 'Article text.', status: 'pending' }],
    summary: { source: 'Summary source.', target: 'Summary translation.' }, connectedTranslation: 'Full translation.',
    pdfNotes: [
      { id: 'pdf', scope: 'pdf', page: 1, text: 'end\nstart', quote: 'end start', anchors: [{ page: 1, offset: 4, text: 'end' }, { page: 2, offset: 0, text: 'start' }], body: 'Cross-page PDF note.', createdAt: at(1) },
      { id: 'pdf-copy', scope: 'pdf', page: 1, text: 'end\nstart', quote: 'end start', anchors: [{ page: 1, offset: 4, text: 'end' }, { page: 2, offset: 0, text: 'start' }], body: 'Cross-page PDF note.', createdAt: at(1) },
      { id: 'paper-pdf', scope: 'paperPdf', page: 1, offset: 4, text: 'end', body: 'Exact Paper PDF note.', createdAt: at(2) },
      { id: 'other-page', scope: 'pdf', page: 3, offset: 4, text: 'end', body: 'Different PDF page note.', createdAt: at(3) }
    ], pdfHighlights: [{ scope: 'pdf', page: 1, text: 'end\nstart', quote: 'end start', anchors: [{ page: 1, offset: 4, text: 'end' }, { page: 2, offset: 0, text: 'start' }], color: 'coral', createdAt: at(1) }],
    viewNotes: [
      { scope: 'summarySource', text: 'Summary', offset: 0, body: 'Source summary note.', createdAt: at(4) },
      { scope: 'summaryTarget', text: 'Summary', offset: 0, body: 'Target summary note.', createdAt: at(5) },
      { scope: 'fullTranslation', text: 'Full', offset: 0, body: 'Full draft note.', createdAt: at(6) },
      ...['bilingual', 'translation'].map((displayMode, index) => ({ scope: 'paperArticle', sourceMode: 'mineru', displayMode, kind: 'source', text: 'Article',
        renderedAnchor: { offset: 0, before: '', after: ' text.' }, body: `Article ${displayMode} note.`, createdAt: at(7 + index) }))
    ], viewHighlights: [{ scope: 'summarySource', text: 'Summary', offset: 0, color: 'blue', createdAt: at(4) }] };
  const output = markdownDocuments(paper, 'French', 'analysis')[0].content;
  const appendix = output.slice(output.indexOf('## Other Saved Highlights and Notes'));
  for (const note of ['Cross-page PDF note.', 'Exact Paper PDF note.', 'Different PDF page note.', 'Source summary note.', 'Target summary note.', 'Full draft note.', 'Article bilingual note.', 'Article translation note.']) {
    assert.equal(occurrences(appendix, note), 1, note);
    assert.equal(occurrences(annotationsMarkdown(paper), note), 1, 'Direct Bilingual annotation exports must retain each note once.');
  }
  assert.equal(occurrences(appendix, '> end start'), 1);
  assert.match(appendix, /Original PDF · pages 1–2 · coral/);
  assert.match(appendix, /Paper · exact PDF · page 1/);
  assert.match(appendix, /Original PDF · page 3/);
  assert.match(appendix, /Summary · source · blue/);
  assert.match(appendix, /Summary · translation/);
  assert.match(appendix, /Full Translation/);
});

test('undated legacy records keep stable relative order and ambiguous missing ranges are not coalesced', async () => {
  const [, { analysisAnnotations }] = await modules;
  const paper = { blocks: [{ id: 1, text: 'Alpha beta gamma delta.', notes: [
    { text: 'beta', offset: 6, body: 'Legacy first.' },
    { text: 'gamma', offset: 11, body: 'Invalid date stays second.', createdAt: 'not-a-date' },
    { text: 'Alpha', offset: 0, body: 'Known second.', createdAt: at(2) },
    { text: 'delta', offset: 17, body: 'Known first.', createdAt: at(1) },
    { text: 'Missing quote', body: 'Unlocated note.', createdAt: at(3) },
    { text: 'Missing quote', body: 'Unlocated note.', createdAt: at(3) }
  ] }] };
  const { paragraphs, appendix } = analysisAnnotations(paper, new Set([1]));
  const output = paragraphs.get(1);
  assert.ok(output.indexOf('Known first.') < output.indexOf('Known second.'));
  assert.ok(output.indexOf('Legacy first.') < output.indexOf('Invalid date stays second.'));
  assert.equal(occurrences(appendix, 'Unlocated note.'), 2, 'Equal quote text without an exact range cannot prove these are duplicate occurrences.');
});

test('rendered Markdown anchors merge exact highlight/note pairs without collapsing different contexts or note bodies', async () => {
  const [, { analysisAnnotations }] = await modules;
  const shared = { text: 'N=6', offset: null, renderedAnchor: { offset: 2, before: 'A ', after: ' layers.' }, createdAt: at(1) };
  const paper = { blocks: [{ id: 1, text: 'A [Formula] layers.', sourceMarkdown: 'A $N = 6$ layers.', notes: [
    { ...shared, body: 'One note body.' }, { ...shared, body: 'A distinct historical body.', createdAt: at(2) },
    { ...shared, renderedAnchor: { offset: 20, before: 'Second ', after: ' stack.' }, body: 'Another rendered occurrence.' }
  ], highlights: [{ ...shared, color: 'amber' }] }] };
  const output = analysisAnnotations(paper, new Set([1])).paragraphs.get(1);
  assert.equal(occurrences(output, '> N=6'), 2);
  for (const note of ['One note body.', 'A distinct historical body.', 'Another rendered occurrence.']) assert.equal(occurrences(output, note), 1);
  assert.match(output, /source · amber\n\n> N=6\n\nNote: One note body\.\n\nNote: A distinct historical body\./);
});

test('Bilingual keeps global annotation labels and Analysis omits an empty annotation appendix', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = paperFixture();
  const bilingual = markdownDocuments(paper, 'French', 'bilingual')[0].content;
  for (const label of ['## Bookmarks', '## Highlights', '## Notes', 'Reader · Block 1 · source · amber', 'Paper · Block 1 · source']) assert.ok(bilingual.includes(label));
  assert.equal(occurrences(bilingual, 'Combined exact-range note.'), 1);
  const combined = { name: 'Legacy combined record', blocks: [{ id: 1, text: 'Exact quote.', status: 'pending',
    notes: [{ id: 'combined', text: 'Exact', offset: 0, body: 'Note with its own color.', color: 'teal' }] }] };
  const combinedOutput = markdownDocuments(combined, 'French', 'bilingual')[0].content;
  assert.match(combinedOutput, /## Notes\n\n### Reader · Block 1 · source · teal\n\n> Exact\n\nNote with its own color\./);
  const clean = { name: 'Clean paper', blocks: [{ id: 1, text: 'Plain source.', status: 'pending' }] };
  const output = markdownDocuments(clean, 'French', 'analysis')[0].content;
  assert.doesNotMatch(output, /Highlights and Notes|## Bookmarks|None saved\./);
});
