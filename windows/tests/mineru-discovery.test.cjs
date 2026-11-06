const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidates, detectMineruExecutable, mineruInvocation } = require('../electron/mineru-discovery.cjs');

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
  assert.match(absent.reason, /managed tools or on PATH/);
  assert.match((await detectMineruExecutable('mineru', paths.toolsRoot, options)).reason, /managed tools or on PATH/);
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
  assert.deepEqual(automatic.args, ['parse', pdf, '-o', path.join(output, 'paper.md'), '--pages', 'all', '--tier', 'basic', '--ocr-mode', 'auto']);
  assert.equal(automatic.env.MINERU_MODEL_ONNX_DEVICE, 'auto');
  assert.equal(automatic.env.MINERU_TELEMETRY_DISABLED, '1');
  assert.equal(automatic.env.MINERU_HOME, path.join(paths.toolsRoot, 'mineru4-data'));
  assert.equal(automatic.env.MINERU_CONFIG, undefined);
  assert.equal(mineruInvocation(modern, pdf, output, 'pipeline', paths.toolsRoot).env.MINERU_MODEL_ONNX_DEVICE, 'cpu');
  const legacy = await detectMineruExecutable(paths.onPath, paths.toolsRoot, options);
  assert.deepEqual(mineruInvocation(legacy, pdf, output, 'pipeline', paths.toolsRoot).args, ['-p', pdf, '-o', output, '-b', 'pipeline']);
});
