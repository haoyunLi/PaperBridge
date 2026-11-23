const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ollamaLaunch, ollamaPath } = require('../electron/ollama-installation.cjs');
const { SetupManager } = require('../electron/setup.cjs');

test('Ollama discovery supports the desktop installer, standalone CLI and registered custom folder', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-ollama-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const standard = path.join(root, 'Programs', 'Ollama'), custom = path.join(root, '自定义 模型服务');
  fs.mkdirSync(standard, { recursive: true }); fs.mkdirSync(custom);
  const desktop = path.join(standard, 'ollama app.exe'), cli = path.join(custom, 'ollama.exe');
  fs.writeFileSync(cli, '');
  const env = { LOCALAPPDATA: root, PATH: '"' + custom + '"' };
  const unexpected = () => assert.fail('Direct discovery does not need the registry');
  assert.equal(await ollamaPath(env, unexpected), cli);
  fs.writeFileSync(desktop, '');
  assert.equal(await ollamaPath(env, unexpected), desktop);
  fs.unlinkSync(desktop);
  assert.equal(await ollamaPath({ ...env, PATH: 'relative' }, async () => custom), cli);
  assert.equal(await ollamaPath({ ...env, PATH: '' }, async () => ''), '');
  assert.deepEqual(ollamaLaunch(cli, 'http://[::1]:11672'), { executable: cli, args: ['serve'], host: 'http://[::1]:11672' });
  assert.throws(() => ollamaLaunch(cli, 'http://192.0.2.1:11672'), /local Ollama/);
  assert.deepEqual(ollamaLaunch(desktop, 'http://127.0.0.1:11434'), { executable: desktop, args: [], host: null });
  const companion = path.join(standard, 'ollama.exe');
  fs.writeFileSync(companion, '');
  assert.deepEqual(ollamaLaunch(desktop, 'http://localhost:11518'), { executable: companion, args: ['serve'], host: 'http://localhost:11518' });
});

test('if a local service became ready during setup, no installer or second server is needed', async () => {
  let checked = 0;
  const manager = new SetupManager({ toolsRoot: '', emit: () => assert.fail('Unexpected setup operation'),
    ollamaRequest: async () => { checked++; return {}; } });
  await manager.startOrInstallOllama('http://127.0.0.1:11434');
  assert.equal(checked, 1);
});
