const test = require('node:test');
const assert = require('node:assert/strict');

test('legacy Paper offsets migrate when a display mode first records its position', async () => {
  const { paperModeViewport, storePaperViewport } = await import('../src/paperScroll.mjs');
  const { persistedReadingPosition } = await import('../src/readingHistory.mjs');
  const anchor = { blockId: '2', side: 'source', text: 'Results', offset: -5, scrollTop: 120 };
  const legacy = { displayMode: 'bilingual', scrollByTab: { Paper: 120, Reader: 800 }, paperAnchor: anchor };
  assert.deepEqual(paperModeViewport(legacy, 'mineru', 'bilingual'), { scrollTop: 120, anchor });
  const recorded = persistedReadingPosition({ tab: 'Paper', sourceMode: 'mineru', displayMode: 'bilingual',
    scrollByTab: legacy.scrollByTab, paperAnchor: anchor }, legacy);
  assert.deepEqual(paperModeViewport(recorded, 'mineru', 'translation'), { scrollTop: 0, anchor: null });
  const translated = storePaperViewport(recorded, 'mineru', 'translation', 375, null);
  assert.deepEqual(paperModeViewport(translated, 'mineru', 'bilingual'), { scrollTop: 120, anchor });
  assert.equal(paperModeViewport(translated, 'mineru', 'translation').scrollTop, 375);
  assert.equal(paperModeViewport(translated, 'pdf', 'translation').scrollTop, 0);
  assert.equal(translated.scrollByTab.Reader, 800);
  assert.equal(legacy.scrollByTab.Paper, 120);
});
