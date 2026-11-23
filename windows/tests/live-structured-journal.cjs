// Opt-in device comparison with the Mac reader's local structured translation.
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
  const dir = fs.mkdtempSync(path.join(artifacts, 'structured-device-'));
  const markdown = fs.readFileSync(path.join(__dirname, 'mac-parity/tabbed/article.md'), 'utf8').replaceAll('\r\n', '\n');
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown), id = createHash('sha256').update(markdown).digest('hex');
  const targets = [16, 27, 30, 32], file = path.join(dir, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ id, name: 'Tabbed', type: 'text', sourceMode: 'mineru', mineruMarkdown: markdown,
    blocks, mineruBlocks: blocks, position: { tab: 'Reader', displayMode: 'bilingual', block: targets[0] } }));
  const legacy = process.env.PAPERBRIDGE_LEGACY_STRUCTURED;
  if (legacy) fs.copyFileSync(path.join(legacy, 'papers', id + '.json'), file);
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false,
    ...(legacy && { ollamaBaseURL: 'http://127.0.0.1:1' }) }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await app.evaluate(() => {
      const original = global.fetch; global.journalRequests = 0;
      global.fetch = async (...args) => {
        if (new URL(args[0]).pathname === '/api/generate') global.journalRequests++;
        return original(...args);
      };
    });
    if (legacy) {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      const code = previous.blocks.find(b => b.id === 30);
      assert.notEqual(code.translationMarkdown, code.sourceMarkdown);
      const row = page.locator('#block-30');
      await row.getByRole('button', { name: 'Paragraph actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      await row.locator('.translation-text.done').getByText('from', { exact: true }).waitFor();
      await app.close(); app = await launch(); page = await app.firstWindow(); await openWorkspaceView(page, 'Reader');
      const restored = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
      assert.equal(restored.blocks.find(b => b.id === 30).translationMarkdown, code.sourceMarkdown);
      for (const i of targets.filter(i => i !== 30)) {
        assert.equal(restored.blocks.find(b => b.id === i).translationMarkdown, previous.blocks.find(b => b.id === i).translationMarkdown);
      }
      console.log(JSON.stringify({ dir, offlineRetry: true, previous: code.translationMarkdown, corrected: code.sourceMarkdown }));
      return;
    }
    const records = [];
    for (const blockID of targets) {
      const row = page.locator('#block-' + blockID);
      const before = await app.evaluate(() => global.journalRequests);
      let result, attempts = 0;
      while (attempts < 2) {
        const action = attempts === 0 ? /^Translate (?:Paragraph|Heading)$/ : /^(?:Retry|Retry Heading)$/;
        const previousSave = fs.statSync(file).mtimeMs;
        await row.getByRole('button', { name: action }).click();
        attempts++;
        const deadline = Date.now() + 180000;
        for (;;) {
          result = JSON.parse(fs.readFileSync(file, 'utf8')).blocks.find(b => b.id === blockID);
          if (['ok', 'failed'].includes(result.status) && fs.statSync(file).mtimeMs !== previousSave &&
              !await page.locator('.task-progress').count()) break;
          if (Date.now() >= deadline) throw Error('Translation did not finish for block ' + blockID);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (result.status === 'ok') break;
      }
      records.push({ id: blockID, source: result.sourceMarkdown, translation: result.translationMarkdown || result.translation,
        status: result.status, attempts, requests: (await app.evaluate(() => global.journalRequests)) - before });
    }
    const loaded = await (await fetch('http://127.0.0.1:11434/api/ps')).json();
    const vram = loaded.models.find(m => m.name === 'translategemma:4b')?.size_vram;
    console.log(JSON.stringify({ dir, vram, records }));
    assert.ok(vram > 0);
    assert.ok(records.every(r => r.status === 'ok'));
    const [license, prose, code, heading] = records;
    assert.ok(license.translation.includes('(https://creativecommons.org/licenses/by/4.0/)'));
    assert.match(prose.translation, /\p{Script=Han}/u);
    assert.match(heading.translation, /^## .*\p{Script=Han}/u);
    if (!process.argv.includes('--observe')) {
      assert.equal(code.translation, code.source);
      assert.equal(code.requests, 0);
    }
    await app.close(); app = await launch(); page = await app.firstWindow(); await openWorkspaceView(page, 'Reader');
    const restored = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    for (const r of records) assert.equal(restored.blocks.find(b => b.id === r.id).translationMarkdown, r.translation);
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
