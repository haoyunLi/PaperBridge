const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

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
      first.resolve('# Imported Paper\n\nLate MinerU result must be ignored.');
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.locator('.import-progress-screen').isVisible(), true);
    assert.equal(await page.getByRole('main').getByText('Recognizing formulas · 2 of 5', { exact: true }).isVisible(), true);
    await app.evaluate(() => globalThis.__mineruImports[1].resolve('![Visual asset only](image.png)'));
    await page.getByText(/Could not import strict-empty\.pdf: MinerU returned no readable blocks/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Pasted Text', exact: true }).isVisible(), true);
    const after = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.equal(after.blocks[0].bookmark, true);
    assert.equal(after.blocks[1].text, before.blocks[1].text);
    assert.equal(fs.readdirSync(path.join(workspace, 'papers')).filter(name => name.endsWith('.json')).length, 1, 'Cancelled or failed strict imports must not create a workspace paper');
    await app.evaluate(() => { globalThis.__mineruScenario = 'missing'; });
    await drop('strict-missing.pdf', 'MinerU must be available in strict mode.');
    await page.getByText(/Could not import strict-missing\.pdf: Fixture MinerU executable is missing/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Pasted Text', exact: true }).isVisible(), true);

    await chooseMode('mineruPreferred');
    await app.evaluate(() => { globalThis.__mineruScenario = 'parser-error'; });
    await drop('fallback.pdf', 'The selectable text survives a failed MinerU process.');
    await page.getByText(/MinerU failed:.*Fixture MinerU process failed/).waitFor();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByText('The selectable text survives a failed MinerU process.', { exact: true }).waitFor();
    await app.evaluate(() => { globalThis.__mineruScenario = 'probe-error'; });
    await drop('probe-fallback.pdf', 'The selectable text survives a failed MinerU probe.');
    await page.getByText(/MinerU failed:.*Fixture MinerU detection failed/).waitFor();

    await chooseMode('pdfOnly');
    const probes = await app.evaluate(() => globalThis.__mineruStatusCalls);
    await drop('pdf-only.pdf', 'The PDF only mode reads the selectable text layer.');
    await page.getByText(/Extracted \d+ blocks from 1 pages/).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__mineruStatusCalls), probes, 'PDF-only imports should not probe MinerU');
    await page.locator('.library-row').filter({ hasText: /^fallback\.pdf/ }).click();
    await page.getByText(/MinerU failed:.*Fixture MinerU process failed/).waitFor();
    console.log('Import verified: mode-specific failures, persisted fallback reason, no OCR in PDF-only mode, and late-result isolation across imports.');
  } finally { await app.close().catch(() => {}); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
