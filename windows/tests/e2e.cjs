const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

function samplePdf(blank = false, variant = '') {
  const stream = blank ? '' : 'BT /F1 18 Tf 72 720 Td (Abstract) Tj 0 -30 Td /F1 12 Tf (This practice PDF contains selectable academic text for PaperBridge extraction.) Tj ET';
  const secondStream = blank ? '' : `BT /F1 18 Tf 72 720 Td (Abstract) Tj 0 -30 Td /F1 12 Tf (The second page repeats the heading so annotations must retain their page${variant}.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
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
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b', size_vram: 1_073_741_824, size: 2_000_000_000 }] }));
    if (request.url === '/api/generate') {
      const finish = () => response.end(JSON.stringify({ response: '本地测试译文', done: true }));
      return generateDelayMs ? setTimeout(finish, generateDelayMs) : finish();
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
    await page.locator('.modal-head .icon-button').click();
    assert.equal(await page.locator('.title-wrap h1').innerText(), 'Edited practice label');
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
    generateDelayMs = 300;
    await page.keyboard.press('Control+Enter');
    const taskProgress = page.locator('.task-progress progress');
    await taskProgress.waitFor();
    const taskValues = await taskProgress.evaluate(element => ({ value: element.value, max: element.max }));
    assert.ok(taskValues.max > 1 && taskValues.value < taskValues.max, 'Translation should show determinate progress while running');
    await page.waitForFunction(() => document.querySelector('.task-progress progress')?.value > 0);
    await page.screenshot({ path: path.join(artifacts, 'task-progress.png') });
    await page.getByText('Translation pass finished.', { exact: false }).waitFor({ timeout: 15000 });
    generateDelayMs = 0;
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await page.locator('.inspector').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      const node = document.querySelector('.document-preview p').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 12);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const quickSelection = page.getByRole('dialog', { name: 'Quick selection' });
    await quickSelection.waitFor();
    assert.equal(await page.locator('.selection-toolbar').count(), 1);
    await page.screenshot({ path: path.join(artifacts, 'quick-selection.png') });
    await page.setViewportSize({ width: 980, height: 620 });
    const quickBounds = await quickSelection.boundingBox();
    assert.ok(quickBounds && quickBounds.x >= 0 && quickBounds.y >= 0 && quickBounds.x + quickBounds.width <= 980 && quickBounds.y + quickBounds.height <= 620, 'Quick Selection should remain fully visible at the minimum window size');
    await page.screenshot({ path: path.join(artifacts, 'quick-selection-980x620.png') });
    await page.setViewportSize({ width: 1320, height: 820 });
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
    await page.evaluate(() => {
      const node = document.querySelectorAll('.source-text')[1].firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 10);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.keyboard.press('Control+Shift+t');
    await page.locator('.inspector-result.translate').waitFor({ timeout: 15000 });
    await page.keyboard.press('Control+Alt+e');
    await page.locator('.inspector-result.explain').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.inspector-result.translate').count(), 1, 'Translation should remain visible after explaining the same selection');
    await page.keyboard.press('Control+Shift+h');
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1);
    await page.locator('.inspector textarea').fill('Keep this source passage.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.locator('.inspector .highlight.teal').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark.mark-teal').count(), 1, 'Changing color should replace the existing highlight');
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1, 'One selection should have one highlight color');
    await page.locator('.inspector').getByRole('button', { name: 'Remove Highlight', exact: true }).click();
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 0);
    assert.match(await page.locator('.block').nth(1).locator('.block-notes').innerText(), /Keep this source passage/);
    await page.locator('.inspector-title button[title="Undo last highlight or note change"]').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 1);
    await page.locator('.undo-button').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark.mark-amber').count(), 1);
    await page.locator('.undo-button').click();
    assert.equal(await page.locator('.block').nth(1).locator('.block-notes').count(), 0);
    await page.screenshot({ path: path.join(artifacts, 'reader.png') });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('heading', { name: 'Paper overview', exact: true }).waitFor();
    assert.ok(await page.locator('.reading-map button').count() > 0, 'Overview should contain the source-linked reading map');
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
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.getByLabel('Paper display mode').selectOption('source');
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.textLayer span').length > 0, null, { timeout: 10000 });
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer span')].find(item => item.textContent.includes('Abstract'));
      const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 8);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('PAPER · EXACT PDF · PAGE 1', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('This note belongs to the exact PDF inside Paper.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size), 1);
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.textLayer span').length > 0, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size || 0), 0);
    await page.screenshot({ path: path.join(artifacts, 'original-pdf.png') });
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer span')].find(item => item.textContent.includes('Abstract'));
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
    await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '1');
    await page.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the original PDF page.' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'Abstract');
    assert.match(await page.locator('.inspector blockquote').innerText(), /^Abstract$/);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the exact PDF inside Paper.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper' && document.querySelector('[aria-label="Paper display mode"]')?.value === 'source' && window.getSelection()?.toString() === 'Abstract');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'This note belongs to the original PDF page.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Original' && window.getSelection()?.toString() === 'Abstract');
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '2');
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer span')].find(item => item.textContent.includes('Abstract'));
      const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 8);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('ORIGINAL PDF · PAGE 2', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.amber').click();
    await page.locator('.inspector textarea').fill('The repeated heading belongs to page two.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size || 0), 0);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '1');
    await page.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'The repeated heading belongs to page two.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '2' && window.getSelection()?.toString() === 'Abstract');
    assert.match(await page.locator('.inspector blockquote').innerText(), /^Abstract$/);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '1');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, artifacts);
    await page.getByRole('button', { name: 'More' }).click();
    await page.locator('.modal-body').getByRole('button', { name: 'Export Markdown', exact: true }).click();
    await page.getByRole('button', { name: 'Export portable Markdown bundle' }).click();
    await page.waitForFunction(() => /Exported|Bundle export incomplete/.test(document.body.innerText), null, { timeout: 30000 });
    assert.match(await page.locator('.main-scroll').innerText(), /Exported/, 'Bundle export should complete without an error');
    const bundles = fs.readdirSync(artifacts).filter(name => name.startsWith('practice-PaperBridge')).sort((left, right) => fs.statSync(path.join(artifacts, left)).mtimeMs - fs.statSync(path.join(artifacts, right)).mtimeMs);
    assert.ok(bundles.length > 0);
    assert.ok(fs.existsSync(path.join(artifacts, bundles.at(-1), 'original.pdf')));
    assert.ok(fs.existsSync(path.join(artifacts, bundles.at(-1), 'pages', 'page-001.png')));
    assert.ok(fs.existsSync(path.join(artifacts, bundles.at(-1), 'pages', 'page-002.png')));
    assert.match(fs.readFileSync(path.join(artifacts, bundles.at(-1), 'Original Pages.md'), 'utf8'), /pages\/page-001\.png/);
    const exportedAnalysis = fs.readFileSync(path.join(artifacts, bundles.at(-1), 'Analysis.md'), 'utf8');
    assert.match(exportedAnalysis, /Original PDF · page 1\n\n> Abstract\n\nThis note belongs to the original PDF page\./);
    assert.match(exportedAnalysis, /Paper · exact PDF · page 1\n\n> Abstract\n\nThis note belongs to the exact PDF inside Paper\./);
    assert.match(exportedAnalysis, /Original PDF · page 2\n\n> Abstract\n\nThe repeated heading belongs to page two\./);
    assert.match(exportedAnalysis, /Original PDF · page 1 · teal/);
    assert.match(exportedAnalysis, /Paper · exact PDF · page 1 · coral/);
    assert.match(exportedAnalysis, /Original PDF · page 2 · amber/);
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
    await app.close();
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const reopenedPage = await app.firstWindow();
    await reopenedPage.getByRole('heading', { name: 'practice.pdf' }).waitFor();
    assert.match(await reopenedPage.locator('.saved-annotations').innerText(), /This note belongs to the original PDF page\./);
    await reopenedPage.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '1');
    await reopenedPage.waitForFunction(() => CSS.highlights.get('paperbridge-teal')?.size === 1);
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
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'test-mineru' }));
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
    console.log('Electron workflow verified: native menu and shortcuts, source/PDF annotations, two-page export, scan OCR guidance, empty MinerU fallback, and restart recovery.');
  } finally { await app?.close(); ollama.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
