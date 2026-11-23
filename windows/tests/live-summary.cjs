// Opt-in AMD test using a new PDF or an isolated copy of the DirectML MinerU workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createHash } = require('node:crypto');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const source = process.env.PAPERBRIDGE_LIVE_SUMMARY_WORKSPACE || path.join(artifacts, 'live-mineru-directml-workspace');
  const workspace = fs.mkdtempSync(path.join(artifacts, 'summary-amd-'));
  const pdf = process.env.PAPERBRIDGE_LIVE_SUMMARY_PDF;
  if (!pdf) fs.cpSync(source, workspace, { recursive: true });
  const paperDir = path.join(workspace, 'papers');
  const id = pdf ? createHash('sha256').update(fs.readFileSync(pdf)).digest('hex')
    : fs.readdirSync(paperDir).find(name => /^[a-f\d]{64}\.json$/.test(name)).slice(0, -5);
  const paperFile = path.join(paperDir, id + '.json');
  const baseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  const modelName = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const summaryModel = process.env.PAPERBRIDGE_LIVE_SUMMARY_MODEL || 'qwen3:4b-instruct';
  const overrides = { ollamaBaseURL: baseURL, aiProvider: 'ollama', summaryModel, translationModel: modelName, autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const settingsFile = path.join(workspace, 'settings.json');
  const settings = pdf ? { ...defaults, pdfExtractionMode: 'pdfOnly' } : JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, ...overrides }));
  if (!pdf) {
    const saved = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.equal(saved.sourceMode, 'mineru');
    fs.writeFileSync(paperFile, JSON.stringify({ ...saved, summary: null, taskSettings: { ...saved.taskSettings, ...overrides } }));
  }

  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    if (pdf) {
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve(pdf));
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
      await page.getByRole('heading', { name: path.basename(pdf), exact: true }).waitFor({ timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('.task-progress'));
    } else {
      await page.getByRole('button', { name: 'Paper', exact: true }).click();
      await page.getByRole('button', { name: 'Switch to PDF text', exact: true }).click();
      await page.getByRole('button', { name: 'Switch to MinerU Markdown', exact: true }).waitFor();
    }
    await app.evaluate(() => {
      global.summaryInputs = [];
      const fetchLocal = global.fetch;
      global.fetch = (url, options) => {
        if (new URL(url).pathname === '/api/generate' && typeof options?.body === 'string') {
          const { prompt } = JSON.parse(options.body);
          if (prompt?.startsWith('Summarize this academic paper excerpt')) global.summaryInputs.push(prompt.slice(prompt.indexOf('\n\n') + 2));
        }
        return fetchLocal(url, options);
      };
    });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.evaluate(() => {
      window.summaryStages = new Set();
      const observer = new MutationObserver(() => {
        const stage = document.querySelector('.task-progress-heading strong')?.textContent;
        if (stage) window.summaryStages.add(stage);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const started = Date.now();
    await page.getByRole('button', { name: 'Generate summary' }).click();
    await page.getByText('Summary saved. Only exact-match source quotations are linked.', { exact: true })
      .or(page.locator('.notice.error')).first().waitFor({ timeout: 600000 });
    assert.equal(await page.locator('.notice.error').count(), 0, await page.locator('.notice.error').allTextContents());
    await page.waitForFunction(async id => Boolean((await window.paperBridge.loadPaper(id))?.summary), id);
    const snapshot = await page.evaluate(async id => window.paperBridge.loadPaper(id), id);
    const inputs = await app.evaluate(() => global.summaryInputs);
    const { summarySourceBlocks, summarySourceBatches } = await import('../src/paper.mjs');
    const expected = summarySourceBatches(summarySourceBlocks(snapshot.blocks)).map(batch => batch.map(block => `[P${block.id}]\n${block.text}`).join('\n\n'));
    assert.deepEqual(inputs, expected, 'Every sent source and paragraph ID must match the fresh import');
    fs.writeFileSync(path.join(workspace, 'model-inputs.json'), JSON.stringify(inputs));
    if (pdf && process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).pdfJournal;
      assert.equal(id, native.sourceSHA256);
      assert.deepEqual(inputs, native.currentWindowsSummaryBatches);
    }
    const sources = snapshot.summary.claims.flatMap(claim => claim.sources);
    assert.ok(snapshot.summary.claims.length > 0 && snapshot.summary.claims.length <= 6);
    assert.ok(sources.length > 0, 'The live model should produce at least one exact citation');
    assert.ok(sources.every(source => snapshot.blocks.find(block => block.id === source.paragraphID)?.text.includes(source.quote)));
    assert.match(snapshot.summary.target, /[\u3400-\u9fff]/);
    const stages = await page.evaluate(() => [...window.summaryStages]);
    assert.ok(stages.filter(stage => stage.startsWith('Summarizing part ')).length >= 4);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).check();
    const destinations = [];
    for (const [claimIndex, claim] of snapshot.summary.claims.entries()) {
      for (const [sourceIndex, source] of claim.sources.entries()) {
        await page.getByRole('button', { name: 'Overview', exact: true }).click();
        const panel = page.locator('.evidence-claim').nth(claimIndex);
        if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
        assert.equal(await panel.locator('blockquote').nth(sourceIndex).textContent(), source.quote);
        await panel.getByRole('button', { name: /Read original block/ }).nth(sourceIndex).click();
        const row = page.locator(`#block-${source.paragraphID}.current`);
        await row.waitFor();
        assert.equal(await page.getByRole('radio', { name: 'Bilingual', exact: true }).isChecked(), true);
        const original = await row.locator('.source-text').textContent();
        const text = original.normalize('NFC'), quote = source.quote.normalize('NFC');
        assert.ok(text.includes(quote));
        const unique = text.indexOf(quote) === text.lastIndexOf(quote);
        if (unique) await page.waitForFunction(({ paragraphID, quote }) => {
          const selection = window.getSelection(), host = document.querySelector('.main-scroll');
          if (selection?.toString() !== quote || !document.querySelector(`#block-${paragraphID} .source-text`)?.contains(selection.anchorNode)) return false;
          const rect = selection.getRangeAt(0).getBoundingClientRect(), viewport = host.getBoundingClientRect();
          return rect.bottom > viewport.top && rect.top < viewport.bottom;
        }, source);
        destinations.push({ claim: claimIndex + 1, paragraphID: source.paragraphID, unique });
      }
    }
    const destination = path.join(workspace, 'summary-evidence.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More' }).click();
    await page.locator('.modal-body').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    for (const source of sources) {
      const quote = source.quote.split('\n').map(line => '> ' + line).join('\n');
      assert.ok(exported.includes(`Original paragraph ${source.paragraphID}:\n${quote}`));
    }
    const loaded = await fetch(new URL('/api/ps', baseURL)).then(response => response.json());
    const models = loaded.models.filter(item => [modelName, summaryModel].includes(item.name || item.model));
    assert.ok(models.some(model => (model.name || model.model) === modelName && model.size_vram > 0), 'Ollama must report translation model VRAM allocation');
    console.log(JSON.stringify({
      workspace, sourceId: id, inputBatches: inputs.length, seconds: (Date.now() - started) / 1000, stages, claims: snapshot.summary.claims.length,
      exactSources: sources.length, destinations, uniqueBlocks: [...new Set(sources.map(source => source.paragraphID))],
      models: models.map(model => ({ name: model.name || model.model, vram: model.size_vram, modelSize: model.size }))
    }, null, 2));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
