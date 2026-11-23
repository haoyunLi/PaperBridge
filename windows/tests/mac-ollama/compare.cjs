// Feed both production clients identical HTTP responses, including an EOF before the success record.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ollamaRequest } = require('../../electron/ollama-http.cjs');
const { readOllamaModelList } = require('../../electron/ollama-models.mjs');
const { pullOllamaModel } = require('../../electron/model-pull.cjs');
const { generateOllamaText } = require('../../electron/ollama-generation.cjs');

async function run() {
  const [referenceFile, nativeExecutable] = process.argv.slice(2);
  const routes = [], submitted = [];
  const generations = { text: { done: true, response: '  测温\n' }, memory: { done: false, error: 'model requires more system memory' },
    length: { done: true, done_reason: 'length', response: 'incomplete translation' }, empty: { response: '  ' }, malformed: { response: 42 } };
  const server = http.createServer(async (req, res) => {
    const generation = /^\/mounted\/([a-z]+)\/api\/generate$/.exec(req.url);
    if (generation && Object.hasOwn(generations, generation[1])) {
      const chunks = [];
      for await (const piece of req) chunks.push(piece);
      submitted.push(JSON.parse(Buffer.concat(chunks)));
      routes.push(req.method + ' ' + generation[1] + '/generate');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(generations[generation[1]]));
    }
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
    res.write('{"completed":32,"total":64}\n');
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
        try {
          const samples = [];
          result[scenario] = await pullOllamaModel(base + '/' + scenario, 'reader:4b', signal, event => {
            if (event.total != null && event.completed != null) samples.push([event.status, event.completed, event.total]);
          });
          if (scenario === 'success') result.byteProgress = samples;
        }
        catch (error) { assert.match(error.message, /before Ollama confirmed/); result[scenario] = false; }
      }
      await assert.rejects(inventory('invalid'), /did not return an Ollama model list/);
      result.invalidRejected = true;
      result.generations = {};
      for (const scenario of Object.keys(generations)) {
        try {
          result.generations[scenario] = await generateOllamaText(base + '/' + scenario, {
            model: 'reader:4b', prompt: 'Temperature?', system: 'Translate.'
          }, signal);
        } catch (error) {
          const expected = { memory: /requires more system memory/, length: /cut off/, empty: /empty response/, malformed: /unreadable generation/ };
          assert.match(error.message, expected[scenario]);
          result.generations[scenario] = { memory: 'memory', length: 'incomplete', empty: 'empty', malformed: 'invalid' }[scenario];
        }
      }
    }
    assert.deepEqual(result, { models: ['reader:4b', 'z:7b'], success: true, installed: true, missing: false, invalidRejected: true,
      byteProgress: [['Downloading reader:4b...', 32, 64]], generations: { text: '测温', memory: 'memory', length: 'incomplete', empty: 'empty', malformed: 'invalid' } });
    assert.equal(submitted.length, Object.keys(generations).length);
    for (const payload of submitted) assert.deepEqual(payload, { model: 'reader:4b', prompt: 'Temperature?', system: 'Translate.', stream: false, options: { temperature: 0.1 } });
    assert.deepEqual(routes, ['GET inventory/tags', 'POST success/pull', 'POST installed/pull', 'GET installed/tags',
      'POST missing/pull', 'GET missing/tags', 'GET invalid/tags', ...Object.keys(generations).map(name => 'POST ' + name + '/generate')]);
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
