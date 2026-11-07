const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');
const { clickTextOffset } = require('./reading-caret.cjs');

function samplePdf(blank = false, variant = '', firstPage = '', rotation = 0) {
  const stream = blank ? '' : firstPage || 'BT /F1 18 Tf 72 720 Td (Abstract) Tj 0 -30 Td /F1 12 Tf (This practice PDF contains selectable academic text for PaperBridge extraction.) Tj 0 -12 Td (It uses attention-) Tj 0 -12 Td (based inference.) Tj 1 0 0 1 72 52 Tm (Page one trailing sentence.) Tj ET';
  const secondStream = blank ? '' : `BT /F1 18 Tf 72 720 Td (Abstract) Tj 0 -30 Td /F1 12 Tf (The second page repeats the heading so annotations must retain their page${variant}.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${rotation ? ` /Rotate ${rotation}` : ''} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return body;
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  if (!path.resolve(artifacts).startsWith(root + path.sep)) throw new Error('Unexpected artifacts path');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = path.join(artifacts, 'workspace');
  if (!path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep)) throw new Error('Unexpected workspace path');
  fs.rmSync(workspace, { recursive: true, force: true });
  let generateDelayMs = 0;
  const generateRequests = [];
  const forcedGenerateResponses = [];
  const progressResponseGates = [];
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b', size_vram: 1_073_741_824, size: 2_000_000_000 }] }));
    if (request.url === '/api/generate') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        try { generateRequests.push(JSON.parse(body)); } catch { generateRequests.push({}); }
        const output = forcedGenerateResponses.length ? forcedGenerateResponses.shift() : '本地测试译文';
        const finish = () => { if (!response.destroyed && !response.writableEnded) response.end(JSON.stringify({ response: output, done: true })); };
        const gate = progressResponseGates.shift();
        if (gate) void gate.then(finish);
        else if (generateDelayMs) setTimeout(finish, generateDelayMs);
        else finish();
      });
      return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  const pdfPath = path.join(artifacts, 'practice.pdf');
  fs.writeFileSync(pdfPath, samplePdf());
  let app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await page.screenshot({ path: path.join(artifacts, 'welcome.png') });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('setup:status');
      ipcMain.handle('setup:status', () => ({
        hardware: { adapters: [{ name: 'Test Radeon', vendor: 'AMD' }] },
        ollama: { installed: false, running: false, models: [] },
        mineru: { installed: false, compatible: false, executable: '', runtime: null },
        plan: { ollama: true, models: ['translategemma:4b'], mineru: true, gpu: { index: null, reason: 'Test AMD CPU parsing plan.' } },
        busy: false
      }));
    });
    await page.getByRole('button', { name: 'Set up local AI' }).click();
    await page.locator('.setup-row').first().waitFor({ timeout: 25000 });
    assert.equal(await page.locator('.setup-row').count(), 3);
    await page.screenshot({ path: path.join(artifacts, 'setup.png') });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('setup:install');
      ipcMain.handle('setup:install', async () => ({ mineruExecutable: '', mineruBackend: 'pipeline', warning: '' }));
    });
    await page.getByRole('button', { name: 'Install missing components' }).click();
    await page.getByText('Installation complete.', { exact: false }).waitFor({ timeout: 25000 });
    await page.locator('.modal-head .icon-button').click();
    await page.getByRole('button', { name: 'Try a Practice Paper' }).first().click();
    await page.locator('button[title="Open library"]').click();
    await page.getByRole('button', { name: /Edit label for Welcome to PaperBridge/ }).click();
    await page.getByLabel('Title').fill('Edited practice label');
    await page.getByLabel('Title').press('Tab');
    await page.getByRole('button', { name: 'Save label' }).click();
    await page.locator('.modal-list-row').getByText('Edited practice label', { exact: true }).waitFor();
    await page.locator('.modal-head .icon-button').click();
    assert.equal(await page.locator('.title-wrap h1').innerText(), 'Welcome to PaperBridge (practice sample)');
    await page.locator('.inspector.inspector-drawer').waitFor();
    const drawerLayout = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const inspector = document.querySelector('.inspector').getBoundingClientRect();
      const body = getComputedStyle(document.querySelector('.inspector-body'));
      return { sidebar: { right: sidebar.right }, workspace: { x: workspace.x, bottom: workspace.bottom }, inspector: { x: inspector.x, y: inspector.y, right: inspector.right, bottom: inspector.bottom, height: inspector.height }, display: body.display, columns: body.gridTemplateColumns };
    });
    assert.ok(Math.abs(drawerLayout.inspector.x - drawerLayout.sidebar.right) < 2 && Math.abs(drawerLayout.inspector.x - drawerLayout.workspace.x) < 2, 'Compact inspector should start after the document sidebar');
    assert.ok(drawerLayout.inspector.y >= drawerLayout.workspace.bottom - 2 && Math.abs(drawerLayout.inspector.bottom - 820) < 2, 'Compact inspector should occupy its own bottom row');
    assert.ok(drawerLayout.inspector.height >= 190 && drawerLayout.inspector.height <= 340 && drawerLayout.display === 'grid' && drawerLayout.columns.split(' ').length === 2, 'Compact inspector should use the Mac-style two-column drawer');
    await page.screenshot({ path: path.join(artifacts, 'inspector-drawer-1320x820.png') });
    await page.setViewportSize({ width: 980, height: 620 });
    await page.locator('.inspector.inspector-drawer').waitFor();
    const smallDrawer = await page.evaluate(() => {
      const drawer = document.querySelector('.inspector').getBoundingClientRect();
      const primary = document.querySelector('.inspector-primary').getBoundingClientRect();
      const supporting = document.querySelector('.inspector-supporting').getBoundingClientRect();
      return { drawer: { bottom: drawer.bottom, height: drawer.height }, primary: { width: primary.width }, supporting: { width: supporting.width } };
    });
    assert.ok(Math.abs(smallDrawer.drawer.bottom - 620) < 2 && Math.abs(smallDrawer.drawer.height - 190) < 2, 'Minimum-height drawer should use the Mac 190px floor');
    assert.ok(smallDrawer.primary.width > 300 && smallDrawer.supporting.width > 300, 'Both inspector columns should remain usable at 980px');
    await page.screenshot({ path: path.join(artifacts, 'inspector-drawer-980x620.png') });
    await page.setViewportSize({ width: 1500, height: 820 });
    await page.locator('.inspector.inspector-sidebar').waitFor();
    const sidebarInspector = await page.locator('.inspector').boundingBox();
    assert.ok(sidebarInspector && sidebarInspector.height > 800 && sidebarInspector.width >= 320 && sidebarInspector.width <= 430, 'Wide windows should restore the right inspector column');
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.inspector.inspector-drawer').waitFor();
    const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label));
    assert.deepEqual(menuLabels, ['File', 'Paper', 'Selection', 'View', 'Help']);
    await page.keyboard.press('Control+1');
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    await page.keyboard.press('Control+f');
    await page.locator('.search:focus').waitFor();
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await page.keyboard.press('Control+Shift+i');
    await page.locator('.inspector').waitFor({ state: 'visible' });
    await page.keyboard.press('Control+Shift+l');
    await page.getByRole('heading', { name: 'Paper Library' }).waitFor();
    await page.locator('.modal-head .icon-button').click();
    await page.keyboard.press('Control+Shift+e');
    await page.getByRole('heading', { name: 'Export Markdown' }).waitFor();
    await page.locator('.modal-head .icon-button').click();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'Paper').submenu.items.find(item => item.label === 'Saved Terminology').click());
    await page.getByRole('heading', { name: 'Saved Terminology' }).waitFor();
    await page.locator('.modal-head .icon-button').click();
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    const firstBlock = Promise.withResolvers();
    const secondBlock = Promise.withResolvers();
    progressResponseGates.push(firstBlock.promise, secondBlock.promise);
    await page.keyboard.press('Control+Enter');
    const taskProgress = page.locator('.task-progress progress[value]');
    await taskProgress.waitFor();
    const taskValues = await taskProgress.evaluate(element => ({ value: element.value, max: element.max }));
    assert.ok(taskValues.max > 1 && taskValues.value < taskValues.max, 'Translation should show determinate progress while running');
    firstBlock.resolve();
    await page.waitForFunction(() => document.querySelector('.task-progress progress')?.value > 0);
    await page.screenshot({ path: path.join(artifacts, 'task-progress.png') });
    secondBlock.resolve();
    await page.getByText('Translation pass finished.', { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await page.locator('.inspector').waitFor({ state: 'hidden' });
    const selectPaperSentence = () => page.evaluate(() => {
      const node = document.querySelector('.document-preview p').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, node.textContent.indexOf('.') + 1);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await selectPaperSentence();
    const quickSelection = page.getByRole('dialog', { name: 'Quick selection' });
    await quickSelection.waitFor();
    assert.equal(await page.locator('.selection-toolbar').count(), 1);
    await page.screenshot({ path: path.join(artifacts, 'quick-selection.png') });
    await page.setViewportSize({ width: 980, height: 620 });
    const quickBounds = await quickSelection.boundingBox();
    assert.ok(quickBounds && quickBounds.x >= 0 && quickBounds.y >= 0 && quickBounds.x + quickBounds.width <= 980 && quickBounds.y + quickBounds.height <= 620, 'Quick Selection should remain fully visible at the minimum window size');
    await page.screenshot({ path: path.join(artifacts, 'quick-selection-980x620.png') });
    await page.setViewportSize({ width: 1320, height: 820 });
    const selectionRequestStart = generateRequests.length;
    forcedGenerateResponses.push('x'.repeat(300), '精确选区译文');
    await quickSelection.getByRole('button', { name: 'Translate', exact: true }).click();
    await quickSelection.locator('.selection-lookup-message').getByText('Selection translated.', { exact: true }).waitFor();
    await quickSelection.getByText('精确选区译文', { exact: true }).waitFor();
    assert.equal(generateRequests.length - selectionRequestStart, 2, 'An overexpanded complete sentence should run one strict retry');
    assert.match(generateRequests[selectionRequestStart].prompt, /PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE/);
    assert.match(generateRequests[selectionRequestStart].prompt, /PAPERBRIDGE_SELECTION_TRANSLATE_ONLY/);
    assert.doesNotMatch(generateRequests[selectionRequestStart + 1].prompt, /PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE/);
    await quickSelection.getByRole('button', { name: 'Translate', exact: true }).click();
    await quickSelection.locator('.selection-lookup-message').getByText('Using cached quick lookup.', { exact: true }).waitFor();
    const sourceSelection = await page.evaluate(() => window.getSelection().toString());
    const translatedBounds = await quickSelection.locator('.inspector-result.translate p').evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().toJSON();
    });
    const y = translatedBounds.y + translatedBounds.height / 2;
    await page.mouse.move(translatedBounds.left + 1, y);
    await page.mouse.down();
    await page.mouse.move(translatedBounds.right - 1, y, { steps: 6 });
    await page.mouse.up();
    assert.match(await page.evaluate(() => window.getSelection().toString()), /确选区译/);
    await quickSelection.getByRole('button', { name: 'Close quick lookup' }).click();
    await quickSelection.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Show Research Inspector', exact: true }).click();
    assert.equal(await page.locator('.inspector blockquote').textContent(), sourceSelection, 'Selecting result text and closing the card should preserve the paper selection');
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await quickSelection.waitFor({ state: 'detached' });
    await selectPaperSentence();
    await quickSelection.getByText('精确选区译文', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Focus Reading', exact: true }).click();
    await quickSelection.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Exit Focus Reading', exact: true }).click();
    await quickSelection.waitFor({ state: 'detached' });
    await selectPaperSentence();
    await quickSelection.getByText('精确选区译文', { exact: true }).waitFor();
    assert.equal(generateRequests.length - selectionRequestStart, 2, 'Reselecting the Paper sentence should restore the cached result without requesting a model');
    await quickSelection.getByRole('button', { name: 'Cobalt highlight', exact: true }).click();
    assert.equal(await page.locator('.document-preview mark.mark-teal').count(), 1, 'Quick Selection should apply the selected highlight color');
    await quickSelection.getByRole('button', { name: 'Remove Highlight', exact: true }).click();
    assert.equal(await page.locator('.document-preview mark').count(), 0, 'Quick Selection should remove the highlight without closing');
    await quickSelection.getByRole('button', { name: 'Save Term…', exact: true }).click();
    await quickSelection.getByLabel('Preferred translation').fill('快速术语');
    await quickSelection.getByRole('button', { name: 'Save Term', exact: true }).click();
    await quickSelection.getByRole('button', { name: 'Notes & More', exact: true }).click();
    await page.locator('.inspector').waitFor({ state: 'visible' });
    await quickSelection.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.paragraph-explanation').count(), 0, 'Paper selections should not show an unrelated Reader paragraph explanation');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.waitForSelector('.block');
    assert.ok((await page.locator('.block').count()) >= 8);
    await page.locator('.block').nth(1).locator('button[title="Translate or retry block"]').click();
    await page.locator('.block').nth(1).locator('.translation-text.done').waitFor({ timeout: 15000 });
    assert.match(await page.locator('.block').nth(1).locator('.translation-text.done').innerText(), /本地测试译文/);
    await page.getByLabel('Reading mode').selectOption('source');
    assert.equal(await page.locator('.block').nth(1).locator('.translation-text').isVisible(), false);
    await page.getByLabel('Reading mode').selectOption('translation');
    assert.equal(await page.locator('.block').nth(1).locator('.source-text').isVisible(), false);
    await page.getByLabel('Reading mode').selectOption('bilingual');
    await page.locator('.block').nth(1).locator('button[title="Explain full paragraph"]').click();
    await page.getByText('FULL PARAGRAPH EXPLANATION', { exact: false }).waitFor();
    const readerPassage = page.locator('.source-text').nth(1);
    await clickTextOffset(page, readerPassage, 0);
    await page.keyboard.press('Control+Shift+ArrowRight');
    await page.locator('.inspector blockquote').waitFor();
    await page.keyboard.press('ArrowRight');
    await page.locator('.inspector blockquote').waitFor({ state: 'detached' });
    await clickTextOffset(page, readerPassage, 0);
    for (let index = 0; index < 10; index++) await page.keyboard.press('Shift+ArrowRight');
    const keyboardQuote = (await readerPassage.textContent()).slice(0, 10).trim();
    assert.equal(await page.locator('.inspector blockquote').textContent(), keyboardQuote);
    await page.locator('.selection-meta').getByText('ORIGINAL', { exact: true }).waitFor();
    generateDelayMs = 500;
    await page.keyboard.press('Control+Shift+t');
    const inspectorLookupBusy = page.locator('.inspector .selection-lookup-busy');
    await inspectorLookupBusy.getByText('Translating selection…', { exact: true }).waitFor();
    await inspectorLookupBusy.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.inspector .selection-lookup-message').getByText('Quick lookup cancelled.', { exact: true }).waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.inspector-result.translate').count(), 0, 'A cancelled late selection response must not appear');
    generateDelayMs = 0;
    await page.keyboard.press('Control+Shift+t');
    await page.locator('.inspector-result.translate').waitFor({ timeout: 15000 });
    await page.locator('.inspector .selection-lookup-message').getByText('Selection translated.', { exact: true }).waitFor();
    await page.locator('.inspector .action-grid').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.locator('.inspector .selection-lookup-message').getByText('Using cached quick lookup.', { exact: true }).waitFor();
    await page.keyboard.press('Control+Alt+e');
    await page.locator('.inspector-result.explain').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.inspector-result.translate').count(), 1, 'Translation should remain visible after explaining the same selection');
    const readerLookupCount = generateRequests.length;
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.locator('.inspector blockquote').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await clickTextOffset(page, readerPassage, 0);
    for (let index = 0; index < 10; index++) await page.keyboard.press('Shift+ArrowRight');
    await page.locator('.inspector-result.translate').waitFor();
    await page.locator('.inspector-result.explain').waitFor();
    const explanationLanguage = page.getByLabel('Explanation language');
    await explanationLanguage.selectOption('French');
    await page.locator('.inspector-result').first().waitFor({ state: 'detached' });
    await explanationLanguage.selectOption('English');
    await page.locator('.inspector-result.translate').waitFor();
    await page.locator('.inspector-result.explain').waitFor();
    assert.equal(generateRequests.length, readerLookupCount, 'Reselection and language switches should never generate results automatically');
    await page.keyboard.press('Control+Shift+h');
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1);
    const noteInput = page.locator('.inspector textarea');
    await noteInput.fill('Keep this source passage.');
    await noteInput.press('Shift+Home');
    assert.ok(await noteInput.evaluate(input => input.selectionEnd > input.selectionStart));
    assert.equal(await page.locator('.inspector blockquote').textContent(), keyboardQuote);
    await page.getByRole('button', { name: 'Save note' }).click();
    const readerNoteQuote = await page.locator('.inspector blockquote').textContent();
    await page.waitForFunction(quote => [...(CSS.highlights.get('paperbridge-note') || [])]
      .some(range => range.toString() === quote && range.startContainer.parentElement.closest('.source-text')), readerNoteQuote);
    await page.locator('.inspector .highlight.teal').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark.mark-teal').count(), 1, 'Changing color should replace the existing highlight');
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1, 'One selection should have one highlight color');
    await page.locator('.inspector').getByRole('button', { name: 'Remove Highlight', exact: true }).click();
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-note')?.size), 1);
    assert.match(await page.locator('.block').nth(1).locator('.block-notes').innerText(), /Keep this source passage/);
    await page.locator('.inspector-title button[title="Undo last highlight or note change"]').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1);
    await page.locator('.undo-button').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark.mark-amber').count(), 1);
    await page.locator('.undo-button').click();
    assert.equal(await page.locator('.block').nth(1).locator('.block-notes').count(), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-note')?.size || 0), 0);
    await page.screenshot({ path: path.join(artifacts, 'reader.png') });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('heading', { name: 'Find your way into the paper.', exact: true }).waitFor();
    assert.ok(await page.locator('.reading-map article').count() > 0, 'Overview should contain the source-linked reading map');
    await page.getByText('What problem does this paper address?', { exact: true }).waitFor();
    await page.getByText(/\d+ \/ 12 translated/).waitFor();
    const firstGuideLink = page.locator('.reading-map article').first().getByRole('button', { name: /Read paragraph \d+/ });
    const guideParagraph = Number((await firstGuideLink.innerText()).match(/\d+/)?.[0]);
    await firstGuideLink.click();
    await page.getByRole('button', { name: 'Reader', exact: true }).waitFor();
    await page.locator(`#block-${guideParagraph}.current`).waitFor();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'View Original', exact: true }).click();
    await page.getByRole('button', { name: 'Paper', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Paper display mode').inputValue(), 'source');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Start Reading', exact: true }).click();
    await page.locator('.reader-top').waitFor();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, 'overview-reading-guide.png') });
    await page.getByRole('button', { name: 'Generate summary' }).click();
    await page.getByText('No source link validated').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.source-links button').count(), 0);
    await page.evaluate(() => {
      const node = document.querySelector('.summary-card li').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · summarySource', { exact: true }).waitFor();
    assert.equal(await page.locator('.paragraph-explanation').count(), 0, 'Overview selections should keep the supporting column scoped to relevant content');
    await page.locator('.inspector .highlight.teal').click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size), 1);
    await page.locator('.inspector textarea').fill('Summary selection note.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.match(await page.locator('.saved-annotations').innerText(), /summarySource/);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Summary selection note.' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === '本地测试');
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper' }).click();
    await page.locator('.content-column .document-preview').waitFor({ timeout: 15000 });
    await page.evaluate(() => {
      const node = document.querySelector('.content-column .document-preview p').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · fullTranslation', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.amber').click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    await page.locator('.inspector textarea').fill('Connected translation note.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.match(await page.locator('.saved-annotations').innerText(), /fullTranslation/);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Connected translation note.' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === '本地测试');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('updates:check');
      ipcMain.handle('updates:check', () => ({ status: 'available', currentVersion: '0.2.0', latestVersion: '0.3.0', tag: 'windows-v0.3.0' }));
      ipcMain.removeHandler('updates:open-release');
      ipcMain.handle('updates:open-release', (_event, tag) => { global.__openedReleaseTag = tag; });
    });
    await page.getByRole('button', { name: 'Check now' }).click();
    await page.getByText('Windows 0.3.0 is available.').waitFor();
    await page.screenshot({ path: path.join(artifacts, 'settings.png') });
    await page.locator('.modal-head .icon-button').click();
    await page.getByRole('button', { name: 'View release' }).click();
    assert.equal(await app.evaluate(() => global.__openedReleaseTag), 'windows-v0.3.0');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdfPath);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    await page.getByText('Extracted', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByText('This practice PDF contains selectable academic text', { exact: false }).first().waitFor();
    await page.locator('.source-text').getByText(/It uses attention-based inference\./).waitFor();
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    const reference = page.getByRole('region', { name: 'Original PDF reference' });
    await reference.getByRole('img', { name: 'Original PDF page 1' }).waitFor();
    await page.getByLabel('Paper display mode').selectOption('translation');
    await reference.getByRole('button', { name: 'Next page' }).click();
    await reference.getByRole('img', { name: 'Original PDF page 2' }).waitFor();
    await reference.getByRole('button', { name: 'Hide original page' }).click();
    assert.equal(await reference.getByRole('img').count(), 0);
    await reference.getByRole('button', { name: 'Show original page' }).click();
    await reference.getByRole('img', { name: 'Original PDF page 2' }).waitFor();
    await reference.getByRole('button', { name: 'Previous page' }).click();
    await page.getByLabel('Paper display mode').selectOption('source');
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.textLayer[data-page="1"] span').length > 0, null, { timeout: 10000 });
    await clickTextOffset(page, page.locator('.textLayer[data-page="1"] span').filter({ hasText: 'Abstract' }), 0);
    await page.keyboard.press('Shift+End');
    assert.equal(await page.locator('.inspector blockquote').textContent(), 'Abstract');
    await page.getByText('PAPER · EXACT PDF · PAGE 1', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('This note belongs to the exact PDF inside Paper.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size), 1);
    assert.equal(await page.evaluate(() => [...(CSS.highlights.get('paperbridge-note') || [])].map(range => range.toString()).join()), 'Abstract');
    const zoomLevel = page.locator('.pdf-zoom output');
    const pdfScroll = page.locator('.pdf-continuous');
    const paperHeading = page.locator('.textLayer[data-page="1"] span').filter({ hasText: /^Abstract$/ });
    const fitHeadingSize = await paperHeading.evaluate(span => Number.parseFloat(getComputedStyle(span).fontSize));
    await pdfScroll.evaluate(host => { host.scrollTop = host.firstElementChild.offsetTop + 80; });
    await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await page.waitForFunction(({ fontSize }) => {
      const host = document.querySelector('.pdf-continuous');
      const heading = [...host.querySelectorAll('.textLayer[data-page="1"] span')].find(span => span.textContent === 'Abstract');
      return host.dataset.pdfZoom === '125' && Math.abs(host.scrollTop - host.firstElementChild.offsetTop - 100) < 2
        && heading && Math.abs(Number.parseFloat(getComputedStyle(heading).fontSize) - fontSize * 1.25) < 0.1;
    }, { fontSize: fitHeadingSize });
    await page.waitForFunction(() => [...(CSS.highlights.get('paperbridge-coral') || [])].some(range => range.toString() === 'Abstract'));
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.textLayer[data-page="1"] span').length > 0, null, { timeout: 10000 });
    const originalGeometry = () => page.locator('.pdf-sheet canvas').first().evaluate(canvas => ({
      width: canvas.width, height: canvas.height, displayWidth: canvas.clientWidth, displayHeight: canvas.clientHeight
    }));
    const originalSize = await originalGeometry();
    assert.equal(await zoomLevel.innerText(), '100%', 'Paper zoom should be independent of Original');
    await pdfScroll.dispatchEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true });
    await page.waitForFunction(width => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '125' &&
      document.querySelector('.pdf-sheet canvas')?.clientWidth > width, originalSize.displayWidth);
    await pdfScroll.press('Control+-');
    await page.waitForFunction(width => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '100' &&
      document.querySelector('.pdf-sheet canvas')?.clientWidth === width, originalSize.displayWidth);
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    const appearancePopover = page.getByRole('dialog', { name: 'Reading Appearance', exact: true });
    await appearancePopover.getByRole('slider', { name: 'Reader font size', exact: true }).press('End');
    await appearancePopover.getByRole('slider', { name: 'Reading width', exact: true }).press('Home');
    await page.waitForFunction(() => document.querySelector('.app')?.style.getPropertyValue('--reader-width') === '560px');
    assert.deepEqual(await originalGeometry(), originalSize, 'Reading appearance should leave the exact PDF canvas geometry intact');
    await appearancePopover.getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.keyboard.press('Escape');
    await appearancePopover.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size || 0), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-note')?.size || 0), 0);
    await page.screenshot({ path: path.join(artifacts, 'original-pdf.png') });
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer[data-page="1"] span')].find(item => item.textContent.includes('Abstract'));
      const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 8);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('ORIGINAL PDF · PAGE 1', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.teal').click();
    await page.locator('.inspector textarea').fill('This note belongs to the original PDF page.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size), 1);
    await page.screenshot({ path: path.join(artifacts, 'original-pdf-annotated.png') });
    const pdfRecord = fs.readdirSync(path.join(workspace, 'papers')).map(file => JSON.parse(fs.readFileSync(path.join(workspace, 'papers', file), 'utf8'))).find(item => item.type === 'pdf' && item.pdfNotes?.length);
    assert.ok(pdfRecord, 'The PDF note should persist with its paper');
    assert.deepEqual(pdfRecord.pdfHighlights.map(item => ({ scope: item.scope, page: item.page, offset: item.offset, text: item.text })), [
      { scope: 'paperPdf', page: 1, offset: 0, text: 'Abstract' }, { scope: 'pdf', page: 1, offset: 0, text: 'Abstract' }
    ]);
    assert.ok(pdfRecord.pdfNotes.some(item => item.scope === 'paperPdf' && item.body === 'This note belongs to the exact PDF inside Paper.'));
    assert.ok(pdfRecord.pdfNotes.some(item => item.scope === 'pdf' && item.body === 'This note belongs to the original PDF page.'));
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 1 of ') && document.querySelector('.textLayer[data-page="1"]'));
    await page.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the original PDF page.' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'Abstract');
    assert.match(await page.locator('.inspector blockquote').innerText(), /^Abstract$/);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the exact PDF inside Paper.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper' && document.querySelector('[aria-label="Paper display mode"]')?.value === 'source' && window.getSelection()?.toString() === 'Abstract');
    assert.equal(await zoomLevel.innerText(), '125%');
    await pdfScroll.press('Control+=');
    await page.waitForFunction(() => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '150'
      && window.getSelection()?.toString() === 'Abstract');
    await pdfScroll.evaluate(host => { host.scrollLeft = host.scrollWidth; });
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the exact PDF inside Paper.' }).locator('button').first().click();
    await page.waitForFunction(() => {
      const host = document.querySelector('.pdf-continuous');
      const selection = window.getSelection();
      if (selection?.toString() !== 'Abstract' || !selection.rangeCount) return false;
      const range = selection.getRangeAt(0).getBoundingClientRect();
      const left = host.getBoundingClientRect().left;
      return range.left >= left && range.right <= left + host.clientWidth;
    });
    await pdfScroll.press('Control+0');
    await page.waitForFunction(() => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '100');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the original PDF page.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Original' && window.getSelection()?.toString() === 'Abstract');
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 2 of ') && document.querySelector('.textLayer[data-page="2"]'));
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer[data-page="2"] span')].find(item => item.textContent.includes('Abstract'));
      const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 8);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('ORIGINAL PDF · PAGE 2', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.amber').click();
    await page.locator('.inspector textarea').fill('The repeated heading belongs to page two.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    assert.equal(await page.evaluate(() => [...(CSS.highlights.get('paperbridge-teal') || [])].some(range => range.startContainer.parentElement.closest('.textLayer')?.dataset.page === '2')), false);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 1 of ') && document.querySelector('.textLayer[data-page="1"]'));
    await page.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'The repeated heading belongs to page two.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 2 of ') && document.querySelector('.textLayer[data-page="2"]') && window.getSelection()?.toString() === 'Abstract');
    assert.match(await page.locator('.inspector blockquote').innerText(), /^Abstract$/);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 1 of ') && document.querySelector('.textLayer[data-page="1"]'));
    const multilineQuote = 'PaperBridge extraction. It uses';
    const multilineNote = 'This note spans two original PDF lines.';
    const multilineAnchor = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.textLayer[data-page="1"] span')];
      const start = spans.find(item => item.textContent.includes('PaperBridge extraction.'));
      const end = spans.find(item => item.textContent.startsWith('It uses attention-'));
      const range = document.createRange();
      range.setStart(start.firstChild, start.textContent.indexOf('PaperBridge extraction.'));
      range.setEnd(end.firstChild, 'It uses'.length);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      end.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return range.toString();
    });
    assert.equal(multilineAnchor, 'PaperBridge extraction.It uses');
    await page.locator('.inspector blockquote').getByText(multilineQuote, { exact: true }).waitFor();
    const pdfRequests = generateRequests.length;
    forcedGenerateResponses.push('x'.repeat(200));
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.locator('.inspector').getByRole('alert').filter({ hasText: 'The model expanded the selection instead of translating it.' }).waitFor();
    assert.equal(generateRequests.length - pdfRequests, 1, 'A strict request should not repeat itself');
    assert.equal(await page.locator('.inspector .inspector-result.translate').count(), 0);
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.locator('.inspector').getByText('Selection translated.', { exact: true }).waitFor();
    const pdfPrompt = generateRequests[pdfRequests].prompt;
    assert.ok(pdfPrompt.includes('<<<PAPERBRIDGE_SELECTION_TRANSLATE_ONLY>>>\n' + multilineQuote + '\n<<<END_PAPERBRIDGE_SELECTION>>>'));
    assert.ok(!pdfPrompt.includes(multilineAnchor));
    assert.doesNotMatch(pdfPrompt, /PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE/);
    assert.equal(generateRequests[pdfRequests + 1].prompt, pdfPrompt);
    await page.locator('.inspector').getByRole('button', { name: 'Explain', exact: true }).click();
    await page.locator('.inspector').getByText('Selection explained.', { exact: true }).waitFor();
    assert.ok(generateRequests[pdfRequests + 2].prompt.includes('Selected text:\n' + multilineQuote + '\n'));
    assert.match(generateRequests[pdfRequests + 2].prompt, /Surrounding paragraph:/);
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill(multilineNote);
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.waitForFunction(async ({ id, quote }) => {
      const saved = await window.paperBridge.loadPaper(id);
      return saved?.pdfNotes?.some(note => note.quote === quote) && saved.pdfHighlights?.some(highlight => highlight.quote === quote);
    }, { id: pdfRecord.id, quote: multilineQuote });

    const crossPageQuote = 'Page one trailing sentence. Abstract';
    const crossPageNote = 'A single annotation crosses the PDF page break.';
    await page.waitForFunction(() => document.querySelector('.textLayer[data-page="2"] span'));
    await page.locator('.pdf-continuous').scrollIntoViewIfNeeded();
    const boundary = await page.locator('.pdf-continuous').evaluate(host => {
      host.scrollTop = host.children[1].offsetTop - 180;
      const span = (number, text) => [...host.querySelectorAll('.textLayer[data-page="' + number + '"] span')].find(item => item.textContent === text);
      const first = span(1, 'Page one trailing sentence.').getBoundingClientRect();
      const last = span(2, 'Abstract').getBoundingClientRect();
      return { from: { x: first.left + 0.5, y: first.top + first.height / 2 }, to: { x: last.right - 0.5, y: last.top + last.height / 2 } };
    });
    await page.mouse.move(boundary.from.x, boundary.from.y);
    await page.mouse.down();
    await page.mouse.move(boundary.to.x, boundary.to.y, { steps: 20 });
    await page.mouse.up();
    await page.locator('.inspector blockquote').getByText(crossPageQuote, { exact: true }).waitFor();
    await page.getByText('ORIGINAL PDF · PAGES 1–2', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.amber').click();
    await page.getByLabel('Note for selected passage').fill(crossPageNote);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.waitForFunction(async ({ id, quote }) => {
      const saved = await window.paperBridge.loadPaper(id);
      return saved?.pdfNotes?.some(note => note.quote === quote && note.anchors?.length === 2)
        && saved.pdfHighlights?.some(highlight => highlight.quote === quote && highlight.anchors?.length === 2);
    }, { id: pdfRecord.id, quote: crossPageQuote });
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper' }).click();
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    assert.match(await page.locator('[data-view-scope="fullTranslation"]').innerText(), /本地测试译文/);
    await reference.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.pdf-facsimile canvas[aria-label="Original PDF page 2"]');
      if (!canvas || canvas.width < 500) return false;
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return data.some((value, index) => index % 4 === 0 && value < 100 && data[index + 3] === 255);
    });
    await page.setViewportSize({ width: 1320, height: 820 });
    const originalBox = await reference.boundingBox();
    const translationBox = await page.locator('[data-view-scope="fullTranslation"]').boundingBox();
    assert.ok(originalBox.x + originalBox.width < translationBox.x, 'Wide views place the original beside the translation');
    await page.screenshot({ path: path.join(artifacts, 'full-translation-facsimile.png') });
    await page.setViewportSize({ width: 640, height: 620 });
    const stacked = await page.locator('.pdf-comparison').evaluate(comparison => {
      const original = comparison.querySelector('.pdf-facsimile').getBoundingClientRect();
      const translation = comparison.querySelector('[data-view-scope="fullTranslation"]').getBoundingClientRect();
      return original.bottom <= translation.top && comparison.scrollWidth <= comparison.clientWidth;
    });
    assert.ok(stacked, 'Narrow views stack the original and translation without horizontal scrolling');
    await page.setViewportSize({ width: 1320, height: 820 });
    await reference.getByRole('button', { name: 'Open original PDF' }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 2 of ') && document.querySelector('.textLayer[data-page="2"]'));
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 1 of ') && document.querySelector('.textLayer[data-page="1"]'));
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, artifacts);
    const exportBundle = async (target = page) => {
      await target.getByRole('button', { name: 'More' }).click();
      await target.locator('.modal-body').getByRole('button', { name: 'Export Markdown', exact: true }).click();
      await target.getByRole('button', { name: 'Export portable Markdown bundle' }).click();
    };
    const bundleFolders = () => fs.readdirSync(artifacts).filter(name => name.startsWith('practice-PaperBridge'));
    const beforeExport = new Set(bundleFolders());
    await exportBundle();
    await page.waitForFunction(() => /Exported \d+ Markdown files|Bundle export incomplete/.test(document.body.innerText), null, { timeout: 30000 });
    assert.match(await page.locator('.main-scroll').innerText(), /Exported/, 'Bundle export should complete without an error');
    const bundle = path.join(artifacts, bundleFolders().find(name => !beforeExport.has(name)));
    assert.deepEqual(fs.readFileSync(path.join(bundle, 'original.pdf')), fs.readFileSync(pdfPath));
    assert.ok(fs.existsSync(path.join(bundle, 'pages', 'page-001.png')));
    assert.ok(fs.existsSync(path.join(bundle, 'pages', 'page-002.png')));
    for (const name of ['Original Pages', 'Original', 'Translated', 'Bilingual', 'Full Translation']) {
      const markdown = fs.readFileSync(path.join(bundle, `${name}.md`), 'utf8');
      assert.match(markdown, /\(original\.pdf\)[\s\S]*\(pages\/page-001\.png\)[\s\S]*\(pages\/page-002\.png\)/);
      if (name === 'Full Translation') assert.match(markdown, /# Full translation of selectable text\n\n本地测试译文/);
    }
    const exportedAnalysis = fs.readFileSync(path.join(bundle, 'Analysis.md'), 'utf8');
    assert.match(exportedAnalysis, /Original PDF · page 1\n\n> Abstract\n\nThis note belongs to the original PDF page\./);
    assert.match(exportedAnalysis, /Paper · exact PDF · page 1\n\n> Abstract\n\nThis note belongs to the exact PDF inside Paper\./);
    assert.match(exportedAnalysis, /Original PDF · page 2\n\n> Abstract\n\nThe repeated heading belongs to page two\./);
    assert.ok(exportedAnalysis.includes('Original PDF · page 1\n\n> ' + multilineQuote + '\n\n' + multilineNote));
    assert.ok(exportedAnalysis.includes('Original PDF · page 1 · coral\n\n> ' + multilineQuote));
    assert.ok(exportedAnalysis.includes('Original PDF · pages 1–2\n\n> ' + crossPageQuote + '\n\n' + crossPageNote));
    assert.ok(exportedAnalysis.includes('Original PDF · pages 1–2 · amber\n\n> ' + crossPageQuote));
    assert.match(exportedAnalysis, /Original PDF · page 1 · teal/);
    assert.match(exportedAnalysis, /Paper · exact PDF · page 1 · coral/);
    assert.match(exportedAnalysis, /Original PDF · page 2 · amber/);
    const beforeWarm = new Set(bundleFolders());
    await exportBundle();
    await page.getByText(/Reused 2 archived PDF page image\(s\)/).waitFor();
    const warm = path.join(artifacts, bundleFolders().find(name => !beforeWarm.has(name)));
    for (const file of ['original.pdf', 'pages/page-001.png', 'pages/page-002.png']) {
      assert.deepEqual(fs.readFileSync(path.join(warm, file)), fs.readFileSync(path.join(bundle, file)));
    }
    const cache = path.join(workspace, 'pdf-page-cache');
    const cachedPageTwo = path.join(cache, fs.readdirSync(cache)[0], pdfRecord.id, 'page-002.png.entry');
    const damagedPage = fs.readFileSync(cachedPageTwo);
    damagedPage[damagedPage.length - 1] ^= 1;
    fs.writeFileSync(cachedPageTwo, damagedPage);
    const beforeStop = new Set(bundleFolders());
    await page.evaluate(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
        HTMLCanvasElement.prototype.toBlob = toBlob;
        window.releasePageImage = () => toBlob.call(this, callback, ...options);
      };
    });
    await exportBundle();
    await page.waitForFunction(() => typeof window.releasePageImage === 'function');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.evaluate(() => { window.releasePageImage(); delete window.releasePageImage; });
    await page.getByText(/1 PDF page image\(s\) \(page export stopped\)/).waitFor();
    const stopped = path.join(artifacts, bundleFolders().find(name => !beforeStop.has(name)));
    const stoppedTranslation = fs.readFileSync(path.join(stopped, 'Full Translation.md'), 'utf8');
    assert.match(stoppedTranslation, /Page export stopped[\s\S]*pages\/page-001\.png[\s\S]*本地测试译文/);
    assert.doesNotMatch(stoppedTranslation, /pages\/page-002\.png/);
    assert.deepEqual(fs.readdirSync(path.join(stopped, 'pages')), ['page-001.png']);
    const beforeRepair = new Set(bundleFolders());
    await exportBundle();
    await page.getByText(/2 PDF page image\(s\)[\s\S]*Reused 1 archived PDF page image\(s\)/).waitFor();
    const repaired = path.join(artifacts, bundleFolders().find(name => !beforeRepair.has(name)));
    assert.deepEqual(fs.readFileSync(path.join(repaired, 'pages', 'page-002.png')), fs.readFileSync(path.join(bundle, 'pages', 'page-002.png')));
    const pdfBytes = fs.readFileSync(pdfPath);
    await page.evaluate(bytes => {
      const file = new File([new Uint8Array(bytes)], 'practice.pdf', { type: 'application/pdf' });
      const transfer = new DataTransfer(); transfer.items.add(new File(['ignore this non-PDF'], 'notes.txt', { type: 'text/plain' })); transfer.items.add(file);
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, [...pdfBytes]);
    await page.getByText('Opened practice.pdf.', { exact: true }).waitFor({ timeout: 15000 });
    const libraryCount = await page.locator('.library-row').count();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Re-extract PDF as New Copy' }).click();
    await page.getByText('Extracted', { exact: false }).first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.library-row').count(), libraryCount + 1);
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.locator('.library-row').filter({ hasText: 'Edited practice label' }).click();
    assert.match(await page.locator('.saved-annotations').innerText(), /Summary selection note\./);
    assert.match(await page.locator('.saved-annotations').innerText(), /Connected translation note\./);
    let returnedToAnnotatedPdf = false;
    const pdfRows = page.locator('.library-row').filter({ hasText: 'practice.pdf' });
    for (let index = 0; index < await pdfRows.count(); index++) {
      await pdfRows.nth(index).click();
      if ((await page.locator('.saved-annotations').innerText().catch(() => '')).includes('This note belongs to the original PDF page.')) { returnedToAnnotatedPdf = true; break; }
    }
    assert.equal(returnedToAnnotatedPdf, true, 'The original annotated PDF should remain in the library');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '125');
    await app.close();
    const paperFile = path.join(workspace, 'papers', pdfRecord.id + '.json');
    const legacyPdf = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    const legacyNote = legacyPdf.pdfNotes.find(note => note.body === multilineNote);
    const legacyHighlight = legacyPdf.pdfHighlights.find(highlight => highlight.quote === multilineQuote);
    const crossAnchors = legacyPdf.pdfNotes.find(note => note.body === crossPageNote).anchors;
    assert.deepEqual(crossAnchors.map(({ page, text }) => ({ page, text })), [
      { page: 1, text: 'Page one trailing sentence.' }, { page: 2, text: 'Abstract' }
    ]);
    assert.ok(crossAnchors.every(anchor => !Object.hasOwn(anchor, 'pageText')));
    assert.equal(legacyNote.text, multilineAnchor);
    assert.equal(legacyHighlight.text, multilineAnchor);
    assert.equal(legacyNote.offset, legacyHighlight.offset);
    delete legacyNote.quote;
    delete legacyHighlight.quote;
    fs.writeFileSync(paperFile, JSON.stringify(legacyPdf));
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const reopenedPage = await app.firstWindow();
    await reopenedPage.getByRole('heading', { name: 'practice.pdf' }).waitFor();
    await reopenedPage.waitForFunction(() => document.querySelector('.pdf-continuous')?.dataset.pdfZoom === '125');
    assert.match(await reopenedPage.locator('.saved-annotations').innerText(), /This note belongs to the original PDF page\./);
    await reopenedPage.waitForFunction(() => document.querySelector('.pdf-toolbar')?.textContent.includes('page 1 of ') && document.querySelector('.textLayer[data-page="1"]'));
    await reopenedPage.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
    await reopenedPage.waitForFunction(anchor => {
      const highlight = CSS.highlights.get('paperbridge-coral');
      return highlight?.size === 1 && [...highlight][0].toString() === anchor;
    }, multilineAnchor);
    await reopenedPage.locator('.saved-annotations .annotation-row').filter({ hasText: multilineNote }).locator('button').first().click();
    await reopenedPage.locator('.inspector blockquote').getByText(multilineQuote, { exact: true }).waitFor();
    assert.equal(await reopenedPage.locator('.inspector textarea').inputValue(), multilineNote);
    await reopenedPage.waitForFunction(async ({ id, quote, offset }) => {
      const saved = await window.paperBridge.loadPaper(id);
      return saved?.pdfNotes?.some(note => note.quote === quote && note.offset === offset)
        && saved.pdfHighlights?.some(highlight => highlight.quote === quote && highlight.offset === offset);
    }, { id: pdfRecord.id, quote: multilineQuote, offset: legacyNote.offset });
    await reopenedPage.locator('.saved-annotations .annotation-row').filter({ hasText: crossPageNote }).locator('button').first().click();
    await reopenedPage.locator('.inspector blockquote').getByText(crossPageQuote, { exact: true }).waitFor();
    assert.equal(await reopenedPage.getByLabel('Note for selected passage').inputValue(), crossPageNote);
    await reopenedPage.waitForFunction(anchors => {
      return ['paperbridge-amber', 'paperbridge-note'].every(name => {
        const ranges = [...(CSS.highlights.get(name) || [])];
        return anchors.every(anchor => ranges.some(range => range.toString() === anchor.text
          && range.startContainer.parentElement.closest('.textLayer')?.dataset.page === String(anchor.page)));
      });
    }, crossAnchors);
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, artifacts);
    await exportBundle(reopenedPage);
    await reopenedPage.getByText(/Reused 2 archived PDF page image\(s\)/).waitFor();
    const blankPath = path.join(artifacts, 'scan-no-text.pdf');
    fs.writeFileSync(blankPath, samplePdf(true));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, blankPath);
    await reopenedPage.getByRole('button', { name: 'Open PDF' }).first().click();
    await reopenedPage.getByRole('heading', { name: 'scan-no-text.pdf' }).waitFor();
    await reopenedPage.locator('.scan-notice').getByText('No selectable text in this PDF').waitFor();
    assert.equal(await reopenedPage.getByRole('button', { name: 'Translate Paper' }).isDisabled(), true);
    await reopenedPage.getByRole('button', { name: 'Reader', exact: true }).click();
    await reopenedPage.locator('.scan-notice').getByText('No selectable text in this PDF').waitFor();
    await reopenedPage.getByRole('button', { name: 'Overview', exact: true }).click();
    assert.equal(await reopenedPage.getByRole('button', { name: 'Generate summary' }).isDisabled(), true);
    await reopenedPage.getByRole('button', { name: 'Full Translation', exact: true }).click();
    assert.equal(await reopenedPage.getByRole('button', { name: 'Translate full paper' }).isDisabled(), true);
    await reopenedPage.getByRole('button', { name: 'Original', exact: true }).click();
    await reopenedPage.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500);
    await reopenedPage.locator('.scan-notice').getByText('No selectable text on this PDF page').waitFor();
    await reopenedPage.screenshot({ path: path.join(artifacts, 'scan-guidance.png') });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: false, executable: '' }));
    });
    await reopenedPage.locator('.scan-notice').getByRole('button', { name: 'Parse with MinerU' }).click();
    await reopenedPage.getByRole('heading', { name: 'Local AI setup' }).waitFor();
    await reopenedPage.locator('.modal-head .icon-button').click();
    await reopenedPage.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await reopenedPage.getByRole('tab', { name: 'Parsing', exact: true }).click();
    await reopenedPage.getByLabel('PDF extraction mode').selectOption('mineruPreferred');
    await reopenedPage.locator('.modal-head .icon-button').click();
    const firstOcr = 'MinerU recovered this experimental passage from the first scanned page.';
    const secondOcr = 'The first readable paragraph of the second scanned page begins here.';
    const pageOneBody = 'Additional results on the first page explain the historical measurements. '.repeat(40).trim();
    const pageTwoBody = 'Further results on the second page support the conclusions. '.repeat(40).trim();
    await app.evaluate(({ ipcMain }, { firstOcr, secondOcr, pageOneBody, pageTwoBody }) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'test-mineru' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => ({
        markdown: ['# Recovered scan', firstOcr, pageOneBody, secondOcr, pageTwoBody].join('\n\n'),
        pageHints: ['Recovered scan', firstOcr, pageOneBody, secondOcr, pageTwoBody].map((text, index) => ({ page: index < 3 ? 1 : 2, text }))
      }));
    }, { firstOcr, secondOcr, pageOneBody, pageTwoBody });
    await reopenedPage.locator('.scan-notice').getByRole('button', { name: 'Parse with MinerU' }).click();
    await reopenedPage.getByText('MinerU structure ready:', { exact: false }).waitFor();
    await reopenedPage.getByRole('button', { name: 'Paper', exact: true }).click();
    await reopenedPage.getByLabel('Paper display mode').selectOption('source');
    await reopenedPage.getByRole('button', { name: 'Switch to PDF text', exact: true }).click();
    await reopenedPage.locator('.pdf-toolbar').getByRole('button', { name: 'Next page' }).click();
    await reopenedPage.locator('.pdf-toolbar').getByText(/page 2 of 2/).waitFor();
    const exactPdf = reopenedPage.locator('[data-pdf-scope="paperPdf"]');
    await reopenedPage.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await reopenedPage.waitForFunction(() => document.querySelector('[data-pdf-scope="paperPdf"]')?.dataset.pdfZoom === '125');
    await exactPdf.evaluate(host => { host.scrollTop += 75; });
    const pageTwoOffset = await exactPdf.evaluate(host => host.scrollTop - host.querySelector('[data-pdf-page="2"]').offsetTop);
    assert.ok(pageTwoOffset > 0);
    const expectReaderBlock = async (id, text) => {
      await reopenedPage.locator(`#block-${id} .source-text`).getByText(text, { exact: true }).waitFor();
      await reopenedPage.waitForFunction(id => {
        const block = document.getElementById(`block-${id}`);
        const host = document.querySelector('.main-scroll');
        const top = block?.getBoundingClientRect().top - host.getBoundingClientRect().top;
        return block?.classList.contains('current') && top >= -2 && top <= 25;
      }, id);
    };
    await reopenedPage.locator('.scan-notice').getByRole('button', { name: 'Open OCR Reader' }).click();
    await expectReaderBlock(4, secondOcr);
    await reopenedPage.getByRole('button', { name: 'Back to previous reading location', exact: true }).click();
    await exactPdf.waitFor();
    await reopenedPage.locator('.pdf-toolbar').getByText(/page 2 of 2/).waitFor();
    assert.equal(await exactPdf.getAttribute('data-pdf-zoom'), '125');
    await reopenedPage.waitForFunction(offset => {
      const host = document.querySelector('[data-pdf-scope="paperPdf"]');
      const slot = host?.querySelector('[data-pdf-page="2"]');
      return slot && Math.abs(host.scrollTop - slot.offsetTop - offset) < 5;
    }, pageTwoOffset);
    await reopenedPage.getByRole('button', { name: 'Switch to MinerU Markdown', exact: true }).waitFor();
    await reopenedPage.getByRole('button', { name: 'Forward in reading history', exact: true }).click();
    await expectReaderBlock(4, secondOcr);

    await reopenedPage.getByLabel('Reading mode').selectOption('translation');
    const readerSearch = reopenedPage.getByPlaceholder('Search paper  Ctrl+F');
    await readerSearch.fill('second scanned page');
    await reopenedPage.getByRole('button', { name: 'Original', exact: true }).click();
    await reopenedPage.locator('.pdf-toolbar').getByRole('button', { name: 'Previous page' }).click();
    await reopenedPage.locator('.pdf-toolbar').getByText(/page 1 of 2/).waitFor();
    await reopenedPage.locator('.scan-notice').getByRole('button', { name: 'Open OCR Reader' }).click();
    await expectReaderBlock(1, 'Recovered scan');
    assert.equal(await reopenedPage.getByLabel('Reading mode').inputValue(), 'bilingual');
    assert.equal(await readerSearch.inputValue(), '');
    await reopenedPage.getByRole('button', { name: 'Back to previous reading location', exact: true }).click();
    await reopenedPage.locator('[data-pdf-scope="pdf"]').waitFor();
    await reopenedPage.locator('.pdf-toolbar').getByText(/page 1 of 2/).waitFor();
    await reopenedPage.getByRole('button', { name: 'Forward in reading history', exact: true }).click();
    await expectReaderBlock(1, 'Recovered scan');
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => '  \n ');
    });
    const emptyMineruPath = path.join(artifacts, 'empty-mineru-result.pdf');
    fs.writeFileSync(emptyMineruPath, samplePdf(false, ' after empty OCR'));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, emptyMineruPath);
    await reopenedPage.getByRole('button', { name: 'Open PDF' }).first().click();
    await reopenedPage.getByRole('heading', { name: 'empty-mineru-result.pdf' }).waitFor();
    await reopenedPage.getByText('MinerU returned no readable blocks.', { exact: false }).waitFor();
    await reopenedPage.getByRole('button', { name: 'Reader', exact: true }).click();
    await reopenedPage.getByText('This practice PDF contains selectable academic text', { exact: false }).first().waitFor();

    const columnsPath = path.join(artifacts, 'narrow-gutter.pdf');
    const column = (side, x, y) => Array.from({ length: 6 }, (_, i) =>
      `1 0 0 1 ${x} ${y - i * 14} Tm (${side} line ${i + 1} reports valid sample results.) Tj`
    ).join(' ');
    const layout = [
      'BT /F1 12 Tf 1 0 0 1 174 752 Tm (Shared heading across both columns) Tj',
      column('Left upper', 58, 720), column('Right upper', 315, 720),
      '1 0 0 1 90 615 Tm (Table 1. Results recorded across both columns before the follow-up trial.) Tj',
      column('Left lower', 58, 582), column('Right lower', 315, 582), 'ET'
    ].join(' ');
    fs.writeFileSync(columnsPath, samplePdf(false, '', layout));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, columnsPath);
    await reopenedPage.getByRole('button', { name: 'Open PDF' }).first().click();
    await reopenedPage.getByRole('heading', { name: 'narrow-gutter.pdf' }).waitFor();
    await reopenedPage.getByRole('button', { name: 'Reader', exact: true }).click();
    await reopenedPage.locator('.source-text').getByText(/Right lower line 6/).waitFor();
    const lines = (await reopenedPage.locator('.source-text').allInnerTexts()).join('\n');
    assert.match(lines, /Shared heading[\s\S]*Left upper line 6[\s\S]*Right upper line 1[\s\S]*Right upper line 6[\s\S]*Table 1\.[\s\S]*Left lower line 6[\s\S]*Right lower line 1/);
    const rotatedPath = path.join(artifacts, 'rotated-pdf.pdf');
    fs.writeFileSync(rotatedPath, samplePdf(false, '', '', 90));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, rotatedPath);
    await reopenedPage.getByRole('button', { name: 'Open PDF' }).first().click();
    await reopenedPage.getByRole('heading', { name: 'rotated-pdf.pdf' }).waitFor();
    await reopenedPage.getByRole('button', { name: 'Original', exact: true }).click();
    await reopenedPage.locator('.textLayer[data-page="1"][data-main-rotation="90"]').waitFor();
    await reopenedPage.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await reopenedPage.waitForFunction(() => {
      const host = document.querySelector('.pdf-continuous');
      const sheet = host?.querySelector('.pdf-sheet');
      const canvas = sheet?.querySelector('canvas')?.getBoundingClientRect();
      const layer = sheet?.querySelector('.textLayer[data-main-rotation="90"]')?.getBoundingClientRect();
      return host?.dataset.pdfZoom === '125' && canvas && layer && canvas.width > canvas.height
        && ['left', 'top', 'width', 'height'].every(key => Math.abs(canvas[key] - layer[key]) < 2);
    });
    console.log('Electron workflow verified: menus, shortcuts, source and cross-line PDF annotations, original-page comparison, portable export, scan guidance, restart recovery, and narrow-gutter reading order.');
  } finally { await app?.close(); ollama.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
