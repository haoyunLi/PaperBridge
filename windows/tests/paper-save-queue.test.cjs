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
