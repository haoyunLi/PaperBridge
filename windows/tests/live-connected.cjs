// Opt-in AMD check using the workspace created by the real 15-page MinerU test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const source = path.join(artifacts, 'live-mineru-directml-workspace');
  const workspace = fs.mkdtempSync(path.join(artifacts, 'connected-amd-'));
  fs.cpSync(source, workspace, { recursive: true });
  const baseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  const modelName = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const settingsFile = path.join(workspace, 'settings.json');
  const paperDir = path.join(workspace, 'papers');
  const filename = fs.readdirSync(paperDir).find(name => /^[a-f\d]{64}\.json$/.test(name));
  const paperFile = path.join(paperDir, filename);
  const readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  const saved = readPaper();
  assert.equal(saved.sourceMode, 'mineru');
  assert.ok(saved.pdfBlocks.length > 20);
  assert.ok(!saved.connectedTranslation, 'Use a fresh workspace from the real MinerU import test');
  const overrides = { ollamaBaseURL: baseURL, aiProvider: 'ollama', translationModel: modelName, autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), ...overrides }));
  // Opening a saved paper restores its endpoint and task models.
  fs.writeFileSync(paperFile, JSON.stringify({ ...saved, taskSettings: { ...saved.taskSettings, ...overrides } }));

  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to PDF text', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to MinerU Markdown', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    const started = Date.now();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    const secondBatch = page.getByText(/Translating full paper · batch 2 of/);
    const preflight = secondBatch.or(page.locator('.notice.error')).first();
    await preflight.waitFor({ timeout: 120000 });
    assert.match(await preflight.innerText(), /batch 2 of/, 'The first batch should complete and the next should start');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await app.close(); app = null;

    const partial = readPaper();
    const first = partial.connectedBlocks.find(batch => batch.kind === 'translation' && batch.status === 'ok');
    assert.ok(first, 'A completed batch should survive cancellation and app close');
    assert.match(first.output, /[\u3400-\u9fff]/);
    const remainingAtRestart = partial.connectedBlocks.filter(batch => batch.kind === 'translation' && batch.status !== 'ok').length;
    assert.ok(remainingAtRestart > 1);
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).click();
    await page.getByText(/Connected full-paper translation saved/).waitFor({ timeout: 240000 });
    const loaded = await fetch(new URL('/api/ps', baseURL)).then(response => response.json());
    const model = loaded.models.find(item => item.name === modelName || item.model === modelName);
    assert.ok(model?.size_vram > 0, 'Ollama must report model VRAM allocation');
    await app.close(); app = null;
    const result = readPaper();
    assert.equal(result.connectedBlocks.find(batch => batch.source === first.source).output, first.output);
    assert.equal(result.sourceMode, 'pdf');
    const batches = result.connectedBlocks.filter(batch => batch.kind === 'translation');
    console.log(JSON.stringify({
      workspace, seconds: (Date.now() - started) / 1000, translationBatches: batches.length, remainingAtRestart,
      failed: batches.filter(batch => batch.status === 'failed').map(batch => ({ error: batch.error, sourceChars: batch.source.length })),
      vram: model.size_vram, modelSize: model.size
    }, null, 2));
    assert.ok(batches.every(batch => batch.status === 'ok' || (batch.status === 'failed' && batch.output === batch.source)),
      'Every batch must have a translation or its exact source fallback');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
