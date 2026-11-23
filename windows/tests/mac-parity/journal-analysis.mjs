import assert from 'node:assert/strict';
import { markdownDocuments } from '../../src/exportDocuments.mjs';
import { editedParagraphs, remapSummaryEvidence } from '../../src/paper.mjs';
import { applyUndoEntry, createUndoEntry } from '../../src/paperUndo.mjs';

export function verifyJournalAnalysis(native) {
  const language = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const [first, second] = native.originals;
  const quote = 'tabular data';
  const paper = {
    name: 'Tabbed reading notes', type: 'text',
    blocks: [
      { id: 1, text: first, status: 'ok', translation: native.translation, translationLanguage: language,
        bookmark: true, notes: [{ text: quote, offset: first.indexOf(quote), body: 'Check the input format.' }] },
      { id: 2, text: second, status: 'failed', error: 'Model interrupted' }
    ],
    viewNotes: [{ scope: 'summarySource', text: 'a reader', offset: native.sourceSummary.indexOf('a reader'),
      color: 'amber', body: 'Compare with the abstract.' }]
  };
  const legacy = { ...language, source: native.sourceSummary, target: native.targetSummary };
  const beforeParagraphs = output => output.slice(0, output.search(/^## Paragraph(?: 1|s)$/m)).trimEnd();
  if (native.edit) {
    const before = { ...paper, summary: { ...legacy, claims: native.claims }, connectedTranslation: native.translation };
    const range = { start: 0, beforeEnd: 1, afterEnd: 2 };
    const parts = editedParagraphs(before.blocks[0], first.replace('.\nFor example,', '.\n\nFor example,'));
    const blocks = [...parts, before.blocks[1]].map((block, i) => ({ ...block, id: i + 1 }));
    const edited = { ...before, blocks, connectedStale: true, summary: remapSummaryEvidence(before.summary, before.blocks, blocks, range) };
    const restored = applyUndoEntry(edited, createUndoEntry(before, edited, range));
    assert.deepEqual({
      paragraphs: blocks.map(block => block.text), bookmarks: blocks.filter(block => block.bookmark).map(block => block.id),
      summaryCurrentAfterEdit: Boolean(edited.summary && !edited.summary.stale), draftCurrentAfterEdit: !edited.connectedStale,
      restoredParagraphs: restored.blocks.map(block => block.text), restoredSummary: restored.summary.source === legacy.source
        && JSON.stringify(restored.summary.claims) === JSON.stringify(native.claims),
      restoredDraft: restored.connectedTranslation === native.translation && !restored.connectedStale,
      restoredTranslation: restored.blocks[0].translation
    }, native.edit);
    // A quote spanning the cut has no single paragraph destination. The other citation remains usable.
    assert.deepEqual(edited.summary.claims[0].sources, [{ ...native.claims[0].sources[1], paragraphID: 3 }]);
  }
  for (const [edition, summary] of Object.entries({ withoutSummary: null, legacy, populated: { ...legacy, claims: native.claims } })) {
    const input = { ...paper, summary };
    const standalone = markdownDocuments(input, undefined, 'analysis')[0].content;
    const bundled = markdownDocuments(input).find(doc => doc.kind === 'analysis').content;
    assert.equal(standalone, bundled);
    assert.equal(beforeParagraphs(standalone), beforeParagraphs(native[edition]), edition + ' summary and sources');
    for (const output of [standalone, native[edition]]) {
      const firstHeading = output.search(/^#{2,3} Paragraph 1$/m);
      const secondHeading = output.search(/^#{2,3} Paragraph 2$/m);
      const appendix = output.indexOf('## Other Saved Highlights and Notes');
      assert.ok(firstHeading >= 0 && secondHeading > firstHeading && appendix > secondHeading);
      const one = output.slice(firstHeading, secondHeading);
      const two = output.slice(secondHeading, appendix);
      assert.ok(one.includes(first) && one.includes(native.translation) && one.includes('Bookmarked in PaperBridge'));
      assert.ok(one.includes('tabular data') && one.includes('Check the input format.'));
      assert.ok(two.includes(second) && two.includes('[Translation failed] Model interrupted'));
      assert.doesNotMatch(two, /Bookmarked in PaperBridge|Check the input format/);
      assert.ok(output.slice(appendix).includes('a reader') && output.slice(appendix).includes('Compare with the abstract.'));
    }
  }
}
