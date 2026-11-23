const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ollamaLaunch, ollamaPath, localOllamaURL } = require('../electron/ollama-installation.cjs');
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

test('custom loopback endpoints append the API below the configured prefix and preserve TLS', async () => {
  for (const base of ['https://papers.localhost/reader', 'https://papers.localhost/reader/']) {
    assert.equal(localOllamaURL(base, 'api/tags').href, 'https://papers.localhost/reader/api/tags');
  }
  assert.equal(localOllamaURL('http://[::1]:18181/mounted', 'api/ps').href, 'http://[::1]:18181/mounted/api/ps');
  for (const base of ['https://localhost.example.com', 'https://user@localhost', 'https://localhost/?private=true', 'file://localhost/x']) {
    assert.throws(() => localOllamaURL(base, 'api/generate'), /local Ollama/);
  }
  assert.throws(() => localOllamaURL('http://localhost:11434', '//example.com'), /API path/);
  const manager = new SetupManager({ toolsRoot: '', emit: () => assert.fail('A custom proxy must not trigger installation'),
    ollamaRequest: async () => { throw new Error('Proxy is offline'); } });
  await assert.rejects(manager.startOrInstallOllama('https://papers.localhost/reader'), /Start the local proxy/);
});

test('the setup wizard distinguishes a real empty model list from an unrelated local service', async () => {
  const { readOllamaModelList } = await import('../electron/ollama-models.mjs');
  assert.deepEqual(await readOllamaModelList(Response.json({ models: [{ name: 'z:7b' }, { model: 'a:4b' },
    { model: 'z:7b' }, { name: '' }, {}] })), ['a:4b', 'z:7b']);
  for (const response of [new Response('<html>Proxy home</html>'), Response.json({ status: 'ok' })]) {
    const manager = new SetupManager({ toolsRoot: '', emit: () => assert.fail('No install should start on an occupied endpoint'),
      ollamaRequest: async () => response });
    await assert.rejects(manager.startOrInstallOllama('http://127.0.0.1:11434'), /did not return an Ollama model list/);
  }
});

test('if a local service became ready during setup, no installer or second server is needed', async () => {
  let checked = 0;
  const manager = new SetupManager({ toolsRoot: '', emit: () => assert.fail('Unexpected setup operation'),
    ollamaRequest: async () => { checked++; return Response.json({ models: [] }); } });
  await manager.startOrInstallOllama('http://127.0.0.1:11434');
  assert.equal(checked, 1);
});
