const assert = require('node:assert/strict');
const test = require('node:test');
const { onnxRuntime } = require('../electron/hardware.cjs');
const { setupPlan } = require('../electron/setup.cjs');

const failed = { status: 'error', error: 'The automatic device check failed.' };
const gpu = { status: 'ok', data: { selected_device: { device: 'gpu', backend: 'dml', adapter: { name: 'Radeon' } } } };
const cpu = { status: 'ok', data: { selected_device: { device: 'cpu' } } };

test('Auto reuses the installed parser after independently confirming the CPU and checks for the GPU again later', async () => {
  const modes = [];
  const fallback = await onnxRuntime('auto', mode => {
    modes.push(mode);
    return mode === 'auto' ? failed : cpu;
  });
  assert.deepEqual(modes, ['auto', 'pipeline']);
  assert.equal(fallback.checked, true);
  assert.equal(fallback.cpuFallback, true);
  assert.equal(fallback.directml, false);
  assert.match(fallback.description, /verified CPU/);
  const plan = setupPlan({ hardware: {}, ollama: { running: true, models: [] },
    mineru: { compatible: true, kitExecutable: 'mineru-kit.exe', runtime: fallback } });
  assert.equal(plan.mineru, false);
  const restored = await onnxRuntime('auto', mode => { assert.equal(mode, 'auto'); return gpu; });
  assert.equal(restored.directml, true);
  assert.equal(restored.cpuFallback, undefined);
  assert.deepEqual(restored.devices, ['Radeon']);
});

test('Auto requires a confirmed CPU, and a manual or cancelled check never retries', async () => {
  for (const second of [undefined, failed, { status: 'ok' }, gpu]) {
    const modes = [];
    const result = await onnxRuntime('auto', mode => { modes.push(mode); return mode === 'auto' ? failed : second; });
    assert.deepEqual(modes, ['auto', 'pipeline']);
    assert.equal(result.checked, false);
  }
  for (const [backend, first, signal] of [['auto', undefined], ['pipeline', failed], ['auto', failed, AbortSignal.abort()]]) {
    const modes = [];
    const result = await onnxRuntime(backend, mode => { modes.push(mode); return first; }, signal);
    assert.deepEqual(modes, [backend]);
    assert.equal(result.checked, false);
  }
});

