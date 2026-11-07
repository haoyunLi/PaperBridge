const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults } = require('../electron/storage.cjs');
const languages = import('../src/outputLanguages.mjs');
const cache = import('../src/outputCache.mjs');
const markdown = import('../src/academicMarkdown.mjs');
const french = { sourceLanguage: 'English', targetLanguage: 'French' };
const german = { sourceLanguage: 'English', targetLanguage: 'German' };
const settings = { ...defaults, ...french };
const block = (id, translation = 'Saved translation', extra = {}) => ({ id, text: `Passage ${id}.`,
  status: 'ok', translation, translationMarkdown: null, error: '', translationHighlights: [],
  notes: [{ id: `note-${id}`, body: 'Preserve note' }], ...extra });

test('output language accepts the eleven explicit languages and never guesses an ambiguous Chinese script', async () => {
  const { normalizeOutputLanguage, commonOutputLanguage } = await languages;
  for (const targetLanguage of ['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'French',
    'German', 'Spanish', 'Italian', 'Portuguese', 'Russian']) {
    assert.deepEqual(normalizeOutputLanguage({ sourceLanguage: 'English', targetLanguage, irrelevant: true }), { sourceLanguage: 'English', targetLanguage });
  }
  for (const value of [null, undefined, {}, { targetLanguage: 'French' }, { ...french, sourceLanguage: 'Chinese' },
    { ...french, targetLanguage: 'Chinese' }, Object.create(french)]) assert.equal(normalizeOutputLanguage(value), null);
  assert.deepEqual(commonOutputLanguage([french, { ...french }]), french);
  for (const pairs of [[], [null], [french, null], [french, german], [french, {}]]) assert.equal(commonOutputLanguage(pairs), null);
});

test('first migration uses only raw explicit settings, preserves unknown, and is pure and idempotent', async () => {
  const { migrateOutputLanguages } = await languages;
  const original = { taskSettings: { ...settings }, blocks: [block(1), block(2, 'Unknown result', { translationLanguage: null }),
    block(3, '', { translationLanguage: german })], pdfBlocks: [block(1, 'Inactive PDF')], mineruBlocks: [block(1, 'Inactive OCR')],
    sourceSettings: { mineru: { ...german } }, connectedTranslation: 'Saved full translation',
    connectedBlocks: [{ kind: 'translation', output: 'Saved full translation', status: 'ok' },
      { kind: 'translation', output: 'Untranslated source', status: 'failed', translationLanguage: null }] };
  const snapshot = structuredClone(original), migrated = migrateOutputLanguages(original);
  assert.deepEqual(migrated.blocks.map(item => item.translationLanguage), [french, null, null]);
  assert.equal(migrated.pdfBlocks[0].translationLanguage, null, 'inactive source cannot borrow active task settings');
  assert.deepEqual(migrated.mineruBlocks[0].translationLanguage, german);
  assert.deepEqual(migrated.connectedLanguage, french);
  assert.deepEqual(migrated.connectedBlocks.map(batch => batch.translationLanguage), [french, null]);
  assert.deepEqual(migrateOutputLanguages(migrated), migrated);
  assert.deepEqual(original, snapshot);
  for (const raw of [undefined, {}, { targetLanguage: 'French' }, { ...french, targetLanguage: 'Chinese' }]) {
    const unknown = migrateOutputLanguages({ blocks: [block(1)], taskSettings: raw, connectedTranslation: 'Legacy full' });
    assert.equal(unknown.blocks[0].translationLanguage, null);
    assert.equal(unknown.connectedLanguage, null);
    const saved = JSON.parse(JSON.stringify({ ...unknown, taskSettings: settings }));
    assert.equal(migrateOutputLanguages(saved).blocks[0].translationLanguage, null);
    assert.equal(migrateOutputLanguages(saved).connectedLanguage, null);
  }
});

