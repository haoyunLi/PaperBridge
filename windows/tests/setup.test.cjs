const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SetupManager, cudaPlan, setupPlan } = require('../electron/setup.cjs');

test('one-click setup never assigns CUDA to AMD and keeps ready components', () => {
  const hardware = { adapters: [{ name: 'AMD Radeon RX', vendor: 'AMD' }], cudaDriver: null, cudaVersion: null };
  const status = {
    hardware,
    ollama: { running: true, models: ['translategemma:4b'] },
    mineru: { compatible: false, runtime: null }
  };
  assert.equal(cudaPlan(hardware).index, null);
  assert.deepEqual(setupPlan(status, ['translategemma:4b', 'translategemma:4b']), {
    ollama: false, models: [], mineru: true, gpu: cudaPlan(hardware)
  });
});

test('NVIDIA setup chooses supported wheel index and repairs CPU-only MinerU', () => {
  const hardware = { adapters: [{ name: 'NVIDIA RTX', vendor: 'NVIDIA' }], cudaDriver: [{ name: 'NVIDIA RTX' }], cudaVersion: '12.8' };
  const status = {
    hardware,
    ollama: { running: false, models: [] },
    mineru: { compatible: true, runtime: { cuda: false } }
  };
  const plan = setupPlan(status, ['translategemma:4b', 'gemma3:4b', 'translategemma:4b']);
  assert.equal(plan.gpu.index, 'cu128');
  assert.equal(plan.ollama, true);
  assert.deepEqual(plan.models, ['translategemma:4b', 'gemma3:4b']);
  assert.equal(plan.mineru, true);
  assert.equal(cudaPlan({ ...hardware, cudaVersion: '12.6' }).index, 'cu126');
  assert.equal(cudaPlan({ ...hardware, cudaVersion: '12.4' }).index, null);
});

test('managed bootstrap refuses a downloaded uv archive with the wrong checksum', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-uv-test-'));
  const previousFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('not a verified archive'), { status: 200 });
  const manager = new SetupManager({ toolsRoot: root, ollamaRequest: () => {}, pullModel: () => {}, emit: () => {} });
  manager.controller = new AbortController();
  try {
    await assert.rejects(manager.installUV(), /SHA-256/);
    assert.equal(fs.existsSync(path.join(root, 'uv', '0.11.29', 'uv.exe')), false);
  } finally {
    global.fetch = previousFetch;
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one-click setup installs only missing parts and selects backend after CUDA verification', async () => {
  const calls = [];
  const manager = new SetupManager({
    toolsRoot: os.tmpdir(),
    ollamaRequest: () => {},
    pullModel: async (_baseURL, model) => { calls.push(`model:${model}`); },
    emit: () => {}
  });
  manager.status = async () => ({
    plan: { ollama: true, models: ['translategemma:4b'], mineru: true, gpu: { index: 'cu128' } },
    mineru: { executable: '', runtime: null }
  });
  manager.startOrInstallOllama = async () => { calls.push('ollama'); };
  manager.installMineru = async () => { calls.push('mineru'); return { executable: 'managed-mineru.exe', runtime: { cuda: false }, warning: 'CUDA was unavailable.' }; };
  const result = await manager.install({ baseURL: 'http://localhost:11434', models: ['translategemma:4b'] });
  assert.deepEqual(calls, ['ollama', 'model:translategemma:4b', 'mineru']);
  assert.equal(result.mineruBackend, 'pipeline');
  assert.equal(result.mineruExecutable, 'managed-mineru.exe');
});

test('failed MinerU activation restores the previous managed environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-mineru-test-'));
  const previous = path.join(root, 'mineru', 'Scripts', 'mineru.exe');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'previous');
  const manager = new SetupManager({ toolsRoot: root, ollamaRequest: () => {}, pullModel: () => {}, emit: () => {} });
  manager.controller = new AbortController();
  manager.installUV = async () => 'uv.exe';
  manager.run = async (command, args) => {
    if (args[0] === 'venv') {
      const staged = path.join(root, 'mineru.installing', 'Scripts', 'mineru.exe');
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, 'new');
    }
    if (command === previous) throw new Error('verification failed');
    return '';
  };
  try {
    await assert.rejects(manager.installMineru({ index: null }), /verification failed/);
    assert.equal(fs.readFileSync(previous, 'utf8'), 'previous');
    assert.equal(fs.existsSync(path.join(root, 'mineru.backup')), false);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
