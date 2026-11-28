const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SetupManager, cudaPlan, setupPlan, managedPythonPath } = require('../electron/setup.cjs');

test('concurrent readers share one parser check per executable and backend, then can refresh or retry', async () => {
  const requests = [];
  const manager = new SetupManager({ toolsRoot: 'managed-tools', checkMineru: (executable, root, backend) =>
    new Promise((resolve, reject) => requests.push({ executable, root, backend, resolve, reject })) });
  const first = manager.parserStatus('first.exe', 'auto');
  const same = manager.parserStatus('first.exe', 'auto');
  const cpu = manager.parserStatus('first.exe', 'pipeline');
  const other = manager.parserStatus('other.exe', 'auto');
  assert.deepEqual(requests.map(({ executable, root, backend }) => [executable, root, backend]), [
    ['first.exe', 'managed-tools', 'auto'], ['first.exe', 'managed-tools', 'pipeline'], ['other.exe', 'managed-tools', 'auto']
  ]);
  requests[0].resolve('GPU');
  requests[1].resolve('CPU');
  requests[2].reject(new Error('Parser unavailable'));
  await assert.rejects(other, /Parser unavailable/);
  assert.deepEqual(await Promise.all([first, same, cpu]), ['GPU', 'GPU', 'CPU']);
  const refresh = manager.parserStatus('first.exe', 'auto');
  const retry = manager.parserStatus('other.exe', 'auto');
  assert.equal(requests.length, 5);
  requests[3].resolve('Changed device');
  requests[4].resolve('Repaired parser');
  assert.deepEqual(await Promise.all([refresh, retry]), ['Changed device', 'Repaired parser']);
});

test('completing a parser installation detaches any older device checks', async () => {
  const requests = [];
  const manager = new SetupManager({ toolsRoot: 'managed-tools', emit() {},
    checkMineru: () => new Promise(resolve => requests.push(resolve)) });
  manager.status = async () => ({ mineru: {}, plan: { gpu: {}, mineru: true } });
  manager.installMineru = async () => ({ executable: 'managed-mineru.exe', runtime: { checked: true }, onnx: true });
  const before = manager.parserStatus();
  await manager.install({ components: { mineru: true } });
  const after = manager.parserStatus();
  assert.equal(requests.length, 2);
  requests[0]('old installation');
  assert.equal(await before, 'old installation');
  const concurrent = manager.parserStatus();
  assert.equal(requests.length, 2);
  requests[1]('new installation');
  assert.deepEqual(await Promise.all([after, concurrent]), ['new installation', 'new installation']);
});

test('setup and task checks share Ollama default tags without conflating other versions', async () => {
  const { aiTaskSetupIssue } = await import('../src/aiSettings.mjs');
  const { modelSettingsPatch, TRANSLATION_MODELS } = await import('../src/modelCatalog.mjs');
  const installed = ['team/reader:latest', 'translategemma:4b'];
  const status = { hardware: {}, mineru: { compatible: true }, ollama: { running: true, models: installed } };
  assert.deepEqual(setupPlan(status, ['team/reader', 'team/reader:latest', 'team/reader:large', 'other', 'other:latest']).models, ['team/reader:large', 'other']);
  const settings = { translationModel: 'team/reader', summaryModel: 'translategemma:4b' };
  assert.equal(aiTaskSetupIssue(settings, ['translation', 'summary'], { models: installed, ollamaStatus: 'ready' }), null);
  assert.deepEqual(modelSettingsPatch({ translationModel: 'old', summaryModel: 'team/reader' }, TRANSLATION_MODELS[0], installed), {
    translationModel: 'translategemma:4b', explainModel: 'translategemma:4b', quickLookupModel: 'translategemma:4b'
  });
});

