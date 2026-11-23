const { ollamaRequest, ollamaIdleMs, ollamaTotalMs } = require('./ollama-http.cjs');
const { readOllamaModelList, hasOllamaModel } = require('./ollama-models.mjs');

function downloadError(cause) {
  if (!/not enough space on the disk|disk (?:is )?full|no space left on device|ENOSPC|磁盘(?:上的)?空间不足|磁盘已满/i.test(cause.message)) return cause;
  const drive = cause.message.match(/\b([a-z]):[\\/]/i)?.[1]?.toUpperCase();
  return new Error('The Ollama model drive' + (drive ? ' (' + drive + ':)' : '') +
    ' is full. Free disk space and retry to resume the download, or choose an installed model.');
}

async function pullOllamaModel(baseURL, model, signal, update, { idleMs = ollamaIdleMs, totalMs = ollamaTotalMs } = {}) {
  if (!/^[\w./:-]{2,100}$/.test(model)) throw new Error('Invalid model name.');
  const idle = new AbortController();
  const deadline = AbortSignal.timeout(totalMs);
  const activity = setTimeout(() => idle.abort(), idleMs);
  const combined = AbortSignal.any([signal, idle.signal, deadline]);
  try {
    return await readModelTransfer(baseURL, model, combined, update, activity);
  } catch (cause) {
    signal.throwIfAborted();
    if (idle.signal.aborted) throw new Error('Ollama stopped responding during the model download. Retry to resume the download.');
    if (deadline.aborted) throw new Error('The model download reached its time limit. Retry to resume the download.');
    throw downloadError(cause);
  } finally { clearTimeout(activity); }
}

async function readModelTransfer(baseURL, model, signal, update, activity) {
  const response = await ollamaRequest(baseURL, 'api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }), signal });
  activity.refresh();
  let buffer = '', completed = false;
  function progressLine(line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { /* Incomplete proxy replies cannot confirm a model download. */ }
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        (event.status != null && typeof event.status !== 'string') || (event.error != null && typeof event.error !== 'string')) {
      throw new Error('Ollama returned an unreadable download progress message. Retry to resume the download.');
    }
    if (event.error) throw new Error(event.error);
    const status = event.status ?? `Downloading ${model}...`;
    if (status.toLowerCase() === 'success') completed = true;
    update({ ...event, status });
  }
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    activity.refresh();
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
