const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

function samplePdf() {
  const stream = 'BT /F1 18 Tf 72 720 Td (Abstract) Tj 0 -30 Td /F1 12 Tf (This practice PDF contains selectable academic text for PaperBridge extraction.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
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
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b', size_vram: 1_073_741_824, size: 2_000_000_000 }] }));
    if (request.url === '/api/generate') return response.end(JSON.stringify({ response: '本地测试译文', done: true }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}` }));
  const pdfPath = path.join(artifacts, 'practice.pdf');
  fs.writeFileSync(pdfPath, samplePdf());
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await page.screenshot({ path: path.join(artifacts, 'welcome.png') });
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
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.waitForSelector('.block');
    assert.ok((await page.locator('.block').count()) >= 8);
    await page.locator('.block').nth(1).locator('button[title="Translate or retry block"]').click();
    await page.locator('.block').nth(1).locator('.translation-text.done').waitFor({ timeout: 15000 });
    assert.match(await page.locator('.block').nth(1).locator('.translation-text.done').innerText(), /本地测试译文/);
    await page.evaluate(() => {
      const node = document.querySelectorAll('.source-text')[1].firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 10);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector .highlight.amber').click();
    await page.locator('.inspector textarea').fill('Keep this source passage.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.locator('.inspector .highlight.amber').click();
    assert.equal(await page.locator('.block').nth(1).locator('mark').count(), 0);
    assert.match(await page.locator('.block').nth(1).locator('.block-notes').innerText(), /Keep this source passage/);
    await page.screenshot({ path: path.join(artifacts, 'reader.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.waitForSelector('.hardware-panel');
    await page.screenshot({ path: path.join(artifacts, 'settings.png') });
    await page.locator('.modal-head .icon-button').click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdfPath);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    await page.getByText('Extracted', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.getByText('This practice PDF contains selectable academic text', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.textLayer span').length > 0, null, { timeout: 10000 });
    await page.screenshot({ path: path.join(artifacts, 'original-pdf.png') });
    await page.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer span')].find(item => item.textContent.includes('Abstract'));
      const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 8);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · BLOCK 1').waitFor();
    console.log('Electron workflow verified: automatic setup diagnosis and one-click UI, practice paper, local translation, Reader, settings, GPU detection, PDF import and original page.');
  } finally { await app.close(); ollama.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