test('match dedicated memory to each GPU without displaying the truncated WMI value as VRAM', async () => {
  const { nvidiaDevices, mergeAdapterInventory } = require('../electron/hardware.cjs');
  const { describeAdapter } = await import('../src/hardwareDisplay.mjs');
  const devices = nvidiaDevices(['NVIDIA T4, 578.12, 15360', 'NVIDIA T4, 578.12, 8192',
    'NVIDIA A10, 578.12, [N/A]', 'No devices were found', ''].join('\n'));
  const mixed = mergeAdapterInventory([
    { Name: 'AMD Radeon RX 7800 XT', VendorID: '1002', DedicatedBytes: 17163091968, AdapterRAM: 4293918720 },
    { Name: 'AMD Radeon(TM) Graphics', DedicatedBytes: 512 * 1024 ** 2 },
    { Name: 'T4', VendorID: '10DE' }, { Name: 'T4', VendorID: '10DE' },
    { Name: 'Basic Display Adapter', VendorID: '8086', AdapterRAM: 4293918720 }
  ], devices);
  assert.deepEqual(mixed.map(describeAdapter), [
    'AMD Radeon RX 7800 XT (AMD, 16 GiB dedicated)', 'AMD Radeon(TM) Graphics (AMD, 512 MiB dedicated)',
    'T4 (NVIDIA, 15 GiB dedicated)', 'T4 (NVIDIA, 8 GiB dedicated)', 'Basic Display Adapter (Intel)', 'NVIDIA A10 (NVIDIA)'
  ]);
  assert.equal(mixed[0].memoryBytes, 17163091968);
  assert.equal(mixed[4].dedicatedMemoryBytes, null);
  assert.equal(mixed[4].memoryBytes, 4293918720);
  assert.deepEqual(mergeAdapterInventory([], devices).map(adapter => adapter.name), ['NVIDIA T4', 'NVIDIA T4', 'NVIDIA A10']);
  assert.deepEqual(nvidiaDevices('No devices were found'), []);
});

test('device errors remain visible and only usable adapters contribute to the model suggestion', async () => {
  const { mergeAdapterInventory } = require('../electron/hardware.cjs');
  const { describeAdapter } = await import('../src/hardwareDisplay.mjs');
  const { largestDedicatedAdapter, suggestedTranslationModel } = await import('../src/modelCatalog.mjs');
  const gib = 1024 ** 3;
  const controllers = [
    { Name: 'NVIDIA T4', ConfigManagerErrorCode: 22, DedicatedBytes: 16 * gib },
    { Name: 'AMD Radeon PRO', ConfigManagerErrorCode: 43, DedicatedBytes: 32 * gib },
    { Name: 'AMD Radeon Graphics', ConfigManagerErrorCode: 0, DedicatedBytes: gib / 2 }
  ];
  const adapters = mergeAdapterInventory(controllers, []);
  assert.match(describeAdapter(adapters[0]), /disabled · Windows Code 22/);
  assert.match(describeAdapter(adapters[1]), /unavailable · Windows Code 43/);
  const hardware = { adapters, systemMemoryBytes: 64 * gib };
  assert.equal(largestDedicatedAdapter(hardware).name, 'AMD Radeon Graphics');
  assert.equal(suggestedTranslationModel(hardware).id, 'translategemma:4b');
  const driver = [{ name: 'NVIDIA T4', driver: 'fixture', memoryMiB: 15360 }];
  const recovered = mergeAdapterInventory(controllers, driver);
  assert.equal(recovered[0].problemCode, undefined);
  const twins = mergeAdapterInventory([...controllers, { Name: 'T4', VendorID: '10DE' }], driver);
  assert.equal(twins[0].problemCode, 22);
  assert.equal(twins.at(-1).dedicatedMemoryBytes, 15 * gib);
});

