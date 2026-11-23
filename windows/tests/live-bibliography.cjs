// Opt-in AMD/GPU validation using a saved PDF text layer and the installed Ollama model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { observeLocalOllama } = require('./observe-local-ollama.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const work = fs.mkdtempSync(path.join(artifacts, 'live-reference-list-')), id = '9'.repeat(64);
  const refs = require('./mac-parity/good-enough/reader.json').blocks.at(-1).text;
  const opening = 'The laboratory measured the temperature of the control sample.';
  const closing = 'The sensor recorded the same temperature during the second measurement.';
  const oldDraft = 'Saved translation from the earlier Windows version.';
  const blocks = [opening, 'References ' + refs, 'Appendix', closing].map((text, index) => ({ id: index + 1, text }));
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const base = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  const observation = await observeLocalOllama(base);
  const settings = { ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false,
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', aiProvider: 'ollama', ollamaBaseURL: observation.url, translationModel: model };
  fs.mkdirSync(path.join(work, 'papers'));
  const file = path.join(work, 'papers', id + '.json');
  fs.writeFileSync(file, JSON.stringify({ id, name: 'PLOS reference notes', type: 'text', sourceMode: 'text', blocks,
    connectedTranslation: oldDraft, connectedContentsChecked: true, position: { tab: 'Full Translation', block: 1 } }));
  fs.writeFileSync(path.join(work, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(work, 'settings.json'), JSON.stringify(settings));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(work, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: work } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Full Translation');
    await page.getByText(oldDraft, { exact: true }).waitFor();
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    const until = Date.now() + 90000;
    let saved;
    do {
      saved = read();
      if (saved.connectedReferenceCoverageVersion >= 2 && !saved.connectedStale &&
          saved.connectedBlocks?.every(batch => batch.status === 'ok') && saved.connectedTranslation?.includes(refs)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < until);
    const prompts = observation.calls.map(call => call.prompt);
    assert.ok(prompts.some(prompt => prompt.includes(opening)) && prompts.some(prompt => prompt.includes(closing)));
    assert.ok(prompts.every(prompt => !prompt.includes('Best Practices for Scientific Computing.') && !prompt.includes('Code Review For and By Scientists.')));
    assert.ok(saved.connectedTranslation.includes(refs) && /[\u3400-\u9fff]/u.test(saved.connectedTranslation));
    const active = (await (await fetch(base + '/api/ps')).json()).models.find(item => item.name === model || item.model === model);
    assert.ok(active?.size_vram > 0);
    const destination = path.join(work, 'appendix-and-references.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Full Translation Markdown', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    assert.ok(fs.readFileSync(destination, 'utf8').includes(saved.connectedTranslation));
    await app.close(); app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Full Translation');
    await page.getByText(/Code Review For and By Scientists/).first().waitFor();
    assert.equal(read().connectedStale, false);
    console.log(JSON.stringify({ work, model, vram: active.size_vram, requests: prompts.length, citationsPreserved: 20, characters: refs.length,
      openingAndAppendixTranslated: true, exported: true, reopened: true }));
  } finally { await app.close(); await observation.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
