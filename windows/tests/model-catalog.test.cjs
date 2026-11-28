const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = import('../src/modelCatalog.mjs');

test('translation selection updates following and missing assistant roles but preserves installed specialists', async () => {
  const { TRANSLATION_MODELS, modelSettingsPatch } = await catalog;
  const settings = { translationModel: 'translategemma:4b', summaryModel: 'translategemma:4b', explainModel: 'qwen3:8b', quickLookupModel: 'missing:model' };
  assert.deepEqual(modelSettingsPatch(settings, TRANSLATION_MODELS[1], ['translategemma:4b', 'translategemma:12b', 'qwen3:8b']), {
    translationModel: 'translategemma:12b', summaryModel: 'translategemma:12b', quickLookupModel: 'translategemma:12b'
  });
  assert.equal(settings.explainModel, 'qwen3:8b');
});

test('assistant selection sets three assistant roles and leaves translation independent', async () => {
  const { ASSISTANT_MODELS, modelSettingsPatch, isCatalogModelSelected } = await catalog;
  const settings = { translationModel: 'translategemma:12b', summaryModel: 'a', explainModel: 'b', quickLookupModel: 'c' };
  const installed = ['qwen3:4b-instruct'];
  const patch = modelSettingsPatch(settings, ASSISTANT_MODELS[0], installed);
  assert.deepEqual(patch, { summaryModel: 'qwen3:4b-instruct', explainModel: 'qwen3:4b-instruct', quickLookupModel: 'qwen3:4b-instruct' });
  assert.equal(isCatalogModelSelected({ ...settings, ...patch }, ASSISTANT_MODELS[0], installed), true);
  assert.equal(isCatalogModelSelected({ ...settings, ...patch, summaryModel: 'different' }, ASSISTANT_MODELS[0], installed), false);
  assert.throws(() => modelSettingsPatch(settings, ASSISTANT_MODELS[1], installed), /Download/);
});

test('memory suggestions use system RAM and never mistake Windows adapter memory for RAM or available VRAM', async () => {
  const { suggestedTranslationModel } = await catalog;
  for (const hardware of [undefined, { systemMemoryBytes: NaN }, { systemMemoryBytes: -1 }, { adapters: [{ memoryBytes: 128 * 1024 ** 3 }] }]) {
    assert.equal(suggestedTranslationModel(hardware).id, 'translategemma:4b');
  }
  assert.equal(suggestedTranslationModel({ systemMemoryBytes: 16 * 1024 ** 3 }).id, 'translategemma:4b');
  assert.equal(suggestedTranslationModel({ systemMemoryBytes: 32 * 1024 ** 3 }).id, 'translategemma:12b');
  assert.equal(suggestedTranslationModel({ systemMemoryBytes: 64 * 1024 ** 3 }).id, 'translategemma:27b');
  const card = (vendor, gib) => ({ vendor, dedicatedMemoryBytes: gib * 1024 ** 3 });
  const suggest = (ram, ...adapters) => suggestedTranslationModel({ systemMemoryBytes: ram * 1024 ** 3, adapters }).id;
  assert.equal(suggest(64, card('AMD', 0.5), card('AMD', 16)), 'translategemma:12b');
  assert.equal(suggest(64, card('NVIDIA', 8), card('NVIDIA', 8)), 'translategemma:4b');
  assert.equal(suggest(64, card('NVIDIA', 24)), 'translategemma:27b');
  assert.equal(suggest(12, card('NVIDIA', 24)), 'translategemma:4b');
  assert.equal(suggest(64, card('Intel', 0.5)), 'translategemma:4b');
  assert.equal(suggest(64, { vendor: 'AMD', memoryBytes: 2 ** 32 - 1 }), 'translategemma:27b');
  const hardware = { systemMemoryBytes: 64 * 1024 ** 3, adapters: [card('AMD', 16)] };
  const onDisk = (freeBytes, installed = []) => suggestedTranslationModel(hardware, undefined, { freeBytes }, installed)?.id;
  assert.equal(onDisk(8.1e9), 'translategemma:12b');
  assert.equal(onDisk(8.1e9 - 1), 'translategemma:4b');
  assert.equal(onDisk(155648), undefined);
  assert.equal(onDisk(155648, ['translategemma:4b']), 'translategemma:4b');
  assert.equal(onDisk(155648, ['translategemma:12b']), 'translategemma:12b');
  assert.equal(onDisk(155648, ['translategemma:27b']), undefined);
  assert.equal(onDisk(null), 'translategemma:12b');
});
