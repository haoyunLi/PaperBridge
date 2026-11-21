const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const root = path.resolve(__dirname, '..');
const name = 'scanned-notebook.pdf';
const bytes = fs.readFileSync(path.join(__dirname, 'mac-parity', name));
const id = crypto.createHash('sha256').update(bytes).digest('hex');
const colors = [[182, 69, 53], [43, 136, 87], [67, 93, 176]];

async function dropPDF(page, filename, pdf) {
  await page.evaluate(({ filename, data }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(data)], filename, { type: 'application/pdf' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { filename, data: [...pdf] });
  await page.getByRole('heading', { name: filename, exact: true }).waitFor();
}

async function visibleEndPages(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('.pdf-continuous');
    if (!host || host.dataset.pdfZoom !== '50') return false;
    const box = host.getBoundingClientRect();
    const slots = [...host.children].filter(slot => {
      const bounds = slot.getBoundingClientRect();
      return Math.min(bounds.bottom, box.bottom) - Math.max(bounds.top, box.top) > 5;
    });
    return slots.length >= 3 && slots.at(-1).dataset.pdfPage === '8' && slots.every(slot => {
      const canvas = slot.querySelector('canvas');
      if (!canvas?.height || !canvas.width) return false;
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      const number = Number(slot.dataset.pdfPage);
      return Math.abs(pixel[0] - Math.round(number * 25.5)) < 3 && Math.abs(pixel[1] - 51) < 3 && Math.abs(pixel[2] - 179) < 3;
    });
  });
}

async function pageImage(page, number, facsimile = false) {
  const selector = facsimile ? `canvas[aria-label="Original PDF page ${number}"]`
    : `.pdf-page-slot[data-pdf-page="${number}"] canvas`;
  await page.waitForFunction(({ selector, color }) => {
    const canvas = document.querySelector(selector);
    if (!canvas?.width || !canvas.height) return false;
    const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return color.every((v, i) => Math.abs(v - pixel[i]) < 5);
  }, { selector, color: colors[number - 1] });
  const box = await page.locator(selector).boundingBox();
  assert.equal(box.width > box.height, number === 2, 'printed page orientation');
}

async function run() {
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'scanned-original-'));
  const settings = { onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly',
    mineruExecutable: path.join(dir, 'absent', 'mineru.exe'), ollamaBaseURL: 'http://127.0.0.1:9' };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ executablePath,
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')], cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir, PAPERBRIDGE_TOOLS_ROOT: path.join(dir, 'tools') } });
  let app = await launch();
  const result = {};
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await dropPDF(page, name, bytes);
    await page.locator('.scan-notice').getByText('No selectable text in this PDF').waitFor();
    await pageImage(page, 1, true);
    result.canTranslate = await page.getByRole('button', { name: 'Translate Paper', exact: true }).isEnabled();
    await openWorkspaceView(page, 'Overview');
    result.canSummarize = await page.getByRole('button', { name: 'Generate summary', exact: true }).isEnabled();
    await openWorkspaceView(page, 'Full Translation');
    result.canTranslateFull = await page.getByRole('button', { name: 'Translate full paper', exact: true }).isEnabled();
    await openWorkspaceView(page, 'Paper');
    await page.getByLabel('Paper display mode').selectOption('source');
    for (const number of [1, 2, 3]) {
      if (number > 1) await page.getByRole('button', { name: 'Next page' }).click();
      await page.locator('.pdf-toolbar').getByText('Exact original PDF · page ' + number + ' of 3').waitFor();
      await pageImage(page, number);
    }
    await page.getByRole('button', { name: 'Previous page' }).click();
    await pageImage(page, 2);
    await page.getByRole('button', { name: 'Zoom in PDF' }).click();
    await page.getByLabel('PDF zoom level').getByText('125%').waitFor();
    const target = 55;
    await page.locator('.pdf-continuous').evaluate((host, offset) => {
      host.scrollTop = host.querySelector('[data-pdf-page="2"]').offsetTop + offset;
    }, target);
    const file = path.join(dir, 'papers', id + '.json');
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !(read().position.page === 2 && read().position.scrollByTab?.['Pdf:paperPdf:2'] > 40)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const paper = read();
    result.paragraphs = paper.blocks.length;
    assert.ok(Math.abs(paper.position.scrollByTab['Pdf:paperPdf:2'] * 1.25 - target) < 2);
    result.originalSHA256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'pdfs', id + '.pdf'))).digest('hex');
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('.pdf-toolbar').getByText('Exact original PDF · page 2 of 3').waitFor();
    await pageImage(page, 2);
    await page.waitForFunction(target => {
      const host = document.querySelector('.pdf-continuous');
      return host?.dataset.pdfZoom === '125' && Math.abs(host.scrollTop - host.querySelector('[data-pdf-page="2"]').offsetTop - target) < 2;
    }, target);
    result.restoredPage = 2;
    assert.deepEqual(result, { canTranslate: false, canSummarize: false, canTranslateFull: false,
      paragraphs: 0, originalSHA256: id, restoredPage: 2 });
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
      assert.deepEqual(result, native.scannedNotebook, 'scanned paper and restored page match the Mac reader');
    }
    const slides = 'landscape-swatches.pdf';
    await dropPDF(page, slides, fs.readFileSync(path.join(__dirname, 'mac-parity', slides)));
    await page.setViewportSize({ width: 1250, height: 970 });
    for (const tab of ['Original', 'Paper']) {
      await openWorkspaceView(page, tab);
      if (tab === 'Paper') await page.getByLabel('Paper display mode').selectOption('source');
      await page.locator('.pdf-continuous canvas').first().waitFor();
      const zoomOut = page.getByRole('button', { name: 'Zoom out PDF' });
      await zoomOut.click();
      await zoomOut.click();
      await page.getByLabel('PDF zoom level').getByText('50%').waitFor();
      await page.locator('.pdf-continuous').evaluate(host => { host.scrollTop = host.scrollHeight; });
      await page.locator('.pdf-toolbar').getByText(/page 8 of 8/).waitFor();
      await visibleEndPages(page);
      await page.setViewportSize({ width: 1250, height: 650 });
      await page.locator('.pdf-continuous').evaluate(host => { host.scrollTop = host.scrollHeight; });
      await page.setViewportSize({ width: 1250, height: 970 });
      await visibleEndPages(page);
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1250, height: 970 });
    await page.locator('.pdf-toolbar').getByText(/page 8 of 8/).waitFor();
    await visibleEndPages(page);
    console.log(JSON.stringify({ dir, result, visibleLandscapePagesRestored: true }));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
