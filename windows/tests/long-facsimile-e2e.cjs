const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const { selectText } = require('./select-passage.cjs');
const { longFacsimile } = require('./mac-parity/long-facsimile.cjs');

async function checkContrast(page, selector, quick, colors, scheme) {
  const line = page.locator(selector).getByText('Observation 1 in the printed notebook.', { exact: true });
  const layer = page.locator(selector);
  await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme });
  try {
    await line.scrollIntoViewIfNeeded();
    const bounds = await line.boundingBox();
    const clip = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
    const snapshot = () => page.screenshot({ clip });
    const unmarked = await snapshot();
    await layer.evaluate(element => { element.style.visibility = 'hidden'; });
    let printed;
    try { printed = await snapshot(); }
    finally { await layer.evaluate(element => { element.style.visibility = ''; }); }
    assert.ok(unmarked.equals(printed), 'Searchable PDF text must not print a second set of glyphs in Windows contrast themes');
    await selectText(page, selector, 'Observation 1');
    await quick.waitFor();
    assert.deepEqual(await quick.locator('.highlight').allInnerTexts(), colors);
    assert.ok(!(await snapshot()).equals(printed), 'The active selection remains visible over the printed page');
    for (const [index, color] of colors.entries()) {
      const button = quick.getByRole('button', { name: color + ' highlight', exact: true });
      await button.click();
      await page.waitForFunction(color => document.querySelector('.selection-toolbar button[aria-pressed="true"]')?.textContent === color, color);
      const key = ['amber', 'teal', 'coral'][index];
      const underline = await line.evaluate((el, key) => getComputedStyle(el, '::highlight(paperbridge-' + key + ')').textDecorationStyle, key);
      assert.equal(underline, ['solid', 'double', 'dotted'][index]);
    }
    await page.evaluate(() => window.getSelection().removeAllRanges());
    assert.ok(!(await snapshot()).equals(printed), 'A saved highlight remains visible after the native selection is cleared');
    await quick.getByRole('button', { name: 'Remove Highlight', exact: true }).click();
    await page.waitForFunction(() => !CSS.highlights.has('paperbridge-coral'));
    await page.keyboard.press('Escape');
    assert.ok((await snapshot()).equals(printed), 'Removing the last highlight restores the original PDF pixels');
  } finally {
    await page.emulateMedia({ forcedColors: 'none', colorScheme: null });
  }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'long-facsimile-'));
  console.log('Workspace: ' + dir);
  const filename = path.join(dir, 'Long notebook.pdf');
  const original = longFacsimile();
  fs.writeFileSync(filename, original);
  const live = process.argv.includes('--translate-last');
  const ollamaBaseURL = live ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:9';
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1,
    pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, ollamaBaseURL }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const open = () => electron.launch({ cwd: root, executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  const lastText = 'Observation 125 in the printed notebook.';
  const digest = createHash('sha256').update(original).digest('hex');
  let app = await open();
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, filename);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id &&
      !document.querySelector('.task-progress'), digest, { timeout: 120000 });
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'papers', digest + '.json'), 'utf8'));
    const observations = stored.blocks.flatMap(block => [...block.text.matchAll(/Observation (\d+) in the printed notebook\./g)].map(match => Number(match[1])));
    assert.deepEqual(observations, Array.from({ length: 125 }, (_, i) => i + 1), 'All printed observations must reach Reader and translation');
    console.log('Imported 125 pages and 125 numbered observations.');
    await page.getByLabel('Paper display mode').selectOption('source');
    const scroll = page.getByLabel('Continuous original PDF');
    const hideInspector = page.getByRole('button', { name: /^(Hide inspector|Close inspector drawer)$/ });
    if (await hideInspector.isVisible()) await hideInspector.click();
    const quick = page.getByRole('dialog', { name: 'Quick selection' });
    const native = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
    const colors = native?.publishedPaper.annotationUndo.highlightColors || ['Amber', 'Cobalt', 'Coral'];
    for (const view of ['Original', 'Paper']) {
      await openWorkspaceView(page, view);
      await scroll.focus();
      await page.keyboard.press('Control+Home');
      const firstLine = '.textLayer[data-page="1"]';
      await page.locator(firstLine).getByText('Observation 1 in the printed notebook.', { exact: true }).waitFor();
      await checkContrast(page, firstLine, quick, colors, view === 'Original' ? 'light' : 'dark');
      await selectText(page, firstLine, 'Observation 1');
      await quick.waitFor({ timeout: 5000 });
      await scroll.evaluate(host => { host.scrollTop += 20; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await quick.isVisible(), true, view + ' must keep lookup open while the passage is on screen.');
      await scroll.evaluate(host => { host.scrollTop += 2 * host.clientHeight; });
      await quick.waitFor({ state: 'hidden', timeout: 5000 });
    }
    console.log('Original and Paper PDF lookup survive a small scroll, and dismiss when the passage leaves the viewport.');
    await scroll.focus();
    await page.keyboard.press('Control+End');
    const finalPage = () => page.locator('.textLayer[data-page="125"]').getByText(lastText, { exact: true }).waitFor({ timeout: 10000 });
    await finalPage();
    await page.locator('.pdf-toolbar').getByText('Exact original PDF · page 125 of 125').waitFor();
    await app.close();
    app = await open();
    page = await app.firstWindow();
    await finalPage();
    await page.getByText('Exact original PDF · page 125 of 125', { exact: true }).waitFor();
    console.log('Reopened the last printed page.');
    let inference;
    if (live) {
      await openWorkspaceView(page, 'Reader');
      await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Bilingual', exact: true }).check();
      const lastBlock = stored.blocks.find(block => block.text === lastText);
      assert.ok(lastBlock);
      const block = () => page.locator('#block-' + lastBlock.id);
      await block().getByRole('button', { name: 'Paragraph actions' }).click();
      const start = Date.now();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      await block().locator('.translation-text.done').waitFor({ timeout: 120000 });
      const translation = (await block().locator('.translation-text.done').innerText()).trim();
      const elapsedMs = Date.now() - start;
      assert.match(translation, /125/);
      assert.match(translation, /[\u4e00-\u9fff]/);
      const stats = await (await fetch(ollamaBaseURL + '/api/ps')).json();
      const model = stats.models.find(model => model.name === 'translategemma:4b');
      assert.ok(model?.size_vram > 0);
      inference = { translation, elapsedMs, vramBytes: model.size_vram };
      await app.close();
      app = await open();
      page = await app.firstWindow();
      assert.equal((await block().locator('.translation-text.done').innerText()).trim(), translation);
    }
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = () => {};
    }, dir);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await page.getByText(/Exported .*original PDF to /).waitFor({ timeout: 90000 });
    const folder = path.join(dir, 'Long notebook_PaperBridge');
    assert.deepEqual(fs.readFileSync(path.join(folder, 'original.pdf')), original);
    const images = fs.readdirSync(path.join(folder, 'pages')).sort();
    assert.equal(images.length, 120);
    assert.equal(images.at(-1), 'page-120.png');
    for (const file of [images[0], images.at(-1)]) {
      const png = fs.readFileSync(path.join(folder, 'pages', file));
      assert.equal(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)), 1800);
    }
    const editions = ['Original Pages.md', ...fs.readdirSync(folder).filter(name => /^paper_(?:original|translation|bilingual)(?:_[\w-]+)?\.md$/.test(name))];
    assert.equal(editions.length, 4);
    for (const edition of editions) {
      const data = fs.readFileSync(path.join(folder, edition), 'utf8');
      const headings = [...data.matchAll(/^## Page (\d+)$/gm)].map(match => Number(match[1]));
      assert.deepEqual(headings, Array.from({ length: 125 }, (_, i) => i + 1), edition);
      assert.equal([...data.matchAll(/!\[Original PDF page (\d+)\]/g)].length, 120);
      for (let number = 121; number <= 125; number++) assert.ok(data.includes('(original.pdf#page=' + number + ')'), edition + ' page ' + number);
    }
    if (inference) {
      const translated = editions.find(edition => edition.startsWith('paper_translation'));
      assert.ok(fs.readFileSync(path.join(folder, translated), 'utf8').includes(inference.translation));
    }
    if (native) {
      const { readerObservations, ...archive } = native.longFacsimile;
      assert.deepEqual(archive, { sha256: digest, total: 125, rendered: 120, omitted: 5, headings: 125, lastText });
      console.log('Numbered observations in selectable text: macOS ' + readerObservations + ', Windows ' + observations.length + '.');
    }
    console.log(JSON.stringify({ dir, editions, pages: 125, previews: 120, restored: 125, sha256: digest, inference }));
  } finally { if (app) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
