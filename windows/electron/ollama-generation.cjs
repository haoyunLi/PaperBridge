const http = require('node:http');
const { localOllamaURL } = require('./ollama-installation.cjs');

// Ollama may send no headers until the whole non-streaming response is ready.
// Match the Mac client's ten-minute idle limit and six-hour resource limit.
async function requestGeneration(baseURL, payload, signal, { idleMs = 600000, totalMs = 21600000 } = {}) {
  const url = localOllamaURL(baseURL, 'api/generate');
  const deadline = AbortSignal.timeout(totalMs);
  const combined = AbortSignal.any([signal, deadline]);
  let body, status, idleTimeout = false;
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', signal: combined, headers: { 'Content-Type': 'application/json' } }, resolve);
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
    throw new Error('Lost the connection to local Ollama during generation.' + detail);
  }
  if (status < 200 || status >= 300) throw new Error('Ollama ' + status + ': ' + body.slice(0, 300));
  return JSON.parse(body);
}

module.exports = { requestGeneration };