test('old and new nvidia-smi report labels choose the matching CUDA wheel', () => {
  const { nvidiaSupportedCuda } = require('../electron/hardware.cjs');
  const hardware = { cudaDriver: [{ name: 'NVIDIA GPU' }] };
  for (const [report, version, wheel] of [
    ['Driver Version  : 560.94\nCUDA Version         : 12.6', '12.6', 'cu126'],
    ['KMD Version : 610.10\nCUDA UMD Version     : 13.4', '13.4', 'cu128'],
    ['Driver Version : 550.10 | CUDA Version: 12.4 |', '12.4', null],
    ['CUDA UMD Version : N/A\nCUDA Toolkit Version : 13.4', null, null]
  ]) {
    const cudaVersion = nvidiaSupportedCuda(report);
    assert.equal(cudaVersion, version);
    assert.equal(cudaPlan({ ...hardware, cudaVersion }).index, wheel);
  }
});

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
  const fallback = { ...status, mineru: { compatible: true, runtime: { checked: true, cuda: false } } };
  assert.equal(setupPlan(fallback, [], { mineruBackend: 'pipeline' }).mineru, false, 'a verified CPU fallback survives the next setup');
  assert.equal(setupPlan(fallback, [], { mineruBackend: 'pipeline', repairMineru: true }).mineru, true);
  assert.equal(setupPlan(fallback, [], { mineruBackend: 'auto' }).mineru, true);
  const amd = { ...status, hardware: { adapters: [{ vendor: 'AMD' }] } };
  const legacy = runtime => ({ ...amd, mineru: { compatible: true, runtime } });
  assert.equal(setupPlan(legacy({ checked: false, unusable: true })).mineru, true, 'a broken local PyTorch environment needs repair');
  assert.equal(setupPlan(legacy({ checked: false })).mineru, false, 'an external wrapper can run without an identifiable Python');
  const onnx = { ...status, mineru: { compatible: true, kitExecutable: 'mineru-kit.exe', runtime: { directml: true } } };
  const onnxPlan = setupPlan(onnx);
  assert.equal(onnxPlan.mineru, false, 'A working ONNX parser does not require a CUDA reinstall');
  assert.match(onnxPlan.gpu.reason, /keeps the installed MinerU ONNX parser/);
  assert.match(onnxPlan.gpu.reason, /checks for DirectML/);
  assert.match(setupPlan(onnx, [], { mineruBackend: 'pipeline' }).gpu.reason, /CPU selected in parser settings/);
  if (process.arch === 'x64') {
    const olderDriver = { ...hardware, cudaVersion: '12.4' };
    assert.match(cudaPlan(olderDriver).reason, /12\.4.*12\.6 or newer.*DirectML/);
    assert.match(cudaPlan(olderDriver, 'pipeline').reason, /CPU selected in parser settings/);
  }
  assert.equal(setupPlan({ ...onnx, mineru: { ...onnx.mineru, runtime: { checked: false } } }).mineru, true);
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
  assert.equal(result.mineruInstalled, true);
});

test('a setup that reuses the current parser does not activate PDF extraction', async () => {
  const manager = new SetupManager({ toolsRoot: os.tmpdir(), emit: () => {} });
  manager.status = async () => ({
    plan: { ollama: false, models: [], mineru: false }, mineru: { executable: 'existing.exe', kitExecutable: true }
  });
  const result = await manager.install({ components: { mineru: true }, mineruBackend: 'pipeline' });
  assert.equal(result.mineruBackend, undefined);
  assert.equal(result.mineruExecutable, 'existing.exe');
  assert.equal(result.mineruInstalled, false);
});

test('ONNX repair checks the selected backend and retains the explicit compatibility setting', async () => {
  const manager = new SetupManager({ toolsRoot: os.tmpdir(), emit: () => {} });
  manager.status = async () => ({ plan: { mineru: true, gpu: { index: 'cu128' } },
    mineru: { executable: 'existing.exe', kitExecutable: 'mineru-kit.exe' } });
  manager.installMineru = async (_gpu, useOnnx, backend) => {
    assert.equal(useOnnx, true);
    assert.equal(backend, 'pipeline');
    return { executable: 'repaired.exe', onnx: true, runtime: { checked: true, directml: false } };
  };
  const result = await manager.install({ components: { mineru: true }, repairMineru: true, mineruBackend: 'pipeline' });
  assert.equal(result.mineruBackend, 'pipeline');
  assert.equal(result.mineruInstalled, true);
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

function managedInstallFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-mineru-test-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const previous = path.join(root, 'mineru', 'Scripts', 'mineru.exe');
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const python = path.join(root, 'python', `cpython-3.12.13-windows-${architecture}-none`, 'python.exe');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'previous');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'python');
  const events = [];
  const manager = new SetupManager({ toolsRoot: root, ollamaRequest: () => {}, pullModel: () => {}, emit: event => events.push(event) });
  manager.installUV = async () => 'uv.exe';
  manager.run = async (_command, args) => {
    if (args[0] === 'venv') {
      const staged = path.join(root, 'mineru.installing', 'Scripts', 'mineru.exe');
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, 'new');
      fs.writeFileSync(path.join(path.dirname(staged), 'mineru-kit.exe'), 'kit');
    }
    return '';
  };
  return { root, previous, backup: path.join(root, 'mineru.rollback', 'Scripts', 'mineru.exe'), manager, events };
}

