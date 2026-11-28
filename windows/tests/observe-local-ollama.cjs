const http = require('node:http');
const https = require('node:https');
const { localOllamaURL } = require('../electron/ollama-installation.cjs');

// Observe what reaches the real local model regardless of the client's HTTP library.
async function observeLocalOllama(baseURL, { identity, prefix = '' } = {}) {
  const calls = [], routes = new Set();
  const handle = async (req, res) => {
    const cancel = new AbortController();
    res.on('close', () => { if (!res.writableEnded) cancel.abort(); });
    try {
      const endpoint = req.url.startsWith(prefix + '/') && /^\/api\/([a-z]+)$/.exec(req.url.slice(prefix.length))?.[1];
      if (!endpoint) { res.writeHead(404); return res.end(); }
      routes.add(req.url);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = endpoint === 'generate' && body ? JSON.parse(body) : null;
      const call = request ? { prompt: request.prompt, system: request.system } : null;
      if (call) calls.push(call);
      const response = await fetch(localOllamaURL(baseURL, 'api/' + endpoint), { method: req.method,
        headers: { 'Content-Type': 'application/json' }, body, signal: cancel.signal, redirect: 'error' });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (call && response.ok) call.response = JSON.parse(bytes).response;
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' });
      res.end(bytes);
    } catch (error) {
      if (!res.destroyed) { res.writeHead(502); res.end(JSON.stringify({ error: error.message })); }
    }
  };
  const server = identity ? https.createServer(identity, handle) : http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  return { calls, routes, url: (identity ? 'https://papers.localhost:' : 'http://127.0.0.1:') + server.address().port + prefix,
    close() { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
module.exports = { observeLocalOllama };
