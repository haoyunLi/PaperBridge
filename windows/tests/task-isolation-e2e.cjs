const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const textA = 'Abstract\n\nPaper A must remain visible while an unrelated PDF import is pending.';
const textB = 'Abstract\n\nPaper B is the active workspace after the old PDF import was cancelled.';

function samplePdf() {
  const stream = 'BT /F1 16 Tf 72 720 Td (Delayed PDF import) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function paste(page, text, expectedText) {
  await page.getByRole('button', { name: 'Paste Text' }).first().click();
  await page.locator('.paste-area').fill(text);
  await page.getByRole('button', { name: 'Open text' }).click();
  await page.locator('.modal-backdrop').waitFor({ state: 'hidden' });
  await page.getByText(expectedText, { exact: false }).first().waitFor();
}

async function startDelayedPdf(page, app, requestNumber) {
  await page.getByRole('button', { name: 'Open PDF' }).first().click();
  await page.locator('.task-progress').getByText('MinerU is reconstructing the paper…').waitFor();
  try { await waitFor(() => app.evaluate((_, index) => global.__delayedMineru?.length >= index, requestNumber), `MinerU request ${requestNumber}`); }
  catch (cause) {
    console.error('Import diagnostics:', await app.evaluate(() => ({ pending: global.__delayedMineru?.length, dropImports: global.__dropImports })), await page.locator('.notice').allInnerTexts());
    throw cause;
  }
}

async function assertPaperB(page) {
  assert.equal(await page.locator('.title-wrap h1').innerText(), 'Pasted Text');
  assert.match(await page.locator('.document-preview').innerText(), /Paper B is the active workspace/);
  assert.equal(await page.locator('.notice.error').count(), 0);
  const status = await page.locator('.notice.info').allInnerTexts();
  assert.equal(status.some(value => /Delayed PDF|MinerU failed|Late MinerU failure|Extracted.*blocks/.test(value)), false);
}

async function verifyManualMineruPreservesDocumentOutputs(root, artifacts, pdfBytes, pdfId) {
  const workspace = path.join(artifacts, 'mineru-output-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected MinerU test workspace path');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'pdfs'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ autoCheckUpdates: false, onboardingCompletedVersion: 1, mineruExecutable: 'mock-mineru', ollamaBaseURL: 'http://127.0.0.1:9' }));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${pdfId}.pdf`), pdfBytes);
  const pdfBlock = { id: 1, text: 'Original PDF reader text remains selected.', heading: false, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] };
  const paperFile = path.join(workspace, 'papers', `${pdfId}.json`);
  fs.writeFileSync(paperFile, JSON.stringify({ id: pdfId, name: 'Existing PDF outputs.pdf', type: 'pdf', blocks: [pdfBlock], pdfBlocks: [pdfBlock],
    sourceMode: 'pdf', extraction: 'PDF.js', createdAt: '2026-01-01T00:00:00.000Z', tags: [],
    summary: { source: 'Summary from the PDF text layer.', target: 'Original target summary.', claims: [], sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
    connectedTranslation: 'Full translation from the PDF text layer.', connectedBlocks: [{ id: 1, source: pdfBlock.text, output: 'Full translation from the PDF text layer.', status: 'ok' }],
    position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' } }));

  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Existing PDF outputs.pdf' }).waitFor({ timeout: 20000 });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'mock-mineru' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => '# OCR structure\n\nReconstructed MinerU reader text.');
    });
    await page.getByRole('button', { name: /More/ }).click();
    await page.getByRole('button', { name: 'Parse with MinerU' }).click();
    await waitFor(() => JSON.parse(fs.readFileSync(paperFile, 'utf8')).mineruBlocks?.length > 0, 'saved MinerU blocks');
    const afterParse = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.equal(afterParse.sourceMode, 'pdf');
    assert.equal(afterParse.blocks[0].text, pdfBlock.text);
    assert.equal(afterParse.summary.source, 'Summary from the PDF text layer.');
    assert.equal(afterParse.connectedTranslation, 'Full translation from the PDF text layer.');
    assert.match(await page.locator('.document-preview').innerText(), /Original PDF reader text remains selected/);

    await page.getByRole('button', { name: 'Switch to MinerU Markdown' }).click();
    await waitFor(() => JSON.parse(fs.readFileSync(paperFile, 'utf8')).sourceMode === 'mineru', 'manual MinerU source switch');
    const afterSwitch = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.match(afterSwitch.blocks.map(block => block.text).join(' '), /Reconstructed MinerU reader text/);
    assert.equal(afterSwitch.summary.stale, true);
    assert.equal(afterSwitch.connectedStale, true);
  } finally { await app.close(); }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'task-isolation-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ pdfExtractionMode: 'mineruPreferred', autoCheckUpdates: false, onboardingCompletedVersion: 1, mineruExecutable: 'mock-mineru', ollamaBaseURL: 'http://127.0.0.1:9' }));

  const pdfBytes = samplePdf();
  const pdfId = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await paste(page, textA, 'Paper A must remain visible');

    await app.evaluate(({ ipcMain }, payload) => {
      global.__delayedMineru = [];
      global.__dropImports = 0;
      ipcMain.removeHandler('pdf:import');
      ipcMain.handle('pdf:import', () => ({ id: payload.id, name: 'Delayed PDF.pdf', existing: null, bytes: new Uint8Array(payload.bytes) }));
      ipcMain.removeHandler('pdf:import-bytes');
      ipcMain.handle('pdf:import-bytes', () => { global.__dropImports++; throw new Error('Busy drag reached PDF import IPC.'); });
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'mock-mineru' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => new Promise((resolve, reject) => global.__delayedMineru.push({ resolve, reject })));
    }, { id: pdfId, bytes: [...pdfBytes] });

    await startDelayedPdf(page, app, 1);
    await page.evaluate(bytes => {
      const file = new File([new Uint8Array(bytes)], 'busy-drop.pdf', { type: 'application/pdf' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, [...pdfBytes]);
    await page.getByText('Finish or stop the current task before opening another paper.', { exact: false }).waitFor();
    assert.equal(await app.evaluate(() => global.__dropImports), 0);
    assert.match(await page.locator('.document-preview').innerText(), /Paper A must remain visible/);

    await page.getByRole('button', { name: 'Stop' }).click();
    await paste(page, textB, 'Paper B is the active workspace');
    await app.evaluate(() => global.__delayedMineru[0].resolve('# Delayed PDF\n\nLate MinerU result.'));
    await page.waitForTimeout(250);
    await assertPaperB(page);

    await startDelayedPdf(page, app, 2);
    await page.getByRole('button', { name: 'Stop' }).click();
    await paste(page, textB, 'Paper B is the active workspace');
    await app.evaluate(() => global.__delayedMineru[1].reject(new Error('Late MinerU failure')));
    await page.waitForTimeout(250);
    await assertPaperB(page);

    const papersDir = path.join(workspace, 'papers');
    const textBId = crypto.createHash('sha256').update(textB.trim()).digest('hex');
    await waitFor(() => fs.existsSync(path.join(papersDir, `${textBId}.json`)), 'saved paper B');
    const paperFiles = fs.readdirSync(papersDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    assert.equal(paperFiles.length, 2, 'Cancelled PDF must not appear in the library');
    console.log('Cancelled PDF import and busy drag left the active pasted paper untouched after late MinerU success and error.');
  } finally { await app.close(); }
  await verifyManualMineruPreservesDocumentOutputs(root, artifacts, pdfBytes, pdfId);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