test('failed MinerU activation restores the previous managed environment', async t => {
  const { manager, previous, backup } = managedInstallFixture(t);
  manager.controller = new AbortController();
  const run = manager.run;
  manager.run = async (command, args) => {
    if (command === previous) throw new Error('verification failed');
    return run(command, args);
  };
  await assert.rejects(manager.installMineru({ index: null }, true), /verification failed/);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'previous');
  assert.equal(fs.existsSync(backup), false);
});

test('failed or cancelled MinerU runtime verification rolls back after command activation', async t => {
  for (const mode of ['failure', 'cancellation']) await t.test(mode, async child => {
    const { manager, previous, backup } = managedInstallFixture(child);
    manager.controller = new AbortController();
    manager.checkMineruRuntime = async () => {
      assert.equal(fs.readFileSync(previous, 'utf8'), 'new');
      assert.equal(fs.readFileSync(backup, 'utf8'), 'previous');
      if (mode === 'cancellation') manager.cancel();
      return mode === 'failure' ? { checked: false, reason: 'ONNX verification failed' } : { checked: true, directml: true };
    };
    await assert.rejects(manager.installMineru({ index: null }, true), mode === 'failure' ? /ONNX verification failed/ : { name: 'AbortError' });
    assert.equal(fs.readFileSync(previous, 'utf8'), 'previous');
    assert.equal(fs.existsSync(backup), false);
  });
});

test('MinerU activation retries a transient Windows staging rename error', async t => {
  const { manager, root, previous, backup } = managedInstallFixture(t);
  manager.controller = new AbortController();
  manager.checkMineruRuntime = async () => ({ checked: true, directml: true });
  const rename = fs.renameSync;
  let refusals = 0;
  fs.renameSync = (source, destination) => {
    if (source === path.join(root, 'mineru.installing') && refusals++ < 2) {
      throw Object.assign(new Error('Windows temporarily refused the rename'), { code: 'EPERM' });
    }
    return rename(source, destination);
  };
  try { await manager.installMineru({ index: null }, true); }
  finally { fs.renameSync = rename; }
  assert.equal(refusals, 3);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'new');
  assert.equal(fs.existsSync(backup), false);
});

test('cancelling optional MinerU model preloading reports the activated parser as installed', async t => {
  const { manager, previous, backup, events } = managedInstallFixture(t);
  manager.status = async () => ({
    mineru: { executable: previous, kitExecutable: 'mineru-kit.exe' },
    plan: { ollama: false, models: [], mineru: true, gpu: { index: null } }
  });
  manager.checkMineruRuntime = async () => ({ checked: true, directml: true });
  const run = manager.run;
  manager.run = async (command, args) => {
    if (args[0] === 'models') {
      assert.equal(fs.readFileSync(previous, 'utf8'), 'new');
      assert.equal(fs.existsSync(backup), false);
      manager.cancel();
      throw new Error('model preloading stopped');
    }
    return run(command, args);
  };
  if (process.arch !== 'x64') return t.skip('Managed ONNX setup runs on x64');
  const result = await manager.install({ components: { mineru: true }, repairMineru: true });
  assert.equal(result.mineruExecutable, previous);
  assert.equal(result.mineruBackend, 'auto');
  assert.match(result.warning, /MinerU is installed.*preloading was cancelled/);
  assert.equal(events.at(-1).phase, 'done');
});
