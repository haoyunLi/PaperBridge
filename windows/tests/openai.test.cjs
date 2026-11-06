const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOpenAICredentialStore, createOpenAIClient, responseText } = require('../electron/openai.cjs');

function encryptedStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from([...value].reverse().join('')),
    decryptString: value => [...value.toString()].reverse().join('')
  };
}

test('OpenAI key is encrypted outside settings and can be removed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-openai-key-'));
  const file = path.join(root, 'openai-key.bin');
  const store = createOpenAICredentialStore({ file, safeStorage: encryptedStorage() });
  assert.equal(store.status(), false);
  store.save('sk-test-secret');
  assert.equal(store.status(), true);
  assert.equal(store.read(), 'sk-test-secret');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /sk-test-secret$/);
  assert.equal(store.remove(), false);
  assert.equal(store.status(), false);
  assert.throws(() => store.save('bad key'), /without spaces/);
});

test('OpenAI model discovery is explicit and never sends paper text', async () => {
  const calls = [];
  const client = createOpenAIClient({ fetchImpl: async (url, options) => {
    calls.push({ url: url.href, options });
    return { ok: true, status: 200, url: url.href, json: async () => ({ data: [{ id: 'gpt-z' }, { id: 'gpt-a' }, { id: 'gpt-a' }] }) };
  } });
  assert.deepEqual(await client.listModels('sk-test'), ['gpt-a', 'gpt-z']);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
});

test('OpenAI Responses requests disable storage and decode completed assistant output only', async () => {
  let request;
  const client = createOpenAIClient({ fetchImpl: async (url, options) => {
    request = { url: url.href, options };
    return { ok: true, status: 200, url: url.href, json: async () => ({ status: 'completed', output: [
      { type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] },
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: ' translated ' }] }
    ] }) };
  } });
  assert.equal(await client.generate({ apiKey: 'sk-test', model: 'gpt-test', prompt: 'paper text', system: 'translate', signal: null }), 'translated');
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'gpt-test', input: 'paper text', instructions: 'translate', store: false, stream: false, max_output_tokens: 8192 });
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test');
  assert.equal(request.options.redirect, 'manual');
});

test('OpenAI errors are sanitized and redirects or incomplete output are rejected', async () => {
  const redirected = createOpenAIClient({ fetchImpl: async () => ({ ok: false, status: 302, url: 'https://evil.test/', json: async () => ({}) }) });
  await assert.rejects(() => redirected.listModels('sk-secret'), /redirect.*blocked/i);
  const unauthorized = createOpenAIClient({ fetchImpl: async () => ({ ok: false, status: 401, url: 'https://api.openai.com/v1/models', json: async () => ({ error: { message: 'leak sk-secret' } }) }) });
  await assert.rejects(() => unauthorized.listModels('sk-secret'), error => !error.message.includes('sk-secret') && /authenticate/.test(error.message));
  assert.throws(() => responseText({ status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } }), /did not finish/);
  assert.throws(() => responseText({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal' }] }] }), /declined/);
});
