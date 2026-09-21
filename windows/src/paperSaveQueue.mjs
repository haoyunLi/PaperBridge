export function createPaperSaveQueue({ save, onState = () => {}, onSaved = () => {}, delay = 350, timers = globalThis }) {
  let timer = null;
  let pending = null;
  let failed = null;
  let revision = 0;
  let latestRevision = 0;
  let chain = Promise.resolve();
  let state = { status: 'idle', error: null, revision: 0 };

  const emit = (status, error = null, at = latestRevision) => {
    state = { status, error, revision: at };
    onState(state);
  };
  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const start = request => {
    if (!request) return chain;
    const operation = chain.then(() => save(request.paper));
    chain = operation.then(result => {
      if (request.revision === latestRevision) {
        failed = null;
        emit('saved', null, request.revision);
        onSaved(result, request.paper);
      }
    }, error => {
      if (request.revision === latestRevision) {
        failed = request;
        emit('error', error, request.revision);
      }
    });
    return chain;
  };
  const startPending = () => {
    cancelTimer();
    const request = pending;
    pending = null;
    return start(request);
  };

  return {
    schedule(paper, wait = 0) {
      cancelTimer();
      const request = { paper, revision: ++revision };
      latestRevision = request.revision;
      pending = request;
      failed = null;
      emit('saving', null, request.revision);
      if (wait > 0) timer = timers.setTimeout(startPending, wait);
      else startPending();
      return request.revision;
    },
    async flush() {
      startPending();
      await chain;
      return state.status !== 'error';
    },
    async retry() {
      if (!failed) return state.status !== 'error';
      const request = { paper: failed.paper, revision: ++revision };
      latestRevision = request.revision;
      failed = null;
      emit('saving', null, request.revision);
      await start(request);
      return state.status !== 'error';
    },
    state() { return state; },
    hasPending() { return Boolean(pending || timer !== null); },
    defaultDelay: delay
  };
}

