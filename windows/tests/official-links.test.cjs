const test = require('node:test');
const assert = require('node:assert/strict');
const { officialOllamaUrl, createOfficialLinkHandler } = require('../electron/official-links.cjs');

test('official links allow the Windows download and model tag pages only', () => {
  for (const url of ['https://ollama.com/download/windows', 'https://ollama.com/library/translategemma:4b',
    'https://ollama.com/library/qwen3:4b-instruct', 'https://ollama.com/library/phi4-mini:3.8b', 'https://ollama.com/library/gemma3']) {
    assert.equal(officialOllamaUrl(url), url);
  }
  for (const url of ['http://ollama.com/download/windows', 'https://other.example/library/qwen3', 'https://ollama.com.evil.example/library/qwen3',
    'https://user:pass@ollama.com/library/qwen3', 'https://ollama.com:443/library/qwen3', 'https://ollama.com:8443/library/qwen3',
    'https://ollama.com/download/mac', 'https://ollama.com/', 'https://ollama.com/library/', 'https://ollama.com/library/a/b',
    'https://ollama.com/library/qwen3?next=https://other.example', 'https://ollama.com/library/qwen3#section',
    'https://ollama.com/library/%2E%2E/download/windows', 'file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', null, {}]) {
    assert.equal(officialOllamaUrl(url), null, `should reject ${String(url)}`);
  }
});

test('new-window handler opens allowed links externally and always denies an app popup', async () => {
  const opened = [];
  const handler = createOfficialLinkHandler(async url => opened.push(url));
  assert.deepEqual(handler({ url: 'https://ollama.com/library/translategemma:4b' }), { action: 'deny' });
  assert.deepEqual(handler({ url: 'https://other.example/' }), { action: 'deny' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['https://ollama.com/library/translategemma:4b']);
});

test('browser launch failures are reported without an unhandled rejection', async () => {
  let reported;
  const handler = createOfficialLinkHandler(async () => { throw new Error('No browser configured'); }, error => { reported = error.message; });
  handler({ url: 'https://ollama.com/download/windows' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reported, 'No browser configured');
});
