const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');

async function run(failure) {
  const root = path.resolve(__dirname, '..');
  const big = 'translategemma:27b', small = 'translategemma:4b';
  let submitted = [], constrained = true;
  const memoryFailure = failure === 'memory' || failure === 'memory-in-body';
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [big, small].map(name => ({ model: name })) }));
    if (req.url === '/api/ps') return res.end('{"models":[]}');
    if (req.url !== '/api/generate') { res.statusCode = 404; return res.end('{}'); }
    let payload = '';
    for await (const chunk of req) payload += chunk;
    const { model, prompt } = JSON.parse(payload);
    submitted.push({ model, prompt });
    if (model === big && constrained && submitted.length > 1) {
      if (failure === 'disconnect') return res.destroy();
      if (failure === 'partial-response') {
        res.write('{"response":');
        return setTimeout(() => res.destroy(), 30);
      }
      res.statusCode = failure === 'memory-in-body' ? 200 : 500;
      return res.end(JSON.stringify({ done: false, error: 'model requires more system memory (18.5 GiB) than is available (10.2 GiB)' }));
    }
    res.end(JSON.stringify({ response: model === big ? '首段结果。' : '后续结果。', done: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(root, 'test-artifacts', 'model-memory-recovery-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, translationModel: big, ollamaBaseURL: 'http://127.0.0.1:' + server.address().port }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  try {
    const page = await app.firstWindow();
    const select = async model => {
      await page.getByLabel('Translation model', { exact: true }).selectOption(model);
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    };
    const smaller = page.getByRole('button', { name: memoryFailure ? 'Choose a smaller model' : 'Choose another model', exact: true });
    const recover = async () => {
      await smaller.click();
      await page.getByRole('tab', { name: 'Models', selected: true }).waitFor();
      await select(small);
    };
    async function paste(parts, view) {
      await revealSidebarSource(page);
      await openPasteText(page);
      await page.locator('.paste-area').fill(parts.join('\n\n'));
      return loadPastedText(page, { view });
    }
    const input = ['The first sample measured temperature.', 'The second sample recorded rainfall.', 'The third sample captured wind speed.'];
    const id = await paste(input, 'Reader');
    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await smaller.waitFor();
    if (!memoryFailure) {
      await page.getByRole('button', { name: 'Check local AI', exact: true }).click();
      await page.locator('.setup-panel').waitFor();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      assert.equal(await page.getByText('Ollama reported insufficient memory to run the selected model.').count(), 0);
    }
    assert.deepEqual(submitted.map(item => item.model), [big, big]);
    const stored = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    assert.equal(stored.blocks[0].translation, '首段结果。');
    assert.ok(stored.blocks.slice(1).every(b => !b.translation && b.status !== 'failed'));
    await recover();
    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await page.locator('#block-3 .translation-text.done').waitFor();
    assert.deepEqual(submitted.map(item => item.model), [big, big, small, small, small]);
    assert.equal(await page.locator('#block-1 .translation-text.done').innerText(), '后续结果。');

    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
    await select(big);
    assert.equal(await page.locator('#block-1 .translation-text.done').innerText(), '首段结果。');
    constrained = false;
    await page.getByRole('button', { name: 'Resume Translation', exact: true }).click();
    await page.locator('#block-3 .translation-text.done').waitFor();
    assert.deepEqual(submitted.slice(5).map(item => item.model), [big, big]);
    constrained = true;
    const long = ['Opening measurement. ', 'Second observation. ', 'Final comparison. ']
      .map((label, i) => label + ('The researchers collected sample number ' + (i + 1) + ' before breakfast. ').repeat(54));
    const longID = await paste(long, 'Full Translation');
    submitted = [];
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await smaller.waitFor();
    assert.deepEqual(submitted.map(item => item.model), [big, big]);
    const draft = (await page.evaluate(id => window.paperBridge.loadPaper(id), longID)).connectedBlocks;
    assert.ok(draft.some(b => b.status === 'ok' && b.output === '首段结果。') && draft.some(b => b.status === 'pending'));
    assert.ok(draft.every(b => b.status !== 'failed'));
    await smaller.click();
    assert.equal(await page.getByLabel('Translation model', { exact: true }).inputValue(), big);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    constrained = false;
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).click();
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    const finished = (await page.evaluate(id => window.paperBridge.loadPaper(id), longID)).connectedBlocks;
    assert.ok(finished.every(b => b.status === 'ok'));
    for (const batch of draft.filter(b => b.status === 'ok')) assert.deepEqual(finished.find(b => b.source === batch.source), batch);
    assert.ok(submitted.slice(2).every(item => item.model === big));
    assert.ok(!submitted.slice(2).some(item => item.prompt === submitted[0].prompt));
    console.log(JSON.stringify({ failure, workspace: dir, reader: stored.blocks.length, connected: finished.length, resumed: submitted.length - 2 }));
  } finally { await app.close(); server.close(); }
}
async function main() {
  for (const failure of ['memory', 'memory-in-body', 'disconnect', 'partial-response']) await run(failure);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
