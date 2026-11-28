const test = require('node:test');
const assert = require('node:assert/strict');
const queueModule = import('../src/paperSaveQueue.mjs');

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('debounce coalesces drafts and flush persists the newest snapshot', async () => {
  const { createPaperSaveQueue } = await queueModule;
  const saved = [];
  const queue = createPaperSaveQueue({ save: async paper => { saved.push(paper.body); return paper.body; } });
  queue.schedule({ body: 'a' }, 350);
  queue.schedule({ body: 'ab' }, 350);
  queue.schedule({ body: 'ab ' }, 350);
  assert.equal(queue.hasPending(), true);
  assert.equal(await queue.flush(), true);
  assert.deepEqual(saved, ['ab ']);
  assert.equal(queue.state().status, 'saved');
});

test('an old completion cannot replace the status of a newer save', async () => {
  const { createPaperSaveQueue } = await queueModule;
  const first = deferred();
  const calls = [];
  const states = [];
  const queue = createPaperSaveQueue({
    save: paper => { calls.push(paper.body); return paper.body === 'first' ? first.promise : Promise.resolve('second'); },
    onState: state => states.push({ ...state })
  });
  queue.schedule({ body: 'first' });
  queue.schedule({ body: 'second' });
  first.resolve('first');
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(queue.state().status, 'saved');
  assert.equal(states.filter(item => item.status === 'saved').length, 1);
});

test('a failed latest snapshot remains retryable without losing its exact body', async () => {
  const { createPaperSaveQueue } = await queueModule;
  let attempts = 0;
  const bodies = [];
  const queue = createPaperSaveQueue({ save: async paper => { attempts++; bodies.push(paper.body); if (attempts === 1) throw new Error('disk full'); return []; } });
  queue.schedule({ body: '  exact draft\n' });
  assert.equal(await queue.flush(), false);
  assert.equal(queue.state().status, 'error');
  assert.match(queue.state().error.message, /disk full/);
  assert.equal(await queue.retry(), true);
  assert.deepEqual(bodies, ['  exact draft\n', '  exact draft\n']);
  assert.equal(queue.state().status, 'saved');
});

test('flush drains a debounced note added while an earlier paper save is pending', { timeout: 2000 }, async () => {
  const { createPaperSaveQueue } = await queueModule;
  const first = deferred(), second = deferred(), started = deferred();
  const calls = [];
  // Keep the debounce pending until flush explicitly drains it; no wall-clock race.
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  const latest = { id: 'current-paper', body: '  newer note\nwhile saving  ' };
  const queue = createPaperSaveQueue({ timers, save: paper => {
    calls.push(paper);
    if (calls.length === 1) { started.resolve(); return first.promise; }
    return second.promise;
  } });
  queue.schedule({ id: 'current-paper', body: 'earlier note' });
  let settled = false;
  const flushing = queue.flush().then(value => { settled = true; return value; });
  try {
    await started.promise;
    queue.schedule(latest, 350);
    first.resolve([]);
    await new Promise(setImmediate);
    assert.equal(settled, false, 'opening another paper must wait for the newer note too');
    assert.equal(calls.length, 2, 'flush must start the draft that arrived during its wait');
    assert.strictEqual(calls[1], latest);
    assert.equal(queue.hasPending(), false);
    second.resolve([]);
    assert.equal(await flushing, true);
    assert.equal(queue.state().status, 'saved');
    assert.equal(queue.hasPending(), false);
  } finally {
    first.resolve([]); second.resolve([]);
    await flushing;
  }
});

test('flush waits for an immediately queued newer save and preserves its failure for retry', { timeout: 2000 }, async () => {
  const { createPaperSaveQueue } = await queueModule;
  const first = deferred(), second = deferred(), started = deferred();
  const bodies = [];
  const latest = '  latest exact note\n';
  const queue = createPaperSaveQueue({ save: paper => {
    bodies.push(paper.body);
    if (bodies.length === 1) { started.resolve(); return first.promise; }
    if (bodies.length === 2) return second.promise;
    return Promise.resolve([]);
  } });
  queue.schedule({ body: 'earlier note' });
  let settled = false;
  const flushing = queue.flush().then(value => { settled = true; return value; });
  try {
    await started.promise;
    queue.schedule({ body: latest });
    assert.equal(queue.hasPending(), false, 'the newer save is already chained, not debounced');
    first.resolve([]);
    await new Promise(setImmediate);
    assert.equal(settled, false, 'flush must follow a changed save chain');
    second.reject(new Error('disk full while saving newer note'));
    assert.equal(await flushing, false, 'a failed newer save must prevent the paper switch');
    assert.equal(queue.state().status, 'error');
    assert.match(queue.state().error.message, /disk full/);
    assert.equal(await queue.retry(), true);
    assert.deepEqual(bodies, ['earlier note', latest, latest]);
    assert.equal(queue.state().status, 'saved');
  } finally {
    first.resolve([]); second.resolve([]);
    await flushing;
  }
});
