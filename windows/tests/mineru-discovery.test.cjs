const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidates, createMineruStaging, detectMineruExecutable, mineruInvocation, mineruPython } = require('../electron/mineru-discovery.cjs');
const { mineruPaths, claimMineruSetup, beginMineruActivation, commitMineruActivation } = require('../electron/mineru-installation.cjs');

test('legacy probes use the interpreter belonging to the launcher installation', async t => {
  const { root } = fixture(t);
  const scripts = path.join(root, 'Python with spaces', 'Scripts');
  const executable = path.join(scripts, 'mineru.exe');
  const prefix = path.dirname(scripts);
  const globalPython = path.join(prefix, 'python.exe'), venvPython = path.join(scripts, 'python.exe');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(globalPython, '');
  assert.equal(await mineruPython(executable), '', 'A parent Python without the MinerU package is ambiguous');
  const pkg = path.join(prefix, 'Lib', 'site-packages', 'mineru');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, '__init__.py'), '');
  assert.equal(await mineruPython(executable), globalPython);
  assert.equal(await mineruPython(path.join(prefix, 'other', 'mineru.exe')), '');
  fs.writeFileSync(venvPython, '');
  assert.equal(await mineruPython(executable), venvPython);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-mineru-detect-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const toolsRoot = path.join(root, 'tools');
  const managed = path.join(toolsRoot, 'mineru', 'Scripts', 'mineru.exe');
  const pathDir = path.join(root, 'path-tools');
  const onPath = path.join(pathDir, 'mineru.exe');
  for (const executable of [managed, onPath]) {
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'test placeholder');
  }
  return { root, toolsRoot, managed, onPath, environment: { PATH: pathDir } };
}

test('auto-detect prefers a compatible private managed MinerU and respects an explicit path', async t => {
  const paths = fixture(t);
  const options = { environment: paths.environment, probeVersion: async executable => executable === paths.managed ? 'MinerU 3.4.5' : 'MinerU 3.7.0' };
  assert.deepEqual(candidates('', paths.toolsRoot, paths.environment).map(item => item.source), ['managed', 'path']);
  const automatic = await detectMineruExecutable('', paths.toolsRoot, options);
  assert.equal(automatic.executable, paths.managed);
  assert.equal(automatic.source, 'managed');
  assert.equal(automatic.compatible, true);
  assert.equal((await detectMineruExecutable('mineru', paths.toolsRoot, options)).executable, paths.managed);
  const configured = await detectMineruExecutable(paths.onPath, paths.toolsRoot, options);
  assert.equal(configured.executable, paths.onPath);
  assert.equal(configured.source, 'configured');
});

