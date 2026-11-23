const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

// Feed a saved extraction into the real PDF import path. Only the parser output is controlled.
async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'equation-prose-'));
  const pdf = fs.readFileSync(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'));
  const id = createHash('sha256').update(pdf).digest('hex');
  const equation = '$$\nz = x + y\n$$', other = '\\[r=2\\]';
  const first = 'The control sample reached equilibrium.';
  const second = 'The optical sensor measured the temperature.';
  const third = 'The red indicator became brighter.';
  const orphan = '$$\nv = \\frac{a}{b}';
  const markdown = [equation + ' ' + first, other + ' ' + second, orphan, third].join('\n\n');
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const base = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults,
    onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'mineruOnly',
    aiProvider: 'ollama', ollamaBaseURL: base, translationModel: model, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ ipcMain }, source) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, version: '4.1.7', executable: 'test-parser' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => ({ markdown: source, pageHints: [] }));
    }, markdown);
    await page.evaluate(encoded => {
      const files = new DataTransfer();
      files.items.add(new File([Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))], 'study.pdf', { type: 'application/pdf' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: files }));
    }, pdf.toString('base64'));
    const status = page.getByText(/Extracted \d+ blocks from \d+ pages|Could not import study\.pdf:/);
    await status.first().waitFor();
    assert.match(await status.first().textContent(), /Extracted 6 blocks/, 'Each of three prose passages must survive the import');
    await openWorkspaceView(page, 'Reader');
    const saved = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    assert.equal(saved.mineruMarkdown, markdown);
    assert.deepEqual(saved.blocks.map(b => b.sourceMarkdown), [equation, first, other, second, orphan, third]);
    assert.deepEqual(saved.blocks.map(b => b.resource), [true, false, true, false, true, false]);
    const math = page.locator('.block .source-text .katex annotation');
    assert.deepEqual(await math.allTextContents(), ['z = x + y', 'r=2']);
    const report = { workspace, paragraphs: 3, typeset: 2 };
    if (process.argv.includes('--live')) {
      await app.evaluate(() => {
        const original = global.fetch;
        global.equationPrompts = [];
        global.fetch = (url, options) => {
          if (new URL(url).pathname === '/api/generate' && options?.body) global.equationPrompts.push(JSON.parse(options.body).prompt);
          return original(url, options);
        };
      });
      await openWorkspaceView(page, 'Full Translation');
      await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
      await page.getByText(/^Structure-preserving full translation saved\./).waitFor({ timeout: 180000 });
      const translated = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
      const prompts = await app.evaluate(() => global.equationPrompts);
      for (const phrase of [first, second, third]) assert.ok(prompts.some(p => p.includes(phrase)), phrase);
      for (const formula of ['z = x + y', 'r=2', '\\frac{a}{b}']) assert.ok(prompts.every(p => !p.includes(formula)), formula);
      const prose = translated.blocks.filter(b => !b.resource);
      assert.ok(prose.every(b => b.status === 'ok' && /\p{Script=Han}/u.test(b.translationMarkdown)));
      await page.locator('.main-scroll code').filter({ hasText: orphan }).first().waitFor();
      await page.locator('.main-scroll p').filter({ hasText: prose[2].translationMarkdown }).first().waitFor();
      const destination = path.join(workspace, 'translated.md');
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
      await page.getByRole('button', { name: 'Full Translation Markdown', exact: true }).click();
      await page.getByText(/^Exported .*translated\.md$/).waitFor();
      const output = fs.readFileSync(destination, 'utf8');
      assert.ok(output.includes(translated.connectedTranslation));
      for (const item of [equation, other, orphan, ...prose.map(b => b.translationMarkdown)]) assert.ok(output.includes(item));
      const active = (await (await fetch(base + '/api/ps')).json()).models.find(item => item.name === model || item.model === model);
      assert.ok(active?.size_vram > 0);
      Object.assign(report, { requests: prompts.length, model, vram: active.size_vram, exported: true, translations: prose.map(b => b.translationMarkdown) });
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-6 .source-text').filter({ hasText: third }).waitFor();
    if (report.exported) await page.locator('#block-6 .translation-text').filter({ hasText: report.translations[2] }).waitFor();
    console.log(JSON.stringify({ ...report, reopened: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
