// Feed both production clients identical HTTP responses, including an EOF before the success record.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ollamaRequest } = require('../../electron/ollama-http.cjs');
const { readOllamaModelList } = require('../../electron/ollama-models.mjs');
const { pullOllamaModel } = require('../../electron/model-pull.cjs');

async function run() {
  const [referenceFile, nativeExecutable] = process.argv.slice(2);
  const routes = [];
  const server = http.createServer((req, res) => {
    const match = /^\/mounted\/(inventory|success|installed|missing|invalid)\/api\/(tags|pull)$/.exec(req.url);
    if (!match) { res.writeHead(404); return res.end(); }
    const [, scenario, endpoint] = match;
    routes.push(req.method + ' ' + scenario + '/' + endpoint);
    if (endpoint === 'tags') {
      res.setHeader('Content-Type', 'application/json');
      if (scenario === 'invalid') return res.end('<html>Local proxy home</html>');
      const models = scenario === 'inventory' ? [{ model: 'z:7b' }, { name: 'reader:4b' }, { model: 'z:7b' }] :
        [{ name: scenario === 'installed' ? 'reader:4b' : 'other:4b' }];
      return res.end(JSON.stringify({ models }));
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write('{"status":"pulling manifest"}\n');
    res.end(scenario === 'success' ? '{"status":"Success"}' : '{"status":"writing manifest"}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port + '/mounted';
  try {
    let result;
    if (nativeExecutable) {
      const { stdout } = await promisify(execFile)(nativeExecutable, [base], { timeout: 30000 });
      result = JSON.parse(stdout);
    } else {
      const signal = AbortSignal.timeout(15000);
      const inventory = async scenario => readOllamaModelList(await ollamaRequest(base + '/' + scenario, 'api/tags', { signal }));
      result = { models: await inventory('inventory') };
      for (const scenario of ['success', 'installed', 'missing']) {
        try { result[scenario] = await pullOllamaModel(base + '/' + scenario, 'reader:4b', signal, () => {}); }
        catch (error) { assert.match(error.message, /before Ollama confirmed/); result[scenario] = false; }
      }
      await assert.rejects(inventory('invalid'), /did not return an Ollama model list/);
      result.invalidRejected = true;
    }
    assert.deepEqual(result, { models: ['reader:4b', 'z:7b'], success: true, installed: true, missing: false, invalidRejected: true });
    assert.deepEqual(routes, ['GET inventory/tags', 'POST success/pull', 'POST installed/pull', 'GET installed/tags',
      'POST missing/pull', 'GET missing/tags', 'GET invalid/tags']);
    const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
    if (nativeExecutable) {
      reference.ollamaModelDiscovery = { result, routes };
      fs.writeFileSync(referenceFile, JSON.stringify(reference));
    } else assert.deepEqual({ result, routes }, reference.ollamaModelDiscovery);
    console.log('Checked installed model discovery, custom path, terminal status and incomplete downloads.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
