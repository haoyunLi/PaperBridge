const test = require('node:test');
const assert = require('node:assert/strict');

test('AI provider keeps local and OpenAI task models independent', async () => {
  const { activeAIModel, aiCacheNamespace } = await import('../src/aiSettings.mjs');
  const settings = { aiProvider: 'ollama', ollamaBaseURL: 'http://localhost:11434', translationModel: 'local-translate', openAITranslationModel: 'online-translate', translationStyleGuide: '' };
  assert.equal(activeAIModel(settings, 'translation'), 'local-translate');
  assert.equal(aiCacheNamespace(settings), 'http://localhost:11434');
  settings.aiProvider = 'openai';
  assert.equal(activeAIModel(settings, 'translation'), 'online-translate');
  assert.equal(aiCacheNamespace(settings), 'openai:https://api.openai.com/v1');
});

test('translation instructions include bounded title and style in the cache namespace', async () => {
  const { aiCacheNamespace, translationInstructions } = await import('../src/aiSettings.mjs');
  const settings = { aiProvider: 'openai', translationStyleGuide: ` concise ${'x'.repeat(2100)}` };
  const instructions = translationInstructions(settings, 'Chinese', 'Paper title', 'Return only Chinese.');
  assert.match(instructions, /Document title.*Paper title/);
  assert.match(instructions, /Preferred translation style/);
  assert.ok(aiCacheNamespace(settings).length < 2100);
});

test('OpenAI setup remains session gated and never falls back to Ollama', async () => {
  const { openAISetupMessage } = await import('../src/aiSettings.mjs');
  const settings = { aiProvider: 'openai', openAITranslationModel: '', translationModel: 'local' };
  assert.match(openAISetupMessage(settings, false, true, 'translation'), /allow sending/);
  assert.match(openAISetupMessage(settings, true, false, 'translation'), /API key/);
  assert.match(openAISetupMessage(settings, true, true, 'translation'), /Choose an OpenAI model/);
  settings.openAITranslationModel = 'gpt-test';
  assert.equal(openAISetupMessage(settings, true, true, 'translation'), '');
});
