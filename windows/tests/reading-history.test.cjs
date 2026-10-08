const test = require('node:test');
const assert = require('node:assert/strict');
const historyModule = import('../src/readingHistory.mjs');

function location(block, extra = {}) {
  return { paperId: 'paper', tab: 'Reader', displayMode: 'bilingual', block, page: 1, search: '', scrollByTab: { Reader: block * 100 }, ...extra };
}

test('reading history restores full locations in both directions and clears a forward branch', async () => {
  const { createReadingHistory } = await historyModule;
  const history = createReadingHistory();
  const summary = location(1, { tab: 'Summary', displayMode: 'translation', search: 'evidence', scrollByTab: { Summary: 280 } });
  const readerTwo = location(2);
  const readerFour = location(4, { scrollByTab: { Reader: 740, 'Original:2': 120 } });
  history.record(summary);
  history.record(readerTwo);
  assert.deepEqual(history.goBack(readerFour), readerTwo);
  assert.deepEqual(history.goBack(readerTwo), summary);
  assert.deepEqual(history.goForward(summary), readerTwo);
  history.record(location(7));
  assert.equal(history.canGoForward(), false);
});

test('reading history de-duplicates adjacent origins, caps at 50 and resets between papers', async () => {
  const { createReadingHistory } = await historyModule;
  const history = createReadingHistory(50);
  history.record(location(1));
  history.record({ ...location(1), scrollByTab: { Reader: 100 } });
  assert.equal(history.snapshot().back.length, 1);
  for (let index = 2; index <= 70; index++) history.record(location(index));
  const snapshot = history.snapshot();
  assert.equal(snapshot.back.length, 50);
  assert.equal(snapshot.back[0].block, 21);
  snapshot.back[0].block = 999;
  assert.equal(history.snapshot().back[0].block, 21, 'callers cannot mutate history internals');
  history.reset();
  assert.deepEqual(history.snapshot(), { back: [], forward: [] });
});

test('locations include tab, mode, search, page and every sorted surface offset', async () => {
  const { normalizeReadingLocation, sameReadingLocation } = await historyModule;
  const value = normalizeReadingLocation({ paperId: 'p', tab: 'Original', displayMode: 'source', block: 3, page: 2, search: 'term', scrollByTab: { Summary: 8, Reader: '4', broken: 'x' } });
  assert.deepEqual(value, { paperId: 'p', tab: 'Original', displayMode: 'source', block: 3, page: 2, search: 'term', scrollByTab: { Reader: 4, Summary: 8 } });
  assert.equal(sameReadingLocation(value, { ...value, scrollByTab: { Summary: 8, Reader: 4 } }), true);
  assert.equal(sameReadingLocation(value, { ...value, page: 3 }), false);
});
