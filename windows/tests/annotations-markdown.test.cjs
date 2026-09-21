const test = require('node:test');
const assert = require('node:assert/strict');

test('portable reading records include every surface, direction, color, bookmarks and invalid anchors', async () => {
  const { annotationsMarkdown } = await import('../src/annotationsMarkdown.mjs');
  const output = annotationsMarkdown({ blocks: [{ id: 1, page: 2, text: 'Original phrase', translation: 'Translated phrase', bookmark: true,
    notes: [{ text: 'Translated', offset: 0, kind: 'translation', body: 'Translation note' }, { text: 'Missing', offset: 0, body: 'Keep this stale note' }],
    highlights: [{ text: 'Original', offset: 0, color: 'amber' }], translationHighlights: [{ text: 'Translated', offset: 0, color: 'blue' }] }],
    pdfNotes: [{ text: 'Page quote', page: 3, body: 'PDF note' }], pdfHighlights: [{ text: 'Page highlight', page: 4, color: 'coral', needsReview: true }],
    summary: { source: 'Summary source', target: 'Summary target' }, connectedTranslation: 'Full text',
    viewNotes: [{ scope: 'summaryTarget', text: 'Summary', offset: 0, body: 'Summary note' }],
    viewHighlights: [{ scope: 'summarySource', text: 'Summary', offset: 0, color: 'blue' }, { scope: 'fullTranslation', text: 'Full', offset: 0, color: 'amber' }] });
  for (const expected of ['## Bookmarks', 'Block 1 · page 2: Original phrase', 'Block 1 · translation', 'Translation note', 'Keep this stale note',
    'Block 1 · source · amber', 'Block 1 · translation · blue', 'Original PDF · page 3', 'Original PDF · page 4 · coral · source changed, review needed',
    'Summary · translation', 'Summary · source · blue', 'Full Translation · amber']) assert.ok(output.includes(expected), expected);
  assert.ok(!output.includes('Block 1 · translation · source changed'));
});
