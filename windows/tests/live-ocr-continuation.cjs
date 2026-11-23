// Opt-in: import an image-only scan of BERT's printed pages 6–7 with a real MinerU 4.x environment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { findPaperMineruMarkdown } = require('../electron/mineru-resources.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), scan = path.resolve(process.argv[2]);
  const previous = process.env.PAPERBRIDGE_PREVIOUS_EXECUTABLE, current = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'), id = digest(scan);
  const dir = fs.mkdtempSync(path.join(root, 'test-artifacts', 'ocr-continuation-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, pdfExtractionMode: 'mineruOnly', mineruExecutable: process.env.PAPERBRIDGE_LIVE_MINERU }));
  const launch = executablePath => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  const assets = markdown => {
    const base = path.dirname(markdown);
    return Object.fromEntries(fs.readdirSync(base, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
      .map(entry => { const file = path.join(entry.parentPath, entry.name); return [path.relative(base, file), digest(file)]; }));
  };
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'papers', id + '.json'), 'utf8'));
  let app = await launch(previous || current);
  try {
    let page = await app.firstWindow();
    const runtime = await page.evaluate(async () => {
      const { settings } = await window.paperBridge.bootstrap();
      return (await window.paperBridge.mineruStatus(settings.mineruExecutable)).runtime;
    });
    assert.equal(runtime.directml, true);
    await app.evaluate(({ dialog }, scan) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scan] }); }, scan);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id && !document.querySelector('.task-progress'), id, { timeout: 180000 });
    await openWorkspaceView(page, 'Reader');
    const initial = read(), matched = initial.blocks.find(b => b.text.includes('Without TriviaQA') && b.text.includes('0.1-0.4 F1'));
    assert.ok(matched && !initial.pdfBlocks?.length);
    if (previous) assert.ok(!matched.page && !matched.endPage);
    else assert.deepEqual([matched.page, matched.endPage], [1, 2]);
    const originalFiles = assets(findPaperMineruMarkdown(dir, initial));
    assert.equal(Object.keys(originalFiles).filter(file => file.toLowerCase().endsWith('.jpg')).length, 4);
    const row = page.locator('#block-' + matched.id);
    await row.locator('button[title^="Bookmark"]').click();
    await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    const output = row.locator('.translation-text.done');
    await output.waitFor({ timeout: 150000 });
    const translation = await output.innerText();
    for (const term of ['TriviaQA', '0.1', '0.4']) assert.ok(translation.includes(term), translation);
    await app.close(); app = await launch(current); page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-' + matched.id + ' .translation-text.done').getByText(translation, { exact: true }).waitFor();
    await page.waitForFunction(async id => {
      const paper = await window.paperBridge.loadPaper(id);
      return paper.mineruPageMapVersion >= 2 && paper.blocks.some(b => b.endPage === 2 && b.text.includes('Without TriviaQA'));
    }, id);
    const saved = read(), restored = saved.blocks.find(b => b.id === matched.id);
    assert.deepEqual([restored.page, restored.endPage, restored.text, restored.translation, restored.bookmark], [1, 2, matched.text, translation, true]);
    assert.deepEqual(assets(findPaperMineruMarkdown(dir, saved)), originalFiles);
    assert.equal(saved.mineruResourceId, initial.mineruResourceId);
    assert.equal(digest(path.join(dir, 'pdfs', id + '.pdf')), id);
    console.log(JSON.stringify({ dir, parser: runtime.description, previousPage: matched.page, restoredPages: [restored.page, restored.endPage],
      translation, images: 4, files: Object.keys(originalFiles).length, savedBlocks: saved.blocks.length, source: id }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
