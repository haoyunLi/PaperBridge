const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createModelPullManager, pullOllamaModel } = require('../electron/model-pull.cjs');

test('streamed model downloads reset the idle timer on data and recover after a stall or deadline', async t => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/headers/')) return;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"status":"pulling"}\n');
    if (req.url.startsWith('/stalled/')) return;
    let ticks = 0;
    const heartbeat = setInterval(() => {
      if (++ticks === 12 && req.url.startsWith('/active/')) res.end('{"status":"success"}\n');
      else res.write('{"status":"pulling"}\n');
    }, 50);
    res.once('close', () => clearInterval(heartbeat));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const signal = new AbortController().signal, base = 'http://127.0.0.1:' + server.address().port;
  const pull = (scenario, idleMs, totalMs) => pullOllamaModel(base + '/' + scenario, 'reader:4b', signal, () => {}, { idleMs, totalMs });
  await assert.rejects(pull('headers', 250, 5000), /stopped responding.*Retry to resume/);
  await assert.rejects(pull('stalled', 250, 5000), /stopped responding.*Retry to resume/);
  await assert.rejects(pull('continuous', 1500, 450), /time limit.*Retry to resume/);
  assert.equal(await pull('active', 400, 5000), true);
});

test('model download cancellation aborts its request, rejects duplicate pulls, and permits retry', async () => {
  const events = [];
  let attempt = 0;
  let firstSignal;
  const manager = createModelPullManager({
    emit: event => events.push(event),
    pullModel: async (_baseURL, _model, signal, update) => {
      attempt++;
      if (attempt > 1) return true;
      firstSignal = signal;
      update({ status: 'downloading', completed: 25, total: 100 });
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  });
  const first = manager.pull({ baseURL: 'http://localhost:11434', model: 'test:4b' });
  const cancelled = assert.rejects(first, { name: 'AbortError', message: 'Model download cancelled. Ollama can resume it later.' });
  assert.equal(manager.busy, true);
  await assert.rejects(manager.pull({ model: 'other:4b' }), /already running/);
  assert.equal(attempt, 1);
  assert.equal(manager.cancel(), true);
  assert.equal(firstSignal.aborted, true);
  await cancelled;
  assert.equal(manager.busy, false);
  assert.equal(manager.cancel(), false);
  assert.equal(events.at(-1).phase, 'cancelled');
  assert.equal(await manager.pull({ model: 'test:4b' }), true);
  assert.equal(attempt, 2);
  assert.equal(events.at(-1).phase, 'done');
});

test('a cancelled download keeps its lock until settled and cannot report stale progress or success', async () => {
  const events = [];
  let finish;
  let update;
  const manager = createModelPullManager({
    emit: event => events.push(event),
    pullModel: (_baseURL, _model, _signal, onUpdate) => {
      update = onUpdate;
      return new Promise(resolve => { finish = resolve; });
    }
  });
  const pending = manager.pull({ model: 'test:4b' });
  const cancelled = assert.rejects(pending, /download cancelled/);
  manager.cancel();
  update({ status: 'stale update', completed: 100, total: 100 });
  assert.equal(events.some(event => event.status === 'stale update'), false);
  assert.equal(manager.busy, true);
  await assert.rejects(manager.pull({ model: 'next:4b' }), /already running/);
  finish(true);
  await cancelled;
  update({ status: 'late callback' });
  assert.deepEqual(events.map(event => event.phase), ['pulling', 'cancelled']);
  assert.equal(manager.busy, false);
});

test('manual model download is blocked during Local AI setup', async () => {
  let setupBusy = true;
  let calls = 0;
  const manager = createModelPullManager({
    emit: () => {},
    isSetupBusy: () => setupBusy,
    pullModel: async () => { calls++; return true; }
  });
  await assert.rejects(manager.pull({ model: 'test:4b' }), /Local AI setup is running/);
  assert.equal(calls, 0);
  assert.equal(manager.busy, false);
  setupBusy = false;
  assert.equal(await manager.pull({ model: 'test:4b' }), true);
  assert.equal(calls, 1);
});

test('failed download releases its lock and retains the Ollama error', async () => {
  const events = [];
  const manager = createModelPullManager({
    emit: event => events.push(event),
    pullModel: async () => { throw new Error('model not found'); }
  });
  await assert.rejects(manager.pull({ model: 'missing:4b' }), /model not found/);
  assert.equal(manager.busy, false);
  assert.equal(events.at(-1).phase, 'error');
  assert.equal(events.at(-1).status, 'model not found');
});
