const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { keepMineruResult } = require('../electron/mineru-resources.cjs');

function samplePdf(text = 'Delayed import text.') {
  const stream = `BT /F1 18 Tf 72 720 Td (Imported Paper) Tj 0 -30 Td /F1 12 Tf (${text}) Tj ET`;
  const parts = ['%PDF-1.4\n', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n', '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n', '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n', `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`];
  let body = parts[0], offset = body.length; const offsets = [0];
  for (let index = 1; index < parts.length; index++) { offsets[index] = offset; body += parts[index]; offset = body.length; }
  const xref = offset;
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* asynchronous save/import */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'import-progress-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected import test workspace');
  fs.rmSync(workspace, { recursive: true, force: true }); fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'mineruOnly' }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const page = await app.firstWindow();
  const drop = async (name, text) => page.evaluate(({ name, bytes }) => {
    const file = new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { name, bytes: [...samplePdf(text)] });
  const chooseMode = async mode => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Parsing', exact: true }).click();
    await page.getByLabel('PDF extraction mode').selectOption(mode);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  };
  const fallbackText = 'The selectable text survives a failed MinerU process.';
  const cancelledArchiveText = 'Cancel while the original page image is being prepared.';
  const structuredPdfText = 'The source page is the original first page.';
  const paperId = text => createHash('sha256').update(samplePdf(text)).digest('hex');
  const archivePage = text => {
    const cache = path.join(workspace, 'pdf-page-cache');
    return path.join(cache, fs.readdirSync(cache)[0], paperId(text), 'page-001.png.entry');
  };
  try {
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Paste Text', exact: true }).first().click();
    await page.locator('.paste-area').fill('Abstract\n\nThe original saved paper must survive a cancelled import.');
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-1').getByTitle('Bookmark heading').click();
    await waitFor(() => fs.readdirSync(path.join(workspace, 'papers')).some(name => name.endsWith('.json')), 'original paper save');
    const paperFile = path.join(workspace, 'papers', fs.readdirSync(path.join(workspace, 'papers')).find(name => name.endsWith('.json')));
    await waitFor(() => JSON.parse(fs.readFileSync(paperFile, 'utf8')).blocks[0].bookmark === true, 'bookmark save');
    const before = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      globalThis.__mineruImports = [];
      globalThis.__discardedMineruResults = [];
      ipcMain.removeHandler('mineru:discard-result');
      ipcMain.handle('mineru:discard-result', (_event, payload) => { globalThis.__discardedMineruResults.push(payload); });
      globalThis.__mineruStatusCalls = 0;
      globalThis.__mineruScenario = 'hold';
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => {
        globalThis.__mineruStatusCalls++;
        if (globalThis.__mineruScenario === 'missing') return { compatible: false, reason: 'Fixture MinerU executable is missing.' };
        if (globalThis.__mineruScenario === 'probe-error') throw new Error('Fixture MinerU detection failed.');
        return { compatible: true, executable: 'fixture-mineru', version: '3.0.0' };
      });
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', (_event, { requestId }) => {
        if (globalThis.__mineruScenario === 'parser-error') throw new Error('Fixture MinerU process failed.');
        return new Promise(resolve => {
          globalThis.__mineruImports.push({ requestId, resolve });
          BrowserWindow.getAllWindows()[0].webContents.send('paperbridge:progress', { kind: 'mineru', requestId, status: 'formula recognition 2 / 5' });
        });
      });
    });
    await drop('delayed-import.pdf');
    await page.locator('.import-progress-screen').waitFor();
    await page.getByRole('heading', { name: 'delayed-import.pdf', exact: true }).waitFor();
    await page.getByRole('main').getByText('Recognizing formulas · 2 of 5', { exact: true }).waitFor();
    assert.equal(await page.locator('.import-progress-card').getByText(/previous paper.*remain unchanged/i).isVisible(), true);
    await page.getByRole('button', { name: 'Cancel Import', exact: true }).click();
    await page.locator('.import-progress-screen').waitFor({ state: 'detached' });
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor();
    await drop('strict-empty.pdf', 'A strict import must keep the previous paper.');
    await page.getByRole('heading', { name: 'strict-empty.pdf', exact: true }).waitFor();
    await page.getByRole('main').getByText('Recognizing formulas · 2 of 5', { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const [first] = globalThis.__mineruImports;
      BrowserWindow.getAllWindows()[0].webContents.send('paperbridge:progress', { kind: 'mineru', requestId: first.requestId, status: 'page layout 77 / 99' });
      first.resolve({ markdown: '# Imported Paper\n\nLate MinerU result must be ignored.', pageHints: [], resourceId: '1111111111111111' });
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.locator('.import-progress-screen').isVisible(), true);
    assert.equal(await page.getByRole('main').getByText('Recognizing formulas · 2 of 5', { exact: true }).isVisible(), true);
    await app.evaluate(() => globalThis.__mineruImports[1].resolve({
      markdown: '![Visual asset only](image.png)', pageHints: [], resourceId: '2222222222222222'
    }));
    await page.getByText(/Could not import strict-empty\.pdf: MinerU returned no readable blocks/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Pasted Text', exact: true }).isVisible(), true);
    const after = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.equal(after.blocks[0].bookmark, true);
    assert.equal(after.blocks[1].text, before.blocks[1].text);
    assert.equal(fs.readdirSync(path.join(workspace, 'papers')).filter(name => name.endsWith('.json')).length, 1, 'Cancelled or failed strict imports must not create a workspace paper');
    assert.deepEqual(await app.evaluate(() => globalThis.__discardedMineruResults), [
      { id: paperId(), resourceId: '1111111111111111' },
      { id: paperId('A strict import must keep the previous paper.'), resourceId: '2222222222222222' }
    ]);
    await app.evaluate(() => { globalThis.__mineruScenario = 'missing'; });
    await drop('strict-missing.pdf', 'MinerU must be available in strict mode.');
    await page.getByText(/Could not import strict-missing\.pdf: Fixture MinerU executable is missing/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Pasted Text', exact: true }).isVisible(), true);

    await chooseMode('mineruPreferred');
    await app.evaluate(() => { globalThis.__mineruScenario = 'parser-error'; });
    await drop('fallback.pdf', fallbackText);
    await page.getByText(/MinerU failed:.*Fixture MinerU process failed/).waitFor();
    assert.ok(fs.existsSync(archivePage(fallbackText)), 'PDF fallback should prepare pages before saving the imported paper');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByText('The selectable text survives a failed MinerU process.', { exact: true }).waitFor();
    await app.evaluate(() => { globalThis.__mineruScenario = 'probe-error'; });
    await drop('probe-fallback.pdf', 'The selectable text survives a failed MinerU probe.');
    await page.getByText(/MinerU failed:.*Fixture MinerU detection failed/).waitFor();

    await app.evaluate(() => { globalThis.__mineruScenario = 'hold'; });
    const structuredId = paperId(structuredPdfText);
    const passage = 'A MinerU passage with independent page metadata. [Measurements](data/result.csv#row)';
    const markdown = `# A parsed title\n\n${passage}`;
    const legacy = path.join(workspace, 'mineru', structuredId, 'pipeline');
    const prepared = path.join(workspace, 'prepared-mineru');
    for (const [directory, csv] of [[legacy, 'previous bytes'], [prepared, 'current bytes']]) {
      fs.mkdirSync(path.join(directory, 'data'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'paper.md'), markdown);
      fs.writeFileSync(path.join(directory, 'data', 'result.csv'), csv);
    }
    fs.writeFileSync(path.join(legacy, 'paper_content_list.json'), '[{"page_idx":9,"text":"A parsed title"}]');
    fs.writeFileSync(path.join(prepared, 'structured_content.json'), '{"pages":[{"page_idx":0,"blocks":[{"content":"A parsed title"}]}]}');
    const resourceId = keepMineruResult(workspace, structuredId, path.join(prepared, 'paper.md'), markdown);
    await drop('structured-with-pages.pdf', structuredPdfText);
    await page.getByRole('main').getByText('Recognizing formulas · 2 of 5', { exact: true }).waitFor();
    await app.evaluate((_electron, result) => globalThis.__mineruImports.at(-1).resolve(result), {
      markdown, resourceId, pageHints: [{ page: 1, text: 'A parsed title' }, { page: 1, text: passage }]
    });
    await page.getByText(/Extracted 2 blocks from 1 pages/).waitFor();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-2 .block-header').getByLabel('Block 2, page 1', { exact: true }).waitFor();
    assert.equal(fs.existsSync(archivePage(structuredPdfText)), false, 'Successful MinerU imports keep their structured source');
    const exports = path.join(workspace, 'exports');
    fs.mkdirSync(exports);
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = () => {};
    }, exports);
    await page.keyboard.press('Control+Shift+e');
    await page.getByText(/Exported 4 Markdown files, 1 asset\(s\), 1 PDF page image/).waitFor();
    const saved = await page.evaluate(id => window.paperBridge.loadPaper(id), structuredId);
    assert.equal(saved.mineruResourceId, resourceId);
    assert.deepEqual(await page.evaluate(id => window.paperBridge.cachedMineruPages(id), structuredId), [{ page: 1, text: 'A parsed title' }]);
    const bundle = path.join(exports, fs.readdirSync(exports)[0]);
    const link = fs.readFileSync(path.join(bundle, 'Original.md'), 'utf8').match(/\[Measurements\]\((assets\/[^#]+\.csv)#row\)/)?.[1];
    assert.ok(link, 'The current attachment should be linked with its fragment');
    assert.equal(fs.readFileSync(path.join(bundle, link), 'utf8'), 'current bytes');
    assert.equal((await app.evaluate(() => globalThis.__discardedMineruResults)).length, 2);

    await chooseMode('pdfOnly');
    const probes = await app.evaluate(() => globalThis.__mineruStatusCalls);
    await page.evaluate(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
        HTMLCanvasElement.prototype.toBlob = toBlob;
        window.releaseImportPage = () => toBlob.call(this, callback, ...options);
      };
    });
    await drop('cancelled-archive.pdf', cancelledArchiveText);
    await page.waitForFunction(() => typeof window.releaseImportPage === 'function');
    await page.getByRole('main').getByText('Preparing original PDF page images · 1 of 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel Import', exact: true }).click();
    await page.getByRole('heading', { name: 'structured-with-pages.pdf', exact: true }).waitFor();
    await drop('pdf-only.pdf', 'The PDF only mode reads the selectable text layer.');
    await page.getByText(/Extracted \d+ blocks from 1 pages/).waitFor();
    await page.evaluate(() => { window.releaseImportPage(); delete window.releaseImportPage; });
    assert.equal(await page.evaluate(id => window.paperBridge.loadPaper(id), paperId(cancelledArchiveText)), null);
    assert.equal(fs.existsSync(archivePage(cancelledArchiveText)), false, 'Cancelled page output must be ignored');
    await drop('cancelled-archive.pdf', cancelledArchiveText);
    await page.getByText(/Extracted \d+ blocks from 1 pages/).waitFor();
    assert.ok(fs.existsSync(archivePage(cancelledArchiveText)), 'Reimport should complete the unfinished archive');
    assert.equal(await app.evaluate(() => globalThis.__mineruStatusCalls), probes, 'PDF-only imports should not probe MinerU');
    await page.locator('.library-row').filter({ hasText: /^fallback\.pdf/ }).click();
    await page.getByText(/MinerU failed:.*Fixture MinerU process failed/).waitFor();
    console.log('Import verified: strict and fallback modes, PDF-only page preparation, and accepted MinerU resources isolated from rejected or stale output.');
  } finally { await app.close().catch(() => {}); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
