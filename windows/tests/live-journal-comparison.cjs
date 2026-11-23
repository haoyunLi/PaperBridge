// Opt-in comparison with mac-local-translation/Compare.swift using the same public paper and model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'plos-local-translation-'));
  const samples = require('./mac-parity/good-enough/reader.json').blocks.filter(b => b.id >= 54 && b.id <= 56);
  assert.deepEqual(samples.map(b => b.id), [54, 55, 56]);
  const blocks = samples.map(({ text }, i) => ({ id: i + 1, text, status: 'pending' }));
  const id = createHash('sha256').update(blocks.map(b => b.text).join('\n\n')).digest('hex');
  const base = 'http://127.0.0.1:11434', model = 'translategemma:4b';
  const version = (await (await fetch(base + '/api/version')).json()).version;
  const weights = (await (await fetch(base + '/api/tags')).json()).models.find(m => m.name === model);
  assert.equal(version, '0.40.16');
  assert.equal(weights?.digest, 'c49d986b0764f5881c476eb21435bb62b7abc62347aab3d4a6071e811be510a1');
  fs.mkdirSync(path.join(workspace, 'papers'));
  const paperFile = path.join(workspace, 'papers', id + '.json');
  const read = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  fs.writeFileSync(paperFile, JSON.stringify({ id, name: 'Good enough practices in scientific computing', type: 'text',
    sourceMode: 'text', blocks, inspectorOpen: true, position: { tab: 'Reader', block: 1 } }));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, aiProvider: 'ollama',
    ollamaBaseURL: base, translationModel: model, maxParagraphChars: 500, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  try {
    const page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await app.evaluate(() => {
      global.plosRequests = [];
      const nativeFetch = global.fetch;
      global.fetch = (url, options) => {
        if (new URL(url).pathname === '/api/generate') global.plosRequests.push(JSON.parse(options.body).prompt);
        return nativeFetch(url, options);
      };
    });
    const waitForSave = async predicate => {
      const end = Date.now() + 240000;
      do {
        const paper = read();
        if (predicate(paper)) return paper;
        await new Promise(resolve => setTimeout(resolve, 160));
      } while (Date.now() < end);
      throw Error('The reader did not persist the expected translations.');
    };
    await page.getByRole('button', { name: 'Choose translation range', exact: true }).click();
    await page.getByRole('button', { name: /^All unfinished blocks/ }).click();
    const paragraphPaper = await waitForSave(p => p.blocks.every(b => b.status === 'ok' || b.status === 'failed'));
    const readerRequests = await app.evaluate(() => global.plosRequests);
    await openWorkspaceView(page, 'Full Translation');
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    const saved = await waitForSave(p => p.connectedTranslation && p.connectedBlocks?.length);
    const active = (await (await fetch(base + '/api/ps')).json()).models.find(m => m.name === model);
    const report = { application: await page.evaluate(async () => (await window.paperBridge.bootstrap()).version),
      model, digest: weights.digest, version, vram: active?.size_vram, readerRequests: readerRequests.length,
      paragraphs: paragraphPaper.blocks.map((b, i) => ({ articleID: samples[i].id, source: b.text, translation: b.translation, status: b.status })),
      connected: saved.connectedTranslation, batches: saved.connectedBlocks.length,
      failedBatches: saved.connectedBlocks.filter(b => b.status === 'failed').length };
    const output = path.join(workspace, 'translation.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    assert.ok(report.vram > 0);
    assert.ok(report.paragraphs.every(b => b.status === 'ok' && /\p{Script=Han}/u.test(b.translation)));
    assert.equal(report.readerRequests, 4, 'The third paragraph crosses the 500-character boundary');
    console.log(JSON.stringify({ file: output, readerRequests: report.readerRequests, batches: report.batches, failedBatches: report.failedBatches, vram: report.vram }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
