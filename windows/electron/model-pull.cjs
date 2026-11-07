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

module.exports = { createModelPullManager };
