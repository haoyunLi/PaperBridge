export const usesWindowsOllamaEndpoint = url => /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):11434\/?$/i.test(url);

// Both the setup wizard and the model selectors consume Ollama's /api/tags response.
export async function readOllamaModelList(response) {
  let payload;
  try { payload = await response.json(); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  if (!Array.isArray(payload?.models)) throw new Error('The local URL did not return an Ollama model list. Check the Ollama address in Settings.');
  const names = payload.models.map(item => item?.model || item?.name).filter(name => typeof name === 'string' && name.trim());
  return [...new Set(names)].sort();
}

// Ollama assigns the latest tag when a model name omits its tag.
export function modelKey(name) {
  return typeof name === 'string' ? name.trim().replace(/:latest$/, '') : '';
}

export function hasOllamaModel(installed, name) {
  const wanted = modelKey(name);
  return Boolean(wanted) && installed.some(item => modelKey(item) === wanted);
}

export function missingOllamaModels(required, installed) {
  const seen = new Set(installed.map(modelKey));
  return required.filter(name => {
    const key = modelKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
