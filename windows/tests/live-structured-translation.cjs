// Opt-in. Exercises structured translation against an installed Ollama model and records its actual inputs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'live-structured-'));
  const formula = '$F = m a$';
  const code = '``printf(`sample`, "$&")``';
  const html = '<span title="signal > threshold">';
  const figure = '[![Calibration](images/panel(2).png)](supplement/figure(2).pdf)';
  const autolinks = process.argv.includes('--autolinks') ? [
    'https://example.org/controls/(baseline)/calibration#plot',
    'www.example.org/archive_(reference)/readings',
    'calibration+data@example.org'
  ] : [];
  const markdown = [
    'The control group measured acceleration with ' + formula + '. The instrument recorded each sample using ' + code + '.',
    'The report marked ' + html + 'the strongest response</span>. The calibration figure ' + figure + ' shows the response at low temperature.',
    ...(autolinks.length ? ['The primary record is at ' + autolinks[0] + '. Independent readings are available at ' + autolinks[1] + '. Contact ' + autolinks[2] + ' for the raw measurements.'] : [])
  ].join('\n\n');
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown);
  const id = createHash('sha256').update(markdown).digest('hex');
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const base = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  const paper = { id, name: 'Control measurements', type: 'text', sourceMode: 'mineru', blocks,
    mineruBlocks: blocks, mineruMarkdown: markdown, position: { tab: 'Full Translation', displayMode: 'bilingual', block: 1 } };
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1,
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', aiProvider: 'ollama', ollamaBaseURL: base,
    translationModel: model, autoCheckUpdates: false }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  const report = { workspace, model, source: markdown };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Full Translation');
    await app.evaluate(() => {
      const fetchLocal = global.fetch;
      global.structuredInputs = [];
      global.fetch = (url, options) => {
        if (new URL(url).pathname === '/api/generate' && typeof options?.body === 'string') {
          global.structuredInputs.push(JSON.parse(options.body).prompt);
        }
        return fetchLocal(url, options);
      };
    });
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText(/^(?:Structure-preserving full translation saved\.|Full translation saved with \d+ unfinished block)/).waitFor({ timeout: 180000 });
    const paperPath = path.join(workspace, 'papers', id + '.json');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !JSON.parse(fs.readFileSync(paperPath, 'utf8')).blocks.every(block =>
      ['ok', 'failed'].includes(block.status))) await new Promise(resolve => setTimeout(resolve, 100));
    const saved = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    report.version = await page.evaluate(async () => (await window.paperBridge.bootstrap()).version);
    report.inputs = await app.evaluate(() => global.structuredInputs);
    report.blocks = saved.blocks.map(({ status, translationMarkdown, error }) => ({ status, translationMarkdown, error }));
    const active = (await (await fetch(base + '/api/ps')).json()).models.find(item => item.name === model || item.model === model);
    report.modelVramBytes = active?.size_vram;
    assert.ok(report.modelVramBytes > 0, 'Expected model inference on the GPU');
    assert.ok(report.inputs.length >= 2, 'Expected requests for both paragraphs');
    for (const input of report.inputs) for (const literal of ['printf(', 'signal > threshold', 'panel(2).png', 'figure(2).pdf', 'F = m a', ...(autolinks.length ? ['calibration#plot', 'archive_(reference)', autolinks[2]] : [])]) {
      assert.ok(!input.includes(literal), 'Protected content reached the model: ' + literal);
    }
    assert.ok(report.blocks.every(block => block.status === 'ok' && /[\u3400-\u9fff]/u.test(block.translationMarkdown)), JSON.stringify(report.blocks));
    for (const literal of [formula, code, html, '</span>', figure, ...autolinks]) assert.ok(saved.connectedTranslation.includes(literal), literal);
    const destination = path.join(workspace, 'full-translation.md');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Full Translation Markdown', exact: true }).click();
    await page.getByText(/^Exported .*full-translation\.md$/).waitFor();
    assert.ok(fs.readFileSync(destination, 'utf8').includes(saved.connectedTranslation));
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-1 .translation-text code').waitFor();
    assert.equal(await page.locator('#block-1 .translation-text code').textContent(), 'printf(`sample`, "$&")');
    assert.equal(await page.locator('#block-2 .translation-text a').getAttribute('href'), 'supplement/figure(2).pdf');
    if (autolinks.length) {
      const links = await page.locator('#block-3 .translation-text a').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
      report.readerLinks = links;
      assert.deepEqual(links, [autolinks[0], 'http://' + autolinks[1], 'mailto:' + autolinks[2]]);
    }
    assert.equal((await page.evaluate(id => window.paperBridge.loadPaper(id), id)).connectedTranslation, saved.connectedTranslation);
    report.passed = true;
  } finally {
    await app.close();
    fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(report, null, 2));
    console.log(workspace);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
