const { stopWorker } = require('./stop-worker.cjs');

function cancellationError() {
  const error = new Error('MinerU parsing was cancelled.');
  error.name = 'AbortError';
  return error;
}

function createMineruJobGuard() {
  let active = null;
  return {
    get busy() { return active !== null; },
    begin() {
      if (active) throw new Error('MinerU is already processing a PDF. Stop it before starting another.');
      active = { cancelled: false, child: null };
      return active;
    },
    check(job) { if (active !== job || job.cancelled) throw cancellationError(); },
    attach(job, child) {
      if (active !== job || job.cancelled) { stopWorker(child); throw cancellationError(); }
      job.child = child;
    },
    detach(job, child) { if (job.child === child) job.child = null; },
    cancel() {
      if (!active) return false;
      if (active.cancelled) return true;
      active.cancelled = true;
      stopWorker(active.child);
      return true;
    },
    finish(job) { if (active === job) active = null; }
  };
}

module.exports = { createMineruJobGuard };
