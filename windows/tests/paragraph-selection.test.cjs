const test = require('node:test');
const assert = require('node:assert/strict');
const selectionModule = import('../src/paragraphSelection.mjs');

const blocks = [{ id: 1, resource: { type: 'image' } }, { id: 4, heading: true }, { id: 12, text: 'A readable paragraph.' }];

test('a selected paragraph is independent from its saved viewport and need not have a contiguous ID', async () => {
  const { resolveSelectedParagraphID, firstSelectableParagraphID, isSelectableParagraphID } = await selectionModule;
  assert.equal(resolveSelectedParagraphID({ blocks, selectedParagraphID: 4, position: { block: 12 } }), 4);
  assert.equal(resolveSelectedParagraphID({ blocks, selectedParagraphID: 12, position: { block: 4 } }), 12);
  assert.equal(firstSelectableParagraphID(blocks), 4, 'headings are selectable, resources are not');
  assert.equal(isSelectableParagraphID(12, blocks), true);
  assert.equal(isSelectableParagraphID(1, blocks), false);
  assert.equal(isSelectableParagraphID(2, blocks), false, 'array indexes are not paragraph IDs');
});

test('only a missing selection migrates from the legacy viewport; explicit null stays unselected', async () => {
  const { resolveSelectedParagraphID } = await selectionModule;
  const legacy = { blocks, position: { block: 12 } };
  assert.equal(resolveSelectedParagraphID(legacy), 12);
  assert.equal(Object.hasOwn(legacy, 'selectedParagraphID'), false, 'reading old workspaces does not write a migration');
  assert.equal(resolveSelectedParagraphID({ ...legacy, selectedParagraphID: null }), null);
  assert.equal(resolveSelectedParagraphID({ ...legacy, selectedParagraphID: undefined }), 4, 'an explicitly malformed value is not a legacy missing field');
});

test('stale or malformed explicit selections fall back to a real paragraph instead of the viewport', async () => {
  const { resolveSelectedParagraphID, isSelectableParagraphID } = await selectionModule;
  for (const value of [1, 2, 0, -1, 1.5, '12', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    assert.equal(isSelectableParagraphID(value, blocks), false);
    assert.equal(resolveSelectedParagraphID({ blocks, position: { block: 12 }, selectedParagraphID: value }), 4);
  }
  const changedSource = { blocks: [{ id: 100 }, { id: 200 }], selectedParagraphID: 12, position: { block: 200 } };
  assert.equal(resolveSelectedParagraphID(changedSource), 100, 'the destination source validates its own paragraph IDs');
});

test('missing or invalid legacy viewport falls back to the first available paragraph', async () => {
  const { resolveSelectedParagraphID } = await selectionModule;
  assert.equal(resolveSelectedParagraphID({ blocks }), 4);
  for (const block of [1, 2, 0, -1, 1.5, '12', null, undefined]) {
    assert.equal(resolveSelectedParagraphID({ blocks, position: { block } }), 4);
  }
});

test('empty or resource-only documents have no selected paragraph', async () => {
  const { resolveSelectedParagraphID, firstSelectableParagraphID, isSelectableParagraphID } = await selectionModule;
  for (const entries of [undefined, null, [], [{ id: 2, resource: true }], [null, {}, { id: '3' }, { id: 0 }]]) {
    assert.equal(firstSelectableParagraphID(entries), null);
    assert.equal(isSelectableParagraphID(2, entries), false);
    assert.equal(resolveSelectedParagraphID({ blocks: entries, selectedParagraphID: 2, position: { block: 2 } }), null);
  }
  assert.equal(resolveSelectedParagraphID(null), null);
  assert.equal(resolveSelectedParagraphID(undefined), null);
});

test('selection resolution leaves saved work, position and cached outputs unchanged', async () => {
  const { resolveSelectedParagraphID } = await selectionModule;
  const paper = { id: 'legacy-paper', blocks: [{ id: 4, text: 'Source', translation: 'Saved translation', notes: [{ body: 'Keep this note.' }] }],
    position: { block: 4, tab: 'Reader', scrollByTab: { Reader: 800 }, readerSearchOrigin: { block: 4, scrollTop: 800, offset: -12 } },
    sourceSettings: { pdf: { targetLanguage: 'Chinese' } }, paragraphExplanations: { saved: { output: 'Keep this explanation.' } } };
  const before = structuredClone(paper);
  assert.equal(resolveSelectedParagraphID(paper), 4);
  assert.deepEqual(paper, before);
  const migrated = { ...paper, selectedParagraphID: resolveSelectedParagraphID(paper) };
  assert.equal(resolveSelectedParagraphID(JSON.parse(JSON.stringify(migrated))), 4);
  assert.deepEqual(migrated.position, before.position);
  assert.deepEqual(migrated.blocks, before.blocks);
});
