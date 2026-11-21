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
