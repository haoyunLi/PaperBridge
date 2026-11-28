// Opt-in device test for a selectable first page, a scanned second page and a blank final page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { mineruPython } = require('../electron/mineru-discovery.cjs');
const { selectText } = require('./select-passage.cjs');
const { longFacsimile } = require('./mac-parity/long-facsimile.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'mixed-ocr-'));
  const name = 'Mixed laboratory notebook.pdf';
  const file = path.join(dir, name);
  const first = path.join(dir, 'Selectable notebook.pdf');
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, pdfExtractionMode: 'mineruPreferred', mineruBackend: 'auto',
    mineruExecutable: process.env.PAPERBRIDGE_LIVE_MINERU || '' }));
  const launch = () => electron.launch({ cwd: root, executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  console.log('Workspace: ' + dir);
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const detected = await page.evaluate(async () => {
      const { settings } = await window.paperBridge.bootstrap();
      return window.paperBridge.mineruStatus(settings.mineruExecutable, settings.mineruBackend);
    });
    assert.ok(detected.compatible, detected.reason);
    if (process.env.PAPERBRIDGE_LIVE_DIRECTML === '1') assert.equal(detected.runtime?.directml, true);
    fs.writeFileSync(first, longFacsimile());
    execFileSync(await mineruPython(detected.executable), [path.join(__dirname, 'make-scanned-pdf.py'), file, first]);
    const id = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'papers', id + '.json'), 'utf8'));
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, file);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id && !document.querySelector('.task-progress'), id, { timeout: 240000 });
    const paper = stored();
    const scanned = paper.blocks.find(block => /Researchers measured/i.test(block.text));
    assert.ok(scanned && scanned.page === 2, JSON.stringify(paper.blocks.map(({ page, text }) => [page, text.slice(0, 80)])));
    assert.deepEqual([...new Set(paper.pdfBlocks.map(block => block.page))], [1]);
    await openWorkspaceView(page, 'Original');
    const toolbar = page.locator('.pdf-toolbar');
    const notice = page.locator('.scan-notice');
    await toolbar.getByText('Exact original PDF · page 1 of 3').waitFor();
    await page.locator('[data-pdf-page="1"] .textLayer span').first().waitFor();
    assert.equal(await notice.count(), 0);
    await toolbar.getByRole('button', { name: 'Next page' }).click();
    await toolbar.getByText('Exact original PDF · page 2 of 3').waitFor();
    await notice.getByRole('button', { name: 'Open OCR Reader' }).click();
    await page.waitForFunction(() => document.querySelector('.block.current .reader-block-page')?.textContent.includes('2'));
    const row = page.locator('#block-' + scanned.id);
    await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    const output = row.locator('.translation-text.done');
    await output.waitFor({ timeout: 150000 });
    const translation = await output.innerText();
    assert.match(translation, /陶瓷/);
    await page.getByRole('button', { name: 'Back to previous reading location' }).click();
    await toolbar.getByText('Exact original PDF · page 2 of 3').waitFor();
    await toolbar.getByRole('button', { name: 'Next page' }).click();
    await toolbar.getByText('Exact original PDF · page 3 of 3').waitFor();
    await notice.waitFor();
    console.log(JSON.stringify({ hardware: detected.runtime?.description, sourcePages: paper.pdfBlocks.map(b => b.page),
      ocrPages: paper.blocks.map(b => b.page), translation, lastPageNotice: await notice.innerText() }));
    await notice.getByText('MinerU found no readable text on this page.').waitFor();
    assert.equal(await notice.getByRole('button', { name: 'Open OCR Reader' }).count(), 0);
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await page.locator('.pdf-toolbar').getByText('Exact original PDF · page 3 of 3').waitFor();
    await page.locator('.scan-notice').getByRole('button', { name: 'Open Reader', exact: true }).click();
    await page.locator('#block-' + scanned.id + ' .translation-text.done').getByText(translation, { exact: true }).waitFor();
    const hideInspector = page.getByRole('button', { name: /^(Hide inspector|Close inspector drawer)$/ });
    if (await hideInspector.isVisible()) await hideInspector.click();
    const translatedSelector = '#block-' + scanned.id + ' .translation-text';
    await page.locator(translatedSelector).scrollIntoViewIfNeeded();
    await selectText(page, translatedSelector, '磁场');
    const quick = page.getByRole('dialog', { name: 'Quick selection' });
    await quick.getByRole('button', { name: 'Translate', exact: true }).click();
    const result = quick.locator('.inspector-result.translate p');
    await result.waitFor({ timeout: 90000 });
    const reverse = await result.innerText();
    assert.match(reverse, /magnetic field/i);
    await page.keyboard.press('Escape');
    await quick.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Show Research Inspector', exact: true }).click();
    const inspector = page.locator('.inspector');
    assert.deepEqual(await inspector.locator('blockquote').allTextContents(), ['磁场'], 'Esc must retain the paper selection for the inspector.');
    assert.equal(await inspector.locator('.inspector-result.translate p').innerText(), reverse);
    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    await page.getByRole('dialog', { name: 'Saved Terminology' }).waitFor();
    await page.keyboard.press('Escape');
    assert.deepEqual(await inspector.locator('blockquote').allTextContents(), ['磁场'], 'Closing terminology must preserve the active passage.');
    console.log(JSON.stringify({ reverseSelection: '磁场', reverse, selectionAfterEscape: true }));
    assert.deepEqual(fs.readFileSync(path.join(dir, 'pdfs', id + '.pdf')), fs.readFileSync(file));
    console.log('Blank-page guidance, reading history, original bytes and saved translation verified after restart.');
  } catch (error) {
    const window = app.windows()[0];
    if (window) console.error(await window.locator('.selection-toolbar, .inspector:visible, [role="alert"]').allInnerTexts().catch(() => []));
    throw error;
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

