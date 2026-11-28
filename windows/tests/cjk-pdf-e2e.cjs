const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView, revealSidebarSource } = require('./sidebar-controls.cjs');
const rows = require('./mac-parity/cjk-calibration.json');

const compact = text => text.normalize('NFC').replace(/\s+/gu, '');

async function setLanguages(page, source) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  const settings = page.locator('.settings-panel');
  await settings.getByLabel('Source language').selectOption(source);
  await settings.getByLabel('Target language').selectOption('English');
  await page.locator('.modal-head .icon-button').click();
}

async function verifyExport(app, page, dir, original) {
  await app.evaluate(({ dialog, shell }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    shell.showItemInFolder = () => {};
  }, dir);
  await page.getByRole('button', { name: 'More ···', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
  await page.getByText(/Exported .*original PDF to /).waitFor({ timeout: 90000 });
  const folder = path.join(dir, 'cjk-calibration_PaperBridge');
  assert.deepEqual(fs.readFileSync(path.join(folder, 'original.pdf')), original);
  const pages = path.join(folder, 'pages');
  const images = fs.readdirSync(pages).sort();
  assert.equal(images.length, rows.length);
  for (const file of images) {
    const lines = await app.evaluate(({ nativeImage }, file) => {
      const png = nativeImage.createFromPath(file);
      const { width, height } = png.getSize();
      const bytes = png.toBitmap();
      return [[0.13, 0.23], [0.29, 0.39], [0.41, 0.50]].map(([top, bottom]) => {
        let ink = 0;
        for (let i = width * Math.floor(top * height) * 4; i < width * Math.floor(bottom * height) * 4; i += 4) {
          if (bytes[i] < 160 && bytes[i + 3] > 230) ink++;
        }
        return ink;
      });
    }, path.join(pages, file));
    assert.ok(lines.every(count => count > 100), file + ' must print its title and both observations: ' + lines);
  }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'cjk-calibration-'));
  const file = path.join(__dirname, 'mac-parity', 'cjk-calibration.pdf');
  const bytes = fs.readFileSync(file);
  const id = createHash('sha256').update(bytes).digest('hex');
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).cjkCalibration;
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) assert.equal(id, reference?.sha256);
  const live = process.argv.includes('--live-translation');
  const legacy = process.argv.includes('--legacy') || process.argv.includes('--reimport');
  const existingNote = { id: 'saved-note', scope: 'pdf', page: 1, offset: 0, text: rows[0].title, body: 'Keep the paper calibration note' };
  if (legacy) {
    const store = createStore(dir);
    fs.mkdirSync(path.dirname(store.pdfPath(id)), { recursive: true });
    fs.writeFileSync(store.pdfPath(id), bytes);
    const source = process.env.PAPERBRIDGE_TEST_LEGACY_CJK;
    const old = source ? JSON.parse(fs.readFileSync(source, 'utf8')) : { id, name: path.basename(file), type: 'pdf',
      sourceMode: 'pdf', extraction: 'PDF.js', blocks: [], pdfBlocks: [], position: { tab: 'Paper', page: 1, block: 1 },
      extractionWarning: 'No selectable text found. The exact original PDF is available. Use MinerU for OCR.' };
    assert.ok(old.id === id && old.blocks.length === 0 && !old.pdfTextVersion);
    if (source) {
      const oldCache = path.join(path.dirname(path.dirname(source)), 'pdf-page-cache');
      if (fs.existsSync(oldCache)) fs.cpSync(oldCache, path.join(dir, 'pdf-page-cache'), { recursive: true });
    }
    const taskSettings = { ...defaults, ...old.taskSettings, ollamaBaseURL: live ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:9' };
    store.savePaper({ ...old, taskSettings, pdfNotes: [existingNote], tags: ['calibration'] });
    store.markPaperOpened(id);
  }
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, pdfExtractionMode: 'pdfOnly', sourceLanguage: 'Simplified Chinese', targetLanguage: 'English',
    ollamaBaseURL: live ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:9' }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, executablePath: exe, args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  const paper = () => JSON.parse(fs.readFileSync(path.join(dir, 'papers', id + '.json'), 'utf8'));
  let app = await launch();
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const urls = [], warnings = [];
    page.on('request', request => urls.push(request.url()));
    page.on('console', msg => { if (/cmap|font data|standardFontDataUrl/i.test(msg.text())) warnings.push(msg.text()); });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    const repair = page.getByRole('button', { name: 'Check saved PDF text' });
    if (legacy) await repair.waitFor();
    if (legacy && !process.argv.includes('--reimport')) await repair.click();
    else {
      await revealSidebarSource(page);
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    }
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id && !document.querySelector('.task-progress'), id);
    if (legacy) {
      await repair.waitFor({ state: 'detached' });
      await page.locator('.save-status.saved').waitFor();
      assert.deepEqual(paper().pdfNotes, [existingNote]);
      assert.deepEqual(paper().tags, ['calibration']);
      assert.doesNotMatch(paper().extractionWarning, /No selectable text found/);
    }
    const blocks = paper().blocks;
    console.log(JSON.stringify({ dir, extracted: blocks.map(block => [block.page, block.text]), warnings }));
    assert.ok(blocks.length >= rows.length, 'All three writing systems must yield selectable text without OCR');
    await openWorkspaceView(page, 'Original');
    for (const [index, row] of rows.entries()) {
      if (index) await page.locator('.pdf-toolbar').getByRole('button', { name: 'Next page', exact: true }).click();
      const number = index + 1;
      await page.locator('.pdf-toolbar').getByText('Exact original PDF · page ' + number + ' of 3').waitFor();
      const slot = page.locator('[data-pdf-page="' + number + '"]');
      const layer = slot.locator('.textLayer[data-page="' + number + '"]');
      await layer.waitFor();
      const original = compact(await layer.textContent());
      const body = compact(blocks.filter(block => block.page === number).map(block => block.text).join(''));
      const lines = [row.title, row.source, row.control];
      assert.deepEqual(blocks.filter(block => block.page === number).map(block => block.text), lines);
      if (reference) assert.deepEqual(lines, reference.pages[index].split('\n'), 'Original PDFKit text and Windows Reader match');
      for (const text of lines) {
        assert.ok(original.includes(compact(text)), row.language + ' original PDF: ' + text);
        assert.ok(body.includes(compact(text)), row.language + ' Reader: ' + text);
      }
      assert.equal(await page.locator('.scan-notice').count(), 0);
      const png = await slot.locator('canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
      fs.writeFileSync(path.join(dir, 'page-' + number + '.png'), Buffer.from(png, 'base64'));
    }
    const nativeParagraphs = reference?.reader.split(/\n\s*\n/).filter(Boolean);
    for (const text of nativeParagraphs || []) assert.ok(blocks.some(block => block.text === text));
    assert.deepEqual(warnings, []);
    const external = urls.filter(url => /^https?:/i.test(url) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(url));
    assert.deepEqual(external, [], 'The document must open without an external font service');
    const translations = [];
    if (live) {
      await openWorkspaceView(page, 'Reader');
      for (const row of rows) {
        await setLanguages(page, row.language);
        const source = blocks.find(block => compact(block.text).includes(compact(row.source)));
        const block = page.locator('#block-' + source.id);
        await block.getByRole('button', { name: 'Paragraph actions' }).click();
        await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
        const output = block.locator('.translation-text.done');
        await output.waitFor({ timeout: 150000 });
        const translation = await output.innerText();
        assert.match(translation, new RegExp(String(row.wavelength) + '\\s*(?:nm|nanomet)', 'i'));
        assert.match(translation, /peak/i);
        translations.push({ language: row.language, block: source.id, translation });
      }
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('heading', { name: path.basename(file), exact: true }).waitFor();
    assert.deepEqual(fs.readFileSync(path.join(dir, 'pdfs', id + '.pdf')), bytes);
    if (live) {
      await openWorkspaceView(page, 'Reader');
      for (const item of [...translations].reverse()) {
        await setLanguages(page, item.language);
        const saved = page.locator('#block-' + item.block + ' .translation-text.done');
        await saved.waitFor();
        assert.equal(await saved.innerText(), item.translation);
      }
    }
    await verifyExport(app, page, dir, bytes);
    console.log(JSON.stringify({ verifiedPages: rows.length, exportedImages: rows.length, legacy, nativeReaderParagraphs: nativeParagraphs?.length, windowsReaderParagraphs: blocks.length, mac: Boolean(reference), translations, originalRestored: true }));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
