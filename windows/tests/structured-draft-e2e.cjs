const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'structured-draft-'));
  const pdf = fs.readFileSync(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'));
  const id = crypto.createHash('sha256').update(pdf).digest('hex');
  const source = '## Signals\n\n1. Calibrate the sensor.\n\n> Keep the probe dry.';
  const plain = ['信号', '校准传感器。', '保持探针干燥。\n记录温度。'];
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const pair = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const blocks = parsedMarkdownBlocks(source).map((block, index) => {
    // This saved record predates per-block kind and translated Markdown metadata.
    const { markdownKind, ...older } = block;
    return { ...older, translation: plain[index], status: 'ok', translationLanguage: pair };
  });
  blocks[2].bookmark = true;
  blocks[2].notes = [{ id: 'probe-note', text: 'probe', kind: 'source', body: 'Check this probe.', offset: 9 }];
  const paper = { id, name: 'Saved sensor study', type: 'pdf', blocks, sourceMode: 'mineru', mineruBlocks: blocks,
    mineruMarkdown: source, connectedTranslation: plain.join('\n\n'), connectedShared: true, connectedStale: false,
    connectedLanguage: pair, position: { tab: 'Full Translation', block: 1, displayMode: 'bilingual' },
    updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  for (const sub of ['papers', 'pdfs']) fs.mkdirSync(path.join(dir, sub));
  const json = path.join(dir, 'papers', id + '.json');
  fs.writeFileSync(json, JSON.stringify(paper));
  fs.writeFileSync(path.join(dir, 'pdfs', id + '.pdf'), pdf);
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, ...pair,
    onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));

  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const open = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await open();
  try {
    for (let pass = 0; pass < 2; pass++) {
      const page = await app.firstWindow();
      await openWorkspaceView(page, 'Full Translation');
      const draft = page.locator('[data-view-scope="fullTranslation"]');
      await draft.getByText('校准传感器。', { exact: false }).first().waitFor();
      assert.deepEqual(await draft.locator('h2').allTextContents(), ['信号']);
      assert.deepEqual(await draft.locator('ol li').allTextContents(), [plain[1]]);
      assert.equal((await draft.locator('blockquote').innerText()).replace(/\s/g, ''), plain[2].replace(/\s/g, ''));
      if (pass === 0) {
        await openWorkspaceView(page, 'Reader');
        await page.locator('#block-3 .translation-text blockquote').waitFor();
        await app.close();
        app = await open();
      }
    }
    const saved = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.deepEqual(saved.blocks.map(block => block.translation), plain);
    assert.deepEqual(saved.blocks[2].notes, blocks[2].notes);
    assert.equal(saved.blocks[2].bookmark, true);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'pdfs', id + '.pdf')), pdf);
    console.log('Reopened the offline shared draft with its heading, numbered list, quotation and saved annotation.');
  } finally {
    await app?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
