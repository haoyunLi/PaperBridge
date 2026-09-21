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
});
