// Matches macOS Models.swift. Sizes were checked against each official Ollama
// tag page on 2026-09-20; they are approximate downloads, not runtime RAM/VRAM.
export const MODEL_CATALOG_VERIFIED_AT = '2026-09-20';
const model = (id, title, role, downloadGB, badge, detail, guidance) => Object.freeze({
  id, title, role, downloadGB, badge, detail, guidance,
  url: `https://ollama.com/library/${id}`
});

export const TRANSLATION_MODELS = Object.freeze([
  model('translategemma:4b', 'TranslateGemma 4B', 'translation', 3.3, 'Start here',
    'The smallest TranslateGemma option for local paper translation.', 'A practical first download when memory or disk space is limited.'),
  model('translategemma:12b', 'TranslateGemma 12B', 'translation', 8.1, 'Larger model',
    'A larger translation model with more local resource use.', 'Consider 24 GB or more system RAM; extra memory is needed for Windows and context.'),
  model('translategemma:27b', 'TranslateGemma 27B', 'translation', 17, 'Largest model',
    'The largest TranslateGemma option in this guide.', 'Consider 48 GB or more system RAM; CPU or partial GPU loading can be slow.')
]);

export const ASSISTANT_MODELS = Object.freeze([
  model('qwen3:4b-instruct', 'Qwen3 4B Instruct', 'assistant', 2.5, 'Suggested assistant',
    'A compact instruction model for multilingual explanations and summaries.', 'A small first assistant download.'),
  model('qwen3:8b', 'Qwen3 8B', 'assistant', 5.2, 'Larger assistant',
    'A larger Qwen option for explanations and reasoning.', 'Allow more memory and response time than the 4B option.'),
  model('gemma3:4b', 'Gemma 3 4B', 'assistant', 3.3, 'Multilingual',
    'A general model for summaries and academic explanations.', 'Uses a separate download from TranslateGemma.'),
  model('llama3.2:3b', 'Llama 3.2 3B', 'assistant', 2.0, 'Small download',
    'A compact model for instruction following and summarization.', 'Review its supported languages before using it for your target language.'),
  model('phi4-mini:3.8b', 'Phi-4 Mini 3.8B', 'assistant', 2.5, 'Math and logic',
    'A compact model with multilingual, mathematical and reasoning capabilities.', 'An alternative for scientific explanations.'),
  model('deepseek-r1:8b', 'DeepSeek R1 8B', 'assistant', 5.2, 'Reasoning',
    'A reasoning model for concepts that need more detailed explanation.', 'Reasoning can take longer and use more context memory.')
]);

export function modelSettingsPatch(settings, selected, installedModels = []) {
  if (!selected?.id || !['translation', 'assistant'].includes(selected.role)) throw new Error('Unknown model role.');
  if (!installedModels.includes(selected.id)) throw new Error('Download this model before selecting it.');
  const assistants = ['summaryModel', 'explainModel', 'quickLookupModel'];
  if (selected.role === 'assistant') return Object.fromEntries(assistants.map(key => [key, selected.id]));
  const patch = { translationModel: selected.id };
  for (const key of assistants) {
    if (!installedModels.includes(settings[key]) || settings[key] === settings.translationModel) patch[key] = selected.id;
  }
  return patch;
}

export function isCatalogModelSelected(settings, selected, installedModels = []) {
  if (!installedModels.includes(selected.id)) return false;
  return selected.role === 'translation' ? settings.translationModel === selected.id
    : ['summaryModel', 'explainModel', 'quickLookupModel'].every(key => settings[key] === selected.id);
}

// Conservative starting points, not an inference about GPU fit or performance.
// AdapterRAM on Windows can be truncated, so it is deliberately not used here.
export function suggestedTranslationModel(hardware) {
  const bytes = Number(hardware?.systemMemoryBytes);
  const gib = Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 ** 3 : 0;
  return TRANSLATION_MODELS[gib >= 48 ? 2 : gib >= 24 ? 1 : 0];
}