test('legacy cache entries never acquire language from their keys or from newly complete task settings', async () => {
  const { migrateOutputLanguages } = await languages;
  const original = { blocks: [block(1)], taskSettings: settings, outputVariants: {
    translations: { 'a-key-containing-English-French': [{ source: [1, 'Passage 1.', ''], translation: 'Old cached output' },
      { source: [2, 'Passage 2.', ''], translation: 'Explicit output', translationLanguage: german }] },
    connected: { 'another-English-French-key': { text: 'Legacy draft', stale: true,
      blocks: [{ kind: 'translation', output: 'Legacy draft', status: 'ok' }], notes: [{ body: 'Saved full note' }] } },
    summaries: { keep: { summary: { source: 'Summary', sourceLanguage: 'English', targetLanguage: 'Japanese' } } }
  } };
  const snapshot = structuredClone(original), migrated = migrateOutputLanguages(original);
  const outputs = migrated.outputVariants.translations['a-key-containing-English-French'];
  assert.equal(outputs[0].translationLanguage, null);
  assert.deepEqual(outputs[1].translationLanguage, german);
  const draft = migrated.outputVariants.connected['another-English-French-key'];
  assert.equal(draft.connectedLanguage, null);
  assert.equal(draft.blocks[0].translationLanguage, null);
  assert.deepEqual(draft.notes, original.outputVariants.connected['another-English-French-key'].notes);
  assert.deepEqual(migrated.outputVariants.summaries, original.outputVariants.summaries);
  assert.deepEqual(migrateOutputLanguages(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.deepEqual(original, snapshot);
});

test('unknown output survives settings, serialization and source switches without borrowing later settings', async () => {
  const { switchOutputSettings, switchReadingSource } = await cache;
  const { migrateOutputLanguages, readerOutputLanguage } = await languages;
  let paper = { sourceMode: 'pdf', type: 'pdf', blocks: [block(1, 'Old PDF output')],
    pdfBlocks: [block(1, 'Old PDF output')], mineruBlocks: [block(1, 'Old OCR output')], connectedTranslation: 'Old full output' };
  const next = { ...settings, ...german };
  paper = switchOutputSettings(paper, settings, next);
  assert.equal(paper.blocks[0].translation, '');
  assert.equal(paper.blocks[0].translationLanguage, null);
  assert.equal(paper.connectedLanguage, null);
  paper = JSON.parse(JSON.stringify({ ...paper, taskSettings: next }));
  paper = switchOutputSettings(migrateOutputLanguages(paper), next, settings);
  assert.equal(paper.blocks[0].translation, 'Old PDF output');
  assert.equal(readerOutputLanguage(paper), null);
  assert.equal(paper.connectedTranslation, 'Old full output');
  assert.equal(paper.connectedLanguage, null);
  paper = switchReadingSource(paper, 'mineru', settings);
  assert.equal(paper.blocks[0].translation, 'Old OCR output');
  assert.equal(paper.blocks[0].translationLanguage, null);
  paper = switchReadingSource(paper, 'pdf', settings);
  assert.equal(paper.blocks[0].translation, 'Old PDF output');
  assert.equal(paper.connectedTranslation, 'Old full output');
  assert.equal(paper.connectedLanguage, null);
  assert.deepEqual(paper.blocks[0].notes, block(1).notes);
});

test('known paragraph and connected metadata travel atomically with their cached text and resumable batches', async () => {
  const { switchOutputSettings, switchReadingSource } = await cache;
  const original = { sourceMode: 'pdf', type: 'pdf', taskSettings: settings,
    blocks: [block(1, 'French paragraph', { translationLanguage: french })], mineruBlocks: [block(1, 'OCR paragraph', { translationLanguage: null })],
    connectedTranslation: 'French draft', connectedLanguage: french, connectedBatchVersion: 1,
    connectedBlocks: [{ kind: 'translation', source: 'Passage 1.', output: 'French draft', status: 'ok', translationLanguage: french }],
    viewNotes: [{ id: 'full-note', scope: 'fullTranslation', body: 'Full note' }] };
  const next = { ...settings, ...german };
  const blank = switchOutputSettings(original, settings, next);
  assert.equal(blank.connectedLanguage, null);
  const generated = { ...blank, taskSettings: next, blocks: [block(1, 'German paragraph', { translationLanguage: german })],
    connectedTranslation: 'German draft', connectedLanguage: german,
    connectedBlocks: [{ ...original.connectedBlocks[0], output: 'German draft', translationLanguage: german }] };
  const restored = switchOutputSettings(generated, next, settings);
  assert.deepEqual(restored.blocks, original.blocks);
  assert.equal(restored.connectedTranslation, original.connectedTranslation);
  assert.deepEqual(restored.connectedLanguage, french);
  assert.deepEqual(restored.connectedBlocks, original.connectedBlocks);
  assert.deepEqual(restored.viewNotes, original.viewNotes);
  const again = switchOutputSettings(restored, settings, next);
  assert.equal(again.connectedTranslation, 'German draft');
  assert.deepEqual(again.connectedLanguage, german);
  assert.deepEqual(again.connectedBlocks[0].translationLanguage, german);
  const hidden = switchReadingSource(restored, 'mineru', settings);
  hidden.pdfBlocks = hidden.pdfBlocks.map(item => ({ ...item, text: 'Edited PDF source.' }));
  const stale = switchReadingSource(hidden, 'pdf', settings);
  assert.equal(stale.connectedTranslation, 'French draft');
  assert.equal(stale.connectedStale, true);
  assert.deepEqual(stale.connectedLanguage, french, 'stale text retains its own language');
});

test('reader aggregation retains failed old output provenance and never upgrades untouched unknown paragraphs', async () => {
  const { readerOutputLanguage } = await languages;
  const paper = { taskSettings: settings, blocks: [block(1, 'Old unknown', { translationLanguage: null }),
    block(2, 'New French', { translationLanguage: french }), block(3, 'Resource', { resource: true, translationLanguage: german })] };
  assert.equal(readerOutputLanguage(paper), null);
  paper.blocks[0] = { ...paper.blocks[0], translationLanguage: french };
  assert.deepEqual(readerOutputLanguage(paper), french);
  paper.blocks[0] = { ...paper.blocks[0], status: 'failed', translationLanguage: german };
  assert.equal(readerOutputLanguage(paper), null, 'plain export can still include retained failed German output');
  assert.deepEqual(readerOutputLanguage({ taskSettings: settings, blocks: [block(1, '', { translationLanguage: null })] }), french);
  assert.equal(readerOutputLanguage({ blocks: [] }), null);
  const withRefs = { taskSettings: settings, blocks: [block(1, 'French', { translationLanguage: french }),
    block(2, 'References', { text: 'References', heading: true, translationLanguage: german }),
    block(3, 'Citation', { text: '[1] Example. A citation. 2024.', translationLanguage: german })] };
  assert.deepEqual(readerOutputLanguage(withRefs), french);
});

test('shared full language follows only the completed Reader output actually used in its Markdown', async () => {
  const { withSharedMarkdownTranslation } = await markdown;
  const { migrateOutputLanguages } = await languages;
  const original = { sourceMode: 'mineru', taskSettings: settings, blocks: [block(1, 'French', { sourceMarkdown: 'Source one', translationLanguage: french }),
    block(2, 'Old German', { sourceMarkdown: 'Source two', status: 'failed', translationLanguage: german })] };
  const shared = withSharedMarkdownTranslation(original);
  assert.equal(shared.connectedTranslation, 'French\n\nSource two');
  assert.deepEqual(shared.connectedLanguage, french);
  const unknown = withSharedMarkdownTranslation({ ...original, blocks: [{ ...original.blocks[0], translationLanguage: null }, original.blocks[1]] });
  assert.equal(unknown.connectedLanguage, null);
  assert.equal(migrateOutputLanguages(unknown).connectedLanguage, null);
  const allSource = withSharedMarkdownTranslation({ ...original, blocks: [{ ...original.blocks[1], translationLanguage: null }] });
  assert.deepEqual(allSource.connectedLanguage, french);
  const legacyShared = { ...original, connectedShared: true, connectedTranslation: shared.connectedTranslation };
  assert.deepEqual(migrateOutputLanguages(legacyShared).connectedLanguage, french);
  assert.equal(migrateOutputLanguages({ ...legacyShared, connectedLanguage: null }).connectedLanguage, null);
});

test('exact connected batches override a misleading whole language while unrelated and stale drafts keep their own provenance', async () => {
  const { migrateOutputLanguages } = await languages;
  const batches = [
    { kind: 'translation', source: 'First source.', output: 'First output.', status: 'ok', translationLanguage: french },
    { kind: 'translation', source: 'Second source.', output: 'Second output.', status: 'ok', translationLanguage: null }
  ];
  const original = { taskSettings: settings, blocks: [block(1, 'Current German', { translationLanguage: german })],
    connectedTranslation: 'First output.\n\nSecond output.', connectedBlocks: batches };
  assert.equal(migrateOutputLanguages(original).connectedLanguage, null);
  assert.equal(migrateOutputLanguages({ ...original, connectedLanguage: french }).connectedLanguage, null);
  assert.equal(migrateOutputLanguages({ ...original, connectedBlocks: [batches[0], { ...batches[1], translationLanguage: german }] }).connectedLanguage, null);
  const known = { ...original, connectedBlocks: batches.map(batch => ({ ...batch, translationLanguage: french })) };
  assert.deepEqual(migrateOutputLanguages(known).connectedLanguage, french);
  assert.equal(migrateOutputLanguages({ ...known, connectedLanguage: null }).connectedLanguage, null);
  const other = { ...original, connectedTranslation: 'A distinct previously saved draft.', connectedLanguage: german };
  assert.deepEqual(migrateOutputLanguages(other).connectedLanguage, german, 'batch metadata must not describe a different literal artifact');
  for (const connectedStale of [false, true]) {
    const sharedOld = { ...original, connectedShared: true, connectedStale, connectedTranslation: 'Old French shared draft.' };
    assert.deepEqual(migrateOutputLanguages(sharedOld).connectedLanguage, french, 'old shared text cannot borrow current German Reader output');
  }
  const same = { sourceLanguage: 'French', targetLanguage: 'French' };
  const copied = { blocks: [], taskSettings: same, connectedTranslation: 'Same-language copy', connectedBlocks: [
    { kind: 'original', source: 'Same-language copy', output: 'Same-language copy', status: 'ok' }] };
  assert.deepEqual(migrateOutputLanguages(copied).connectedLanguage, same);
  assert.equal(migrateOutputLanguages({ ...copied, taskSettings: settings }).connectedLanguage, null);
});

test('contradictory known whole and exact batch languages retain conflict evidence through migration and cache restoration', async () => {
  const { migrateOutputLanguages } = await languages;
  const { switchOutputSettings } = await cache;
  const { withSharedMarkdownTranslation } = await markdown;
  const original = { blocks: [block(1, 'French paragraph', { translationLanguage: french })], taskSettings: settings,
    connectedTranslation: 'German full draft', connectedLanguage: french, connectedBlocks: [
      { kind: 'translation', source: 'Passage 1.', output: 'German full draft', status: 'ok', translationLanguage: german }] };
  const migrated = migrateOutputLanguages(original);
  assert.equal(migrated.connectedLanguage, null);
  assert.equal(migrated.connectedLanguageConflict, true);
  assert.deepEqual(migrated.connectedBlocks[0].translationLanguage, german);
  assert.deepEqual(migrateOutputLanguages(JSON.parse(JSON.stringify(migrated))), migrated);
  const next = { ...settings, translationModel: 'different-model' };
  const empty = switchOutputSettings(migrated, settings, next);
  assert.equal(empty.connectedLanguageConflict, false);
  const restored = switchOutputSettings(JSON.parse(JSON.stringify(empty)), next, settings);
  assert.equal(restored.connectedTranslation, original.connectedTranslation);
  assert.equal(restored.connectedLanguage, null);
  assert.equal(restored.connectedLanguageConflict, true);
  const unknown = migrateOutputLanguages({ ...original, connectedLanguage: null });
  assert.equal(unknown.connectedLanguageConflict, false, 'ordinary unknown provenance is not evidence of a contradiction');
  const rebuilt = withSharedMarkdownTranslation({ ...migrated, sourceMode: 'mineru', blocks: [
    { ...original.blocks[0], sourceMarkdown: 'Passage 1.' }] });
  assert.equal(rebuilt.connectedTranslation, 'French paragraph');
  assert.deepEqual(rebuilt.connectedLanguage, french);
  assert.equal(rebuilt.connectedLanguageConflict, false, 'newly rebuilt shared text has new provenance');
  const sharedConflict = migrateOutputLanguages({ ...rebuilt, connectedLanguage: german });
  assert.equal(sharedConflict.connectedLanguage, null);
  assert.equal(sharedConflict.connectedLanguageConflict, true);
});
