const fs = require('node:fs');
const path = require('node:path');

const OPENAI_BASE_URL = 'https://api.openai.com/v1/';

function validatedAPIKey(value) {
  const key = String(value || '').trim();
  if (!key || [...key].some(character => {
    const code = character.codePointAt(0);
    return code < 0x21 || code > 0x7e;
  })) throw new Error('Enter a nonempty API key without spaces or line breaks.');
  return key;
}

function createOpenAICredentialStore({ file, safeStorage, fsImpl = fs }) {
  if (!file || !safeStorage) throw new Error('OpenAI credential storage is unavailable.');
  function encryptionReady() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Sign in to Windows and try again.');
  }
  return {
    status() {
      if (!fsImpl.existsSync(file)) return false;
      try {
        encryptionReady();
        return Boolean(safeStorage.decryptString(fsImpl.readFileSync(file)).trim());
      } catch { return false; }
    },
    read() {
      if (!fsImpl.existsSync(file)) return '';
      encryptionReady();
      return validatedAPIKey(safeStorage.decryptString(fsImpl.readFileSync(file)));
    },
    save(value) {
      encryptionReady();
      const encrypted = safeStorage.encryptString(validatedAPIKey(value));
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      fsImpl.writeFileSync(temporary, encrypted, { mode: 0o600 });
      try { fsImpl.renameSync(temporary, file); }
      catch (error) { try { fsImpl.unlinkSync(temporary); } catch { /* keep the original key */ } throw error; }
      return true;
    },
    remove() {
      if (fsImpl.existsSync(file)) fsImpl.unlinkSync(file);
      return false;
    }
  };
}

function clientError(status) {
  if (status === 401) return new Error('OpenAI could not authenticate the API key. Check or replace it in Settings.');
  if (status === 403) return new Error("OpenAI denied access. Check the API key's project permissions and model access.");
  if (status === 429) return new Error("OpenAI's rate or usage limit was reached. Check your API quota and billing, or try again later.");
  if (status >= 500) return new Error('OpenAI is temporarily unavailable. Try again later.');
  return new Error(`OpenAI rejected the request (HTTP ${status}). Check the selected model and request settings.`);
}

function responseText(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.status !== 'string') throw new Error('OpenAI returned malformed or unexpected JSON.');
  if (payload.status === 'cancelled') { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; }
  if (['incomplete', 'in_progress', 'queued'].includes(payload.status) || payload.incomplete_details != null) throw new Error('OpenAI did not finish the response. No partial result was used. Try a shorter request.');
  if (payload.status === 'failed' || payload.error != null) throw new Error('OpenAI could not complete the response. No partial result was used.');
  if (payload.status !== 'completed' || !Array.isArray(payload.output)) throw new Error('OpenAI returned malformed or unexpected JSON.');
  const fragments = [];
  for (const item of payload.output) {
    if (!item || typeof item.type !== 'string') throw new Error('OpenAI returned malformed or unexpected JSON.');
    if (item.type !== 'message') continue;
    if (item.role !== 'assistant' || !Array.isArray(item.content)) throw new Error('OpenAI returned malformed or unexpected JSON.');
    if (item.status && item.status !== 'completed') {
      if (['incomplete', 'in_progress'].includes(item.status)) throw new Error('OpenAI did not finish the response. No partial result was used. Try a shorter request.');
      throw new Error('OpenAI returned malformed or unexpected JSON.');
    }
    for (const part of item.content) {
      if (!part || typeof part.type !== 'string') throw new Error('OpenAI returned malformed or unexpected JSON.');
      if (part.type === 'refusal') throw new Error('OpenAI declined this request. No partial result was used.');
      if (part.type === 'output_text') {
        if (typeof part.text !== 'string') throw new Error('OpenAI returned malformed or unexpected JSON.');
        fragments.push(part.text);
      }
    }
  }
  const text = fragments.join('').trim();
  if (!text) throw new Error('OpenAI returned no text.');
  return text;
}

function createOpenAIClient({ fetchImpl = global.fetch, baseURL = OPENAI_BASE_URL } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('OpenAI network transport is unavailable.');
  const base = new URL(baseURL);
  if (base.href !== OPENAI_BASE_URL) throw new Error('OpenAI endpoint must be the official HTTPS API.');
  async function request(pathname, apiKey, options = {}) {
    const url = new URL(pathname, base);
    const headers = { Accept: 'application/json', Authorization: `Bearer ${validatedAPIKey(apiKey)}`, ...(options.headers || {}) };
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers, redirect: 'manual', cache: 'no-store', credentials: 'omit' });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Could not connect to OpenAI. Check your internet connection and try again.');
    }
    if (response.status >= 300 && response.status < 400) throw new Error('OpenAI returned a redirect. It was blocked to protect your API key.');
    if (!response.ok) throw clientError(response.status);
    if (response.url && response.url !== url.href) throw new Error('OpenAI returned an unexpected network response.');
    try { return await response.json(); }
    catch { throw new Error('OpenAI returned malformed or unexpected JSON.'); }
  }
  return {
    async listModels(apiKey, signal) {
      const payload = await request('models', apiKey, { method: 'GET', signal });
      if (!Array.isArray(payload?.data)) throw new Error('OpenAI returned malformed or unexpected JSON.');
      return [...new Set(payload.data.map(model => model?.id).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))].sort();
    },
    async generate({ apiKey, model, prompt, system, signal }) {
      const chosenModel = String(model || '').trim();
      if (!chosenModel || typeof prompt !== 'string') throw new Error('Choose an OpenAI model for this task in Settings > Models.');
      const payload = await request('responses', apiKey, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chosenModel, input: prompt, instructions: system || undefined, store: false, stream: false, max_output_tokens: 8192 })
      });
      return responseText(payload);
    }
  };
}

module.exports = { OPENAI_BASE_URL, validatedAPIKey, createOpenAICredentialStore, createOpenAIClient, responseText };
