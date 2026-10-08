function cancellationError() {
  const error = new Error('MinerU parsing was cancelled.');
  error.name = 'AbortError';
  return error;
}

function createMineruJobGuard() {
  let active = null;
  return {
    begin() {
      if (active) throw new Error('MinerU is already processing a PDF. Stop it before starting another.');
      active = { cancelled: false, child: null };
      return active;
    },
    check(job) { if (active !== job || job.cancelled) throw cancellationError(); },
    attach(job, child) {
      if (active !== job || job.cancelled) { child.kill(); throw cancellationError(); }
      job.child = child;
    },
    detach(job, child) { if (job.child === child) job.child = null; },
    cancel() {
      if (!active) return false;
      active.cancelled = true;
      active.child?.kill();
      return true;
    },
    finish(job) { if (active === job) active = null; }
  };
}

module.exports = { createMineruJobGuard };
