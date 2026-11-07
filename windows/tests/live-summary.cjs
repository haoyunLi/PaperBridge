// Opt-in AMD test. Reuse a real PDF workspace from the DirectML MinerU test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const source = process.env.PAPERBRIDGE_LIVE_SUMMARY_WORKSPACE || path.join(artifacts, 'live-mineru-directml-workspace');
  const workspace = fs.mkdtempSync(path.join(artifacts, 'summary-amd-'));
  fs.cpSync(source, workspace, { recursive: true });
  const paperDir = path.join(workspace, 'papers');
  const paperFile = path.join(paperDir, fs.readdirSync(paperDir).find(name => /^[a-f\d]{64}\.json$/.test(name)));
  const readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  const saved = readPaper();
  assert.equal(saved.sourceMode, 'mineru');
  const baseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  const modelName = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const summaryModel = process.env.PAPERBRIDGE_LIVE_SUMMARY_MODEL || 'qwen3:4b-instruct';
  const overrides = { ollamaBaseURL: baseURL, aiProvider: 'ollama', summaryModel, translationModel: modelName, autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const settingsFile = path.join(workspace, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), ...overrides }));
  fs.writeFileSync(paperFile, JSON.stringify({ ...saved, summary: null, taskSettings: { ...saved.taskSettings, ...overrides } }));

  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to PDF text', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to MinerU Markdown', exact: true }).waitFor();
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
    await page.waitForFunction(async id => Boolean((await window.paperBridge.loadPaper(id))?.summary), saved.id);
    const snapshot = await page.evaluate(async id => window.paperBridge.loadPaper(id), saved.id);
    const sources = snapshot.summary.claims.flatMap(claim => claim.sources);
    assert.ok(snapshot.summary.claims.length > 0 && snapshot.summary.claims.length <= 6);
    assert.ok(sources.length > 0, 'The live model should produce at least one exact citation');
    assert.ok(sources.every(source => snapshot.blocks.find(block => block.id === source.paragraphID)?.text.includes(source.quote)));
    assert.match(snapshot.summary.target, /[\u3400-\u9fff]/);
    const stages = await page.evaluate(() => [...window.summaryStages]);
    assert.ok(stages.filter(stage => stage.startsWith('Summarizing part ')).length >= 4);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).check();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const evidence = page.locator('.evidence-claim').filter({ hasText: 'Read original block' }).first();
    await evidence.locator('summary').click();
    await evidence.getByRole('button', { name: /Read original block/ }).first().click();
    await page.locator(`#block-${sources[0].paragraphID}.current`).waitFor();
    assert.equal(await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Bilingual', exact: true }).isChecked(), true);
    const loaded = await fetch(new URL('/api/ps', baseURL)).then(response => response.json());
    const models = loaded.models.filter(item => [modelName, summaryModel].includes(item.name || item.model));
    assert.ok(models.some(model => (model.name || model.model) === modelName && model.size_vram > 0), 'Ollama must report translation model VRAM allocation');
    console.log(JSON.stringify({
      workspace, seconds: (Date.now() - started) / 1000, stages, claims: snapshot.summary.claims.length,
      exactSources: sources.length, uniqueBlocks: [...new Set(sources.map(source => source.paragraphID))],
      models: models.map(model => ({ name: model.name || model.model, vram: model.size_vram, modelSize: model.size }))
    }, null, 2));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
