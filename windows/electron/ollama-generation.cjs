const { localRequest, localCertificateError, ollamaIdleMs, ollamaTotalMs } = require('./ollama-http.cjs');
const { localOllamaURL } = require('./ollama-installation.cjs');

// Ollama may send no headers until the whole non-streaming response is ready.
// Match the Mac client's ten-minute idle limit and six-hour resource limit.
async function requestGeneration(baseURL, payload, signal, { idleMs = ollamaIdleMs, totalMs = ollamaTotalMs } = {}) {
  const url = localOllamaURL(baseURL, 'api/generate');
  const deadline = AbortSignal.timeout(totalMs);
  const combined = AbortSignal.any([signal, deadline]);
  let body, status, idleTimeout = false;
  try {
    const response = await new Promise((resolve, reject) => {
      const req = localRequest(url, { method: 'POST', signal: combined, headers: { 'Content-Type': 'application/json' } }, resolve);
      req.on('error', reject);
      req.setTimeout(idleMs, () => { idleTimeout = true; req.destroy(new Error('Ollama idle timeout')); });
      req.end(JSON.stringify(payload));
    });
    status = response.statusCode;
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    body = Buffer.concat(chunks).toString('utf8');
  } catch (cause) {
    signal.throwIfAborted();
    if (deadline.aborted || idleTimeout) throw new Error('Ollama timed out during generation.');
    const detail = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(cause.code) ? ' (' + cause.code + ')' : '';
    throw localCertificateError(cause) || new Error('Lost the connection to local Ollama during generation.' + detail);
  }
  let data;
  try { data = JSON.parse(body); } catch { /* An HTTP error may contain plain text. */ }
  if (status < 200 || status >= 300) {
    const detail = typeof data?.error === 'string' && data.error ? data.error : body;
    throw new Error('Ollama ' + status + ': ' + detail.slice(0, 300));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.done != null && typeof data.done !== 'boolean') ||
      ['response', 'done_reason', 'error'].some(key => data[key] != null && typeof data[key] !== 'string')) {
    throw new Error('The local Ollama service returned an unreadable generation response. Check the Ollama URL in Settings and try again.');
  }
  return data;
}

async function generateOllamaText(baseURL, { model, prompt, system, format }, signal) {
  const data = await requestGeneration(baseURL, {
    model, prompt, system, stream: false, ...(format === 'json' ? { format: 'json' } : {}),
    options: { temperature: 0.1, ...(format === 'json' ? { num_predict: 2048 } : {}) }
  }, signal);
  if (data.error) throw new Error(data.error);
  if (data.done === false || data.done_reason === 'length') {
    throw new Error(format === 'json' ? 'The summary response was cut off. Choose a different summary model in Settings and try again.' : 'Model response was cut off. Try a smaller paragraph.');
  }
  const text = data.response?.trim();
  if (!text) throw new Error('Ollama returned an empty response.');
  return text;
}

module.exports = { requestGeneration, generateOllamaText };
