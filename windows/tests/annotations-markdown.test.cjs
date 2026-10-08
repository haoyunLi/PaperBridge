const test = require('node:test');
const assert = require('node:assert/strict');

test('portable reading records include every surface, direction, color, bookmarks and invalid anchors', async () => {
  const { annotationsMarkdown } = await import('../src/annotationsMarkdown.mjs');
  const output = annotationsMarkdown({ blocks: [{ id: 1, page: 2, text: 'Original phrase', translation: 'Translated phrase', bookmark: true,
    notes: [{ text: 'Translated', offset: 0, kind: 'translation', body: 'Translation note' }, { scope: 'paper', text: 'Missing', offset: 0, body: 'Keep this stale note' }],
    highlights: [{ scope: 'paper', text: 'Original', offset: 0, color: 'amber' }], translationHighlights: [{ text: 'Translated', offset: 0, color: 'blue' }] }],
    pdfNotes: [{ text: 'Page quote', page: 3, body: 'PDF note' }, { scope: 'paperPdf', text: 'Paper quote', page: 2, body: 'Paper PDF note' }], pdfHighlights: [{ text: 'Page highlight', page: 4, color: 'coral', needsReview: true }],
    summary: { source: 'Summary source', target: 'Summary target' }, connectedTranslation: 'Full text',
    viewNotes: [{ scope: 'summaryTarget', text: 'Summary', offset: 0, body: 'Summary note' }],
    viewHighlights: [{ scope: 'summarySource', text: 'Summary', offset: 0, color: 'blue' }, { scope: 'fullTranslation', text: 'Full', offset: 0, color: 'amber' }] });
  for (const expected of ['## Bookmarks', 'Block 1 · page 2: Original phrase', 'Reader · Block 1 · translation', 'Translation note', 'Paper · Block 1 · source · source changed, review needed', 'Keep this stale note',
    'Paper · Block 1 · source · amber', 'Reader · Block 1 · translation · blue', 'Original PDF · page 3', 'Paper · exact PDF · page 2', 'Paper PDF note', 'Original PDF · page 4 · coral · source changed, review needed',
    'Summary · translation', 'Summary · source · blue', 'Full Translation · amber']) assert.ok(output.includes(expected), expected);
  assert.ok(!output.includes('Reader · Block 1 · translation · source changed'));
});