test('standard Python script directories are discoverable even when pip did not add them to PATH', async t => {
  const { root, toolsRoot } = fixture(t);
  const local = path.join(root, 'Local with spaces');
  const roaming = path.join(root, 'Roaming');
  const pythonPrefix = path.join(local, 'Programs', 'Python', 'Python312');
  const userPrefix = path.join(roaming, 'Python', 'Python312');
  const python = path.join(pythonPrefix, 'python.exe');
  const userCommand = path.join(userPrefix, 'Scripts', 'mineru.exe');
  const module = path.join(userPrefix, 'site-packages', 'mineru', '__init__.py');
  for (const file of [python, userCommand, module]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  const environment = { LOCALAPPDATA: local, APPDATA: roaming, PATH: '' };
  const launcher = executable => Buffer.from('#!"' + executable + '"\r\nPK\x03\x04');
  fs.writeFileSync(userCommand, launcher(python));
  assert.equal(await mineruPython(userCommand, environment), python);
  assert.deepEqual(candidates('', toolsRoot, environment).filter(c => c.source === 'python').map(c => c.executable),
    [userCommand, path.join(pythonPrefix, 'Scripts', 'mineru.exe')]);
  const found = await detectMineruExecutable('', toolsRoot, { environment, probeVersion: async cmd =>
    cmd === userCommand ? 'MinerU 3.4.5' : 'Unavailable' });
  assert.equal(found.executable, userCommand);
  fs.writeFileSync(userCommand, launcher(path.join(root, 'other', 'python.exe')));
  assert.equal(await mineruPython(userCommand, environment), '');
  fs.writeFileSync(userCommand, launcher(python));
  assert.equal(await mineruPython(userCommand, { ...environment, PYTHONUSERBASE: path.join(root, 'different base') }), '');
  assert.deepEqual(candidates(userCommand, toolsRoot, environment), [{ executable: userCommand, source: 'configured' }]);
});

test('Python install manager directories, including free-threaded ones, resolve without starting a manager', async t => {
  const { root } = fixture(t);
  const local = path.join(root, 'Local');
  const user = path.join(root, 'User', 'Python313t');
  const managed = path.join(local, 'Python', 'pythoncore-3.13t-arm64');
  const classic = path.join(local, 'Programs', 'Python', 'Python313');
  const script = path.join(managed, 'Scripts', 'mineru.exe');
  const userScript = path.join(user, 'Scripts', 'mineru.exe');
  const python = path.join(managed, 'python.exe');
  for (const file of [script, userScript, python, path.join(user, 'site-packages', 'mineru', '__init__.py'),
    path.join(classic, 'python.exe'), path.join(local, 'Python', '_cache', 'Scripts', 'mineru.exe')]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  const env = { LOCALAPPDATA: local, PYTHONUSERBASE: path.dirname(user), PATH: '' };
  const unexpected = () => assert.fail('A working standard install should resolve without listing runtimes');
  fs.writeFileSync(userScript, '#!"' + python + '"\nPK\x03\x04');
  assert.equal(await mineruPython(userScript, env, unexpected), python);
  const found = await detectMineruExecutable('', '', { environment: { LOCALAPPDATA: local, PATH: '' },
    probeVersion: async () => 'MinerU 3.4.5', listInterpreters: unexpected });
  assert.equal(found.executable, script);
  fs.writeFileSync(userScript, '#!"' + path.join(classic, 'python.exe') + '"\nPK\x03\x04');
  assert.equal(await mineruPython(userScript, env, async () => []), '');
});

test('custom manager locations are queried after ordinary discovery and remain subordinate to an explicit path', async t => {
  const { root, onPath } = fixture(t);
  const prefix = path.join(root, '自定义 安装');
  const python = path.join(prefix, 'python.exe'), mineru = path.join(prefix, 'Scripts', 'mineru.exe');
  fs.mkdirSync(path.dirname(mineru), { recursive: true });
  fs.writeFileSync(python, '');
  fs.writeFileSync(mineru, '');
  let lists = 0;
  const opts = { environment: { PATH: path.dirname(onPath) },
    listInterpreters: async () => { lists++; return [python, python]; },
    probeVersion: async executable => executable === mineru ? 'MinerU 3.4.5' : 'unrecognized' };
  const found = await detectMineruExecutable('', '', opts);
  assert.equal(found.executable, mineru);
  assert.equal(found.source, 'python');
  assert.equal(lists, 1);
  const explicit = await detectMineruExecutable(onPath, '', opts);
  assert.equal(explicit.compatible, false);
  assert.equal(lists, 1);
  const env = { ...opts.environment, LOCALAPPDATA: root, PYTHONUSERBASE: path.join(root, 'pip') };
  const user = path.join(env.PYTHONUSERBASE, 'Python312');
  const userScript = path.join(user, 'Scripts', 'mineru.exe');
  fs.mkdirSync(path.dirname(userScript), { recursive: true });
  fs.mkdirSync(path.join(user, 'site-packages', 'mineru'), { recursive: true });
  fs.writeFileSync(path.join(user, 'site-packages', 'mineru', '__init__.py'), '');
  fs.writeFileSync(userScript, '#!"' + python + '"\r\nPK\x03\x04');
  assert.equal(await mineruPython(userScript, env, opts.listInterpreters), python);
  assert.equal(await mineruPython(userScript, env, async () => []), '');
});

test('auto-detect skips a broken managed command and chooses compatible PATH MinerU', async t => {
  const paths = fixture(t);
  const result = await detectMineruExecutable('', paths.toolsRoot, {
    environment: paths.environment,
    probeVersion: async executable => {
      if (executable === paths.managed) throw new Error('cannot start');
      return 'mineru version 3.4.5';
    }
  });
  assert.equal(result.executable, paths.onPath);
  assert.equal(result.source, 'path');
  assert.equal(result.compatible, true);
});

test('discovery checks actual runtimes and preserves an explicit parser choice', async t => {
  const { managed, onPath, toolsRoot, environment } = fixture(t);
  const options = { environment, probeVersion: async () => 'MinerU 3.4.5' };
  const broken = { checked: false, unusable: true, reason: 'Cannot load PyTorch' };
  const unknown = { checked: false, reason: 'Custom launcher' };
  const ready = { checked: true, cuda: false };
  for (const first of [broken, unknown, ready]) {
    const tried = [];
    options.probeRuntime = async found => {
      tried.push(found.executable);
      return found.executable === managed ? first : ready;
    };
    const result = await detectMineruExecutable('', toolsRoot, options);
    assert.equal(result.executable, first === ready ? managed : onPath);
    assert.deepEqual(tried, first === ready ? [managed] : [managed, onPath]);
    const explicit = await detectMineruExecutable(managed, toolsRoot, options);
    assert.equal(explicit.executable, managed);
    assert.deepEqual(explicit.runtime, first);
  }
  options.probeRuntime = async found => found.executable === managed ? broken : unknown;
  assert.equal((await detectMineruExecutable('', toolsRoot, options)).executable, onPath);
  options.probeRuntime = async () => broken;
  assert.deepEqual((await detectMineruExecutable('', toolsRoot, options)).runtime, broken);
});

test('detection leaves a live repair alone and restores the old parser after its owner exits', async t => {
  const fixturePaths = fixture(t);
  const { toolsRoot, managed, onPath, environment } = fixturePaths;
  const paths = mineruPaths(toolsRoot);
  const release = claimMineruSetup(paths.root);
  assert.ok(release);
  t.after(release);
  assert.equal(claimMineruSetup(paths.root), null);
  beginMineruActivation(paths);
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.writeFileSync(managed, 'replacement still under verification');
  const options = { environment, probeVersion: async executable => {
    if (executable === managed) assert.equal(fs.readFileSync(managed, 'utf8'), 'test placeholder');
    return 'MinerU 3.4.5';
  } };
  assert.match((await detectMineruExecutable(managed, toolsRoot, options)).reason, /setup is running/);
  assert.equal((await detectMineruExecutable('', toolsRoot, options)).executable, onPath);
  assert.ok(fs.existsSync(paths.rollback));
  release();
  assert.equal((await detectMineruExecutable('', toolsRoot, options)).executable, managed);
  assert.equal(fs.existsSync(paths.rollback), false);
});

test('detection ignores a committed rollback copy and restores the older backup layout if final is missing', async t => {
  const { toolsRoot, managed, environment } = fixture(t);
  const paths = mineruPaths(toolsRoot);
  const options = { environment, probeVersion: async () => 'MinerU 3.4.5' };
  beginMineruActivation(paths);
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.writeFileSync(managed, 'verified replacement');
  commitMineruActivation(paths);
  assert.equal((await detectMineruExecutable('', toolsRoot, options)).executable, managed);
  assert.equal(fs.readFileSync(managed, 'utf8'), 'verified replacement');
  assert.ok(fs.existsSync(paths.retired));
  fs.renameSync(paths.final, paths.legacyBackup);
  assert.equal((await detectMineruExecutable('', toolsRoot, options)).executable, managed);
  assert.equal(fs.existsSync(paths.legacyBackup), false);
});

test('detection discards an interrupted first activation without advertising it as installed', async t => {
  const { toolsRoot, managed } = fixture(t);
  const paths = mineruPaths(toolsRoot);
  fs.renameSync(paths.final, paths.staging);
  beginMineruActivation(paths);
  fs.renameSync(paths.staging, paths.final);
  const status = await detectMineruExecutable(managed, toolsRoot, { probeVersion: async () => assert.fail('Unverified parser was run') });
  assert.equal(status.compatible, false);
  assert.equal(fs.existsSync(paths.final), false);
  assert.equal(fs.existsSync(paths.rollback), false);
});

test('incompatible or absent tools produce explicit, non-installing diagnostics', async t => {
  const paths = fixture(t);
  const options = { environment: paths.environment, probeVersion: async () => 'MinerU 2.9' };
  const incompatible = await detectMineruExecutable('', paths.toolsRoot, options);
  assert.equal(incompatible.installed, true);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.executable, paths.managed);
  assert.match(incompatible.reason, /compatible 3\.x/);
  const explicitMissing = await detectMineruExecutable(path.join(paths.root, 'missing.exe'), paths.toolsRoot, options);
  assert.equal(explicitMissing.installed, false);
  assert.equal(explicitMissing.executable, '');
  assert.match(explicitMissing.reason, /Configured MinerU executable was not found/);
  fs.rmSync(paths.managed);
  fs.rmSync(paths.onPath);
  const absent = await detectMineruExecutable('', paths.toolsRoot, options);
  assert.equal(absent.installed, false);
  assert.match(absent.reason, /standard per-user Python directories/);
  assert.match((await detectMineruExecutable('mineru', paths.toolsRoot, options)).reason, /managed tools, on PATH/);
});

test('MinerU 4.1 needs its local kit and sends all PDF pages through ONNX with an explicit CPU option', async t => {
  const paths = fixture(t);
  const options = { environment: paths.environment, probeVersion: async executable => executable === paths.managed ? 'MinerU 4.1.7' : 'MinerU 3.4.5' };
  assert.match((await detectMineruExecutable(paths.managed, paths.toolsRoot, options)).reason, /missing mineru-kit.exe/);
  assert.equal((await detectMineruExecutable('', paths.toolsRoot, options)).executable, paths.onPath);
  const kit = path.join(path.dirname(paths.managed), 'mineru-kit.exe');
  fs.writeFileSync(kit, 'test kit placeholder');
  const modern = await detectMineruExecutable('', paths.toolsRoot, options);
  assert.equal(modern.executable, paths.managed);
  const pdf = path.join(paths.root, 'paper.pdf');
  const output = path.join(paths.root, 'output');
  const automatic = mineruInvocation(modern, pdf, output, 'auto', paths.toolsRoot);
  assert.equal(automatic.command, kit);
  assert.deepEqual(automatic.args, ['parse', path.toNamespacedPath(pdf), '-o', path.join(output, 'paper.zip'), '--format', 'zip', '--pages', 'all', '--tier', 'basic', '--ocr-mode', 'auto']);
  assert.equal(automatic.env.MINERU_MODEL_ONNX_DEVICE, 'auto');
  assert.equal(automatic.env.MINERU_TELEMETRY_DISABLED, '1');
  assert.equal(automatic.env.MINERU_HOME, path.toNamespacedPath(path.join(paths.toolsRoot, 'mineru4-data')));
  assert.equal(automatic.env.MINERU_CONFIG, undefined);
  assert.equal(mineruInvocation(modern, pdf, output, 'pipeline', paths.toolsRoot).env.MINERU_MODEL_ONNX_DEVICE, 'cpu');
  const legacy = await detectMineruExecutable(paths.onPath, paths.toolsRoot, options);
  const pipeline = mineruInvocation(legacy, pdf, output, 'pipeline', paths.toolsRoot);
  assert.deepEqual(pipeline.args, ['-p', pdf, '-o', output, '-b', 'pipeline']);
  assert.equal(pipeline.env, process.env, 'A functioning legacy pipeline keeps its device selection');
  const fallback = mineruInvocation(legacy, pdf, output, 'auto', paths.toolsRoot, true);
  assert.deepEqual(fallback.args, pipeline.args);
  assert.equal(fallback.env.MINERU_DEVICE_MODE, 'cpu', 'An unusable CUDA runtime must not choose CUDA again during parsing');
  assert.notEqual(fallback.env, process.env);
  assert.equal(mineruInvocation(modern, pdf, output, 'auto', paths.toolsRoot, true).env.MINERU_MODEL_ONNX_DEVICE, 'cpu',
    'A verified ONNX CPU fallback must persist from the device check to the actual parser process');
});

test('MinerU 4 stages chart images in ordinary paths, including when TEMP is deeply nested', { skip: process.platform !== 'win32' }, t => {
  const { root } = fixture(t);
  const kit = { kitExecutable: 'mineru-kit.exe' };
  const local = path.join(root, 'local');
  const normal = createMineruStaging(kit, path.toNamespacedPath(root), local);
  assert.equal(normal.root, root);
  const deep = path.join(root, ...Array(12).fill('带空格的期刊工作区 document data'));
  fs.mkdirSync(deep, { recursive: true });
  const fallback = createMineruStaging(kit, deep, local);
  assert.equal(fallback.root, path.join(local, 'Temp'));
  for (const { root: parent, directory } of [normal, fallback]) {
    assert.equal(path.dirname(directory), parent);
    assert.ok(fs.statSync(directory).isDirectory());
    const args = mineruInvocation(kit, path.join(directory, 'paper.pdf'), path.join(directory, 'output'), 'auto', root).args;
    assert.equal(args[3], path.join(directory, 'output', 'paper.zip'));
  }
});

test('long Windows parser paths retain the configured cache and staged PDF', { skip: process.platform !== 'win32' }, t => {
  const { root } = fixture(t);
  const parent = path.join(root, ...Array(8).fill('带空格的期刊工作区 associated source files'));
  const pdf = path.join(parent, 'paper.pdf');
  const cache = path.join(parent, 'tools', 'mineru4-data');
  assert.ok(pdf.length > 260);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(pdf, 'staged source');
  fs.writeFileSync(path.join(cache, 'config.yaml'), 'existing configuration');
  const invocation = mineruInvocation({ kitExecutable: 'mineru-kit.exe' }, pdf, parent, 'auto', path.dirname(cache));
  assert.equal(invocation.env.MINERU_HOME, path.toNamespacedPath(cache));
  assert.equal(invocation.args[1], path.toNamespacedPath(pdf));
  assert.equal(invocation.args[3], path.join(parent, 'paper.zip'));
  assert.equal(fs.readFileSync(path.join(invocation.env.MINERU_HOME, 'config.yaml'), 'utf8'), 'existing configuration');
  assert.equal(fs.readFileSync(invocation.args[1], 'utf8'), 'staged source');
  fs.writeFileSync(invocation.args[3], 'parser output');
  assert.equal(fs.readFileSync(path.join(parent, 'paper.zip'), 'utf8'), 'parser output');
});
