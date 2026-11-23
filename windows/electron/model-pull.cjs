const { ollamaRequest } = require('./ollama-http.cjs');
const { readOllamaModelList, hasOllamaModel } = require('./ollama-models.mjs');

async function pullOllamaModel(baseURL, model, signal, update) {
  if (!/^[\w./:-]{2,100}$/.test(model)) throw new Error('Invalid model name.');
  const response = await ollamaRequest(baseURL, 'api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  let buffer = '', completed = false;
  function progressLine(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (event.status?.toLowerCase() === 'success') completed = true;
    update(event);
  }
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = (buffer + text).split('\n');
    buffer = lines.pop();
    for (const line of lines) progressLine(line);
  }
  progressLine(buffer);
  if (!completed) {
    // A proxy or Ollama may close the progress stream without its final success record.
    const tags = await ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    if (!hasOllamaModel(await readOllamaModelList(tags), model)) {
      throw new Error('The model download ended before Ollama confirmed installation. Retry the download to resume it.');
    }
  }
  return true;
}

function createModelPullManager({ pullModel, emit, isSetupBusy = () => false }) {
  let active = null;

  return {
    get busy() { return active !== null; },

    async pull({ baseURL, model }) {
      if (active) throw new Error('A model download is already running. Cancel it or wait for it to finish.');
      if (isSetupBusy()) throw new Error('Local AI setup is running. Wait for it to finish before downloading another model.');
      const controller = new AbortController();
      const task = { controller, model };
      active = task;
      const send = (phase, status, extra = {}) => emit({ kind: 'model', model, phase, status, ...extra });
      try {
        send('pulling', `Starting ${model} download…`);
        const result = await pullModel(baseURL, model, controller.signal, event => {
          if (active !== task || controller.signal.aborted) return;
          send('pulling', event.status, { completed: event.completed, total: event.total });
        });
        controller.signal.throwIfAborted();
        send('done', `${model} is downloaded.`);
        return result;
      } catch (cause) {
        const error = controller.signal.aborted ? Object.assign(new Error('Model download cancelled. Ollama can resume it later.'), { name: 'AbortError' }) : cause;
        send(controller.signal.aborted ? 'cancelled' : 'error', error.message);
        throw error;
      } finally {
        if (active === task) active = null;
      }
    },

    cancel() {
      if (!active) return false;
      active.controller.abort();
      return true;
    }
  };
}

module.exports = { createModelPullManager, pullOllamaModel };
