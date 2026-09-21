const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidates, detectMineruExecutable } = require('../electron/mineru-discovery.cjs');

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
