const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SetupManager, cudaPlan, setupPlan, managedPythonPath } = require('../electron/setup.cjs');

test('managed Python lookup uses a real versioned interpreter and ignores the minor-version link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-python-test-'));
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const installed = path.join(root, 'python', `cpython-3.12.13-windows-${architecture}-none`, 'python.exe');
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, 'python');
  try { assert.equal(managedPythonPath(root), installed); }
  finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one-click setup never assigns CUDA to AMD and keeps ready components', () => {
  const hardware = { adapters: [{ name: 'AMD Radeon RX', vendor: 'AMD' }], cudaDriver: null, cudaVersion: null };
  const status = {
    hardware,
    ollama: { running: true, models: ['translategemma:4b'] },
    mineru: { compatible: false, runtime: null }
  };
  assert.equal(cudaPlan(hardware).index, null);
  assert.deepEqual(setupPlan(status, ['translategemma:4b', 'translategemma:4b']), {
    ollama: false, models: [], mineru: true, gpu: cudaPlan(hardware),
    components: { ollama: true, models: true, mineru: true }, ollamaRequiredByModels: false
  });
});

test('component plans isolate MinerU and identify Ollama as a model dependency', () => {
  const status = {
    hardware: { adapters: [{ vendor: 'AMD' }], cudaDriver: null, cudaVersion: null },
    ollama: { running: false, models: [] },
    mineru: { compatible: false, runtime: null }
  };
  const mineruOnly = setupPlan(status, ['translategemma:4b'], { components: { ollama: false, models: false, mineru: true } });
  assert.equal(mineruOnly.ollama, false);
  assert.deepEqual(mineruOnly.models, []);
  assert.equal(mineruOnly.mineru, true);
  assert.equal(mineruOnly.ollamaRequiredByModels, false);
  const modelsOnly = setupPlan(status, ['translategemma:4b'], { components: { ollama: false, models: true, mineru: false } });
  assert.equal(modelsOnly.ollama, true);
  assert.equal(modelsOnly.ollamaRequiredByModels, true);
  assert.deepEqual(modelsOnly.models, ['translategemma:4b']);
  assert.equal(modelsOnly.mineru, false);
  assert.throws(() => setupPlan(status, [], { components: { mineru: 'yes' } }), /valid setup components/);
});

test('explicit MinerU repair is planned even when the pinned 3.x installation is compatible', () => {
  const status = {
    hardware: { adapters: [{ vendor: 'AMD' }], cudaDriver: null, cudaVersion: null },
    ollama: { running: true, models: ['translategemma:4b'] },
    mineru: { compatible: true, executable: 'managed-mineru.exe', runtime: { cuda: false } }
  };
  const selected = { ollama: false, models: false, mineru: true };
  assert.equal(setupPlan(status, [], { components: selected }).mineru, false);
  assert.equal(setupPlan(status, [], { components: selected, repairMineru: true }).mineru, true);
  assert.equal(setupPlan(status, [], { components: { ...selected, mineru: false }, repairMineru: true }).mineru, false);
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

test('MinerU-only repair skips Ollama and model installation and reuses managed activation path', async () => {
  const calls = [];
  const manager = new SetupManager({ toolsRoot: os.tmpdir(), ollamaRequest: () => {}, pullModel: async () => { calls.push('model'); }, emit: () => {} });
  manager.status = async config => ({
    plan: setupPlan({
      hardware: { adapters: [{ vendor: 'AMD' }], cudaDriver: null, cudaVersion: null },
      ollama: { running: false, models: [] },
      mineru: { compatible: true, executable: 'old-managed-mineru.exe', runtime: { cuda: false } }
    }, [], config),
    mineru: { executable: 'old-managed-mineru.exe', runtime: { cuda: false } }
  });
  manager.startOrInstallOllama = async () => { calls.push('ollama'); };
  manager.installMineru = async () => { calls.push('mineru'); return { executable: 'new-managed-mineru.exe', runtime: { cuda: false }, warning: '' }; };
  const result = await manager.install({ baseURL: 'http://localhost:11434', models: ['invalid model name'],
    components: { ollama: false, models: false, mineru: true }, repairMineru: true });
  assert.deepEqual(calls, ['mineru']);
  assert.equal(result.mineruExecutable, 'new-managed-mineru.exe');
  assert.equal(result.mineruBackend, 'pipeline');
});

test('models-only setup starts missing Ollama as a dependency and does not return MinerU overrides', async () => {
  const calls = [];
  const manager = new SetupManager({ toolsRoot: os.tmpdir(), ollamaRequest: () => {}, pullModel: async (_baseURL, model) => { calls.push(`model:${model}`); }, emit: () => {} });
  manager.status = async config => ({
    plan: setupPlan({
      hardware: { adapters: [], cudaDriver: null, cudaVersion: null },
      ollama: { running: false, models: [] },
      mineru: { compatible: false, runtime: null }
    }, config.models, config),
    mineru: { executable: 'configured-mineru.exe', runtime: { cuda: false } }
  });
  manager.startOrInstallOllama = async () => { calls.push('ollama'); };
  manager.installMineru = async () => { calls.push('mineru'); return { executable: 'unexpected.exe', runtime: null, warning: '' }; };
  const result = await manager.install({ baseURL: 'http://localhost:11434', models: ['translategemma:4b'],
    components: { ollama: false, models: true, mineru: false } });
  assert.deepEqual(calls, ['ollama', 'model:translategemma:4b']);
  assert.deepEqual(result, { warning: '' });
});

test('cancelling during status detection does not report setup as done', async () => {
  const events = [];
  let completeStatus;
  let beganStatus;
  const statusStarted = new Promise(resolve => { beganStatus = resolve; });
  const manager = new SetupManager({
    toolsRoot: os.tmpdir(), ollamaRequest: () => {}, pullModel: async () => {},
    emit: event => events.push(event)
  });
  manager.status = () => new Promise(resolve => { completeStatus = resolve; beganStatus(); });
  manager.startOrInstallOllama = async () => { throw new Error('Ollama must not start after cancellation'); };
  const installing = manager.install({ baseURL: 'http://localhost:11434', models: [],
    components: { ollama: true, models: false, mineru: false } });
  await statusStarted;
  assert.equal(manager.cancel(), true);
  completeStatus({
    plan: { ollama: false, models: [], mineru: false, gpu: { index: null } },
    mineru: { executable: '', runtime: null }
  });
  await assert.rejects(installing, { name: 'AbortError' });
  assert.deepEqual(events.map(event => event.phase), ['detect', 'cancelled']);
});

test('failed MinerU activation restores the previous managed environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-mineru-test-'));
  const previous = path.join(root, 'mineru', 'Scripts', 'mineru.exe');
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const python = path.join(root, 'python', `cpython-3.12.13-windows-${architecture}-none`, 'python.exe');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'previous');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'python');
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
