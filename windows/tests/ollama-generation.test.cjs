const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ollamaRequest } = require('../electron/ollama-http.cjs');
const { requestGeneration } = require('../electron/ollama-generation.cjs');

async function endpoint(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('a slow local generator can return the complete Unicode response after delayed headers and body', async t => {
  const url = await endpoint(t, async (req, res) => {
    const pieces = [];
    for await (const piece of req) pieces.push(piece);
    assert.equal(req.url, '/api/generate');
    assert.equal(JSON.parse(Buffer.concat(pieces)).stream, false);
    const data = Buffer.from(JSON.stringify({ response: '测温', done: true }));
    setTimeout(() => {
      res.write(data.subarray(0, 15));
      setTimeout(() => res.end(data.subarray(15)), 40);
    }, 40);
  });
  assert.deepEqual(await requestGeneration(url, { stream: false }, new AbortController().signal, { idleMs: 1500 }), { response: '测温', done: true });
});

test('generation rejects incorrect response types and presents the Ollama server error', async t => {
  let status = 200, body = '';
  const url = await endpoint(t, (_req, res) => { res.writeHead(status); res.end(body); });
  const request = () => requestGeneration(url, {}, new AbortController().signal);
  for (body of ['<html>Proxy</html>', 'null', '[]', '{"response":32}', '{"done":"false","response":"partial"}']) {
    await assert.rejects(request(), /unreadable generation response/);
  }
  status = 500;
  body = JSON.stringify({ error: 'model requires more system memory', done: false });
  await assert.rejects(request(), { message: 'Ollama 500: model requires more system memory' });
});

test('waiting for a model can be cancelled and slow headers and incomplete bodies time out', async t => {
  let withHeaders = false;
  const url = await endpoint(t, (_req, res) => { if (withHeaders) res.write('{"response":'); });
  const controller = new AbortController();
  const pending = requestGeneration(url, {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  for (withHeaders of [false, true]) {
    await assert.rejects(requestGeneration(url, {}, new AbortController().signal, { idleMs: 80 }), /timed out during generation/);
  }
  await assert.rejects(requestGeneration(url, {}, new AbortController().signal, { totalMs: 80 }), /timed out during generation/);
});

test('model downloads stream through a named loopback mount and redirects stay at the configured origin', async t => {
  const observed = [];
  let finish;
  const url = await endpoint(t, (req, res) => {
    observed.push(req.url);
    if (req.url === '/models/api/tags') { res.writeHead(307, { Location: '/moved' }); return res.end('Moved'); }
    assert.equal(req.url, '/models/api/pull');
    assert.equal(req.method, 'POST');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"status":"pulling"}\n');
    finish = () => res.end('{"status":"success"}\n');
  });
  const base = url.replace('127.0.0.1', 'papers.localhost') + '/models/';
  const stream = await ollamaRequest(base, 'api/pull', { method: 'POST', body: '{"model":"example"}' });
  assert.equal(stream.headers.get('content-type'), 'application/x-ndjson');
  const reader = stream.body.getReader(), decoder = new TextDecoder();
  assert.equal(decoder.decode((await reader.read()).value), '{"status":"pulling"}\n');
  finish();
  assert.equal(decoder.decode((await reader.read()).value), '{"status":"success"}\n');
  assert.equal((await reader.read()).done, true);
  await assert.rejects(ollamaRequest(base, 'api/tags'), /Ollama 307: Moved/);
  assert.deepEqual(observed, ['/models/api/pull', '/models/api/tags']);
});

test('service errors and truncated network responses keep their separate recovery messages', async t => {
  let closed = false;
  const url = await endpoint(t, (_req, res) => {
    if (closed) { res.writeHead(200, { 'Content-Length': 100 }); res.write('{"response":'); return setImmediate(() => res.destroy()); }
    res.writeHead(500); res.end('model requires more system memory');
  });
  await assert.rejects(requestGeneration(url, {}, new AbortController().signal), /Ollama 500: model requires more system memory/);
  closed = true;
  await assert.rejects(requestGeneration(url, {}, new AbortController().signal), /Lost the connection.*during generation/);
});
