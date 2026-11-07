const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'connected-translation-'));
  const model = 'translategemma:4b';
  const citations = [
    '[1] Ng, A. (2021). Results for the previous sensor. Journal of Testing.',
    '[2] J. Lee and P. Moss. Sensors in the field. Proceedings of Testing, 2022.',
    '[3] Renée Moreau, Liam Clarke, and Amy Gold. Estimating calibration error, 2018.'
  ];
  const paragraphs = [
    'Opening method. ' + 'Sample measurement was calibrated. '.repeat(73),
    'Second opening paragraph. ' + 'The baseline was repeated. '.repeat(53),
    'Separate middle batch. ' + 'The measured difference was small. '.repeat(116),
    ...citations,
    'Appendix A. Final unprocessed batch. ' + 'Evidence requires further validation. '.repeat(112)
  ].map(text => text.trim());
  const excerpts = [];
  let heldResponse;
  let initialRun = true;
  const ollama = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    const excerpt = JSON.parse(body).prompt.split('Paper excerpt:\n').at(-1);
    excerpts.push(excerpt);
    if (initialRun && excerpt.startsWith('Separate middle batch.')) {
      response.statusCode = 503;
      return response.end('{}');
    }
    if (initialRun && excerpt.startsWith('Appendix A.')) { heldResponse = response; return; }
    const text = excerpt.startsWith('Opening method.') ? '第一批译文。' : excerpt.startsWith('Separate middle batch.') ? '第二批译文。' : '第三批译文。';
    response.end(JSON.stringify({ response: text, done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Paste Text', exact: true }).first().click();
    await page.locator('.paste-area').fill(paragraphs.join('\n\n'));
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('Translating full paper · batch 3 of 3', { exact: true }).waitFor();
    for (let attempt = 0; attempt < 100 && !heldResponse; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(heldResponse, 'The last request should be in flight before testing Stop');
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await stop.click();
    heldResponse?.end(JSON.stringify({ response: 'Discard this late answer.', done: true }));
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).waitFor();
    const partial = page.locator('[data-view-scope="fullTranslation"]');
    await partial.getByText('第一批译文。', { exact: true }).waitFor();
    assert.match(await partial.innerText(), /Separate middle batch/);
    assert.match(await partial.innerText(), /Final unprocessed batch/);
    assert.doesNotMatch(await partial.innerText(), /Discard this late answer/);
    await app.close(); app = null;

    initialRun = false;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).waitFor();
    await page.keyboard.press('Control+Enter');
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    const completed = page.locator('[data-view-scope="fullTranslation"]');
    for (const text of ['第一批译文。', '第二批译文。', '第三批译文。', ...citations]) {
      await completed.getByText(text, { exact: true }).waitFor();
    }
    assert.equal(excerpts.length, 5, 'Only failed and interrupted batches should run again');
    assert.equal(excerpts[0], paragraphs.slice(0, 2).join('\n\n'));
    assert.equal(excerpts[1], paragraphs[2]);
    assert.equal(excerpts[3], excerpts[1]);
    assert.equal(excerpts[4], paragraphs.at(-1));
    assert.ok(excerpts.every(excerpt => excerpt.length <= 4800));
    assert.ok(excerpts.every(excerpt => citations.every(citation => !excerpt.includes(citation))));
    const file = fs.readdirSync(path.join(workspace, 'papers')).find(name => /^[a-f\d]{64}\.json$/.test(name));
    await page.waitForFunction(async id => {
      const paper = await window.paperBridge.loadPaper(id);
      return paper?.connectedBlocks?.every(batch => batch.status === 'ok');
    }, path.basename(file, '.json'));
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', file), 'utf8'));
    assert.equal(saved.connectedBatchVersion, 1);
    assert.ok(saved.blocks.every(block => block.status === 'pending'), 'Plain connected translation should leave Reader output independent');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const reference = page.locator('#block-4');
    await reference.getByText(citations[0], { exact: true }).waitFor();
    await reference.getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    assert.match(await page.locator('.reader-summary').innerText(), /0 of 4 blocks translated/);
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    const preview = page.locator('[data-paper-block-id="4"]');
    await preview.getByText(citations[0], { exact: true }).waitFor();
    assert.equal(await preview.locator('.paper-preview-translation').count(), 0);
    const destination = path.join(workspace, 'translated.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More' }).click();
    await page.locator('.modal-body').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Translated Markdown', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    assert.ok(exported.includes(citations.join('\n\n')));
    assert.doesNotMatch(exported, /\[Untranslated block [456]\]/);
    console.log('Connected translation verified: excerpt batching, unlabelled references, appendix, restart resume and Markdown export.');
  } finally {
    heldResponse?.destroy();
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
