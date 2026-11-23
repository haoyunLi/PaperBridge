const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { Readable } = require('node:stream');
const { localOllamaURL } = require('./ollama-installation.cjs');

// Preserve the requested local hostname for virtual hosts and TLS, while
// connecting only to loopback addresses even when system DNS is customized.
function lookupLoopback(_host, options, callback) {
  const ipv4 = { address: '127.0.0.1', family: 4 }, ipv6 = { address: '::1', family: 6 };
  const addresses = options.family === 6 ? [ipv6] : options.family === 4 ? [ipv4] : [ipv4, ipv6];
  if (options.all) callback(null, addresses);
  else callback(null, addresses[0].address, addresses[0].family);
}

function localRequest(url, options, callback) {
  if (url.protocol === 'http:') return http.request(url, { ...options, lookup: lookupLoopback }, callback);
  // Include local CAs installed in Windows, e.g. for a user's HTTPS reverse proxy.
  const ca = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
  return https.request(url, { ...options, lookup: lookupLoopback, ca }, callback);
}

function localCertificateError(cause) {
  return /^(?:ERR_TLS_CERT_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(?:GET_ISSUER_CERT|VERIFY_LEAF_SIGNATURE))/.test(cause?.code || '')
    ? new Error('The local Ollama HTTPS certificate could not be verified. Check its hostname, validity and Windows trust settings.') : null;
}

async function ollamaRequest(baseURL, endpoint, options = {}) {
  const url = localOllamaURL(baseURL, endpoint);
  let response;
  try {
    const incoming = await new Promise((resolve, reject) => {
      const request = localRequest(url, { method: options.method || 'GET', headers: options.headers, signal: options.signal }, resolve);
      request.on('error', reject);
      request.end(options.body);
    });
    const noBody = [204, 205, 304].includes(incoming.statusCode);
    if (noBody) incoming.resume();
    response = new Response(noBody ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers: incoming.headers });
  } catch (cause) {
    if (options.signal?.aborted && options.signal.reason?.name !== 'TimeoutError') {
      const error = new Error('Setup cancelled.'); error.name = 'AbortError'; throw error;
    }
    throw localCertificateError(cause) || new Error('Cannot reach local Ollama. Start Ollama, then refresh models.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Ollama ${response.status}: ${message.slice(0, 300)}`);
  }
  return response;
}

const ollamaIdleMs = 10 * 60 * 1000;
const ollamaTotalMs = 6 * 60 * 60 * 1000;
module.exports = { localRequest, localCertificateError, ollamaRequest, ollamaIdleMs, ollamaTotalMs };
