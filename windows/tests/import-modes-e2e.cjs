const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const root = path.resolve(__dirname, '..');
const pdf = fs.readFileSync(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'));
const pdfId = crypto.createHash('sha256').update(pdf).digest('hex');

async function savedPaper(page, id, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const paper = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    if (paper && predicate(paper)) return paper;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for paper ' + id);
}

async function runScenario(dir, mode, failure) {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: mode, ollamaBaseURL: 'http://127.0.0.1:9'
  }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath && { executablePath }), args: [...(executablePath ? [] : ['.']), '--user-data-dir='+path.join(dir, 'profile')],
    cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir }
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.welcome').getByRole('button', { name: 'Try a Practice Paper', exact: true }).click();
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-1 button[title^="Bookmark"]').click();
    const previous = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    await savedPaper(page, previous, paper => paper.blocks[0].bookmark);
    await app.evaluate(({ ipcMain }, failure) => {
      globalThis.parserCalls = 0;
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'fixture-mineru', version: 'fixture' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => {
        globalThis.parserCalls++;
        if (failure) throw new Error('Calibration parser unavailable');
        return { markdown: '# Calibration\n\nThe ceramic sample was measured at two field strengths.', pageHints: [] };
      });
    }, failure);
    await page.evaluate(encoded => {
      const files = new DataTransfer();
      files.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'emcee-v3.pdf', {type: 'application/pdf'}));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', {bubbles: true, dataTransfer: files}));
    }, pdf.toString('base64'));
    const rejected = failure && mode === 'mineruOnly';
    if (rejected) {
      await page.getByText(/Could not import emcee-v3\.pdf:.*Calibration parser unavailable/).waitFor();
    } else {
      await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id, pdfId);
      await savedPaper(page, pdfId, paper => paper.blocks.length > 0);
    }
    const displayed = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    const { paper, keptBookmark } = await page.evaluate(async ({ displayed, previous }) => ({
      paper: await window.paperBridge.loadPaper(displayed),
      keptBookmark: (await window.paperBridge.loadPaper(previous)).blocks[0].bookmark
    }), { displayed, previous });
    const keptPrevious = displayed === previous;
    const error = await page.locator('.notice.error').allTextContents();
    const originalAvailable = !keptPrevious && pdf.equals(Buffer.from(await page.evaluate(async id =>
      Array.from(await window.paperBridge.readPdf(id)), displayed)));
    return {
      parserCalled: (await app.evaluate(() => globalThis.parserCalls)) === 1, keptPrevious, keptBookmark,
      structured: paper.sourceMode === 'mineru', readPdfText: !keptPrevious && paper.sourceMode === 'pdf' && paper.blocks.length > 0,
      reportedError: error.some(text => text.includes('Calibration parser unavailable')),
      reportedFallback: Boolean(paper.extractionWarning?.includes('Calibration parser unavailable')), originalAvailable
    };
  } finally { await app.close(); }
}

async function run() {
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, {recursive: true});
  const dir = fs.mkdtempSync(path.join(artifacts, 'import-modes-'));
  const outcomes = {};
  for (const [name,mode,failure] of [
    ['preferredFailure','mineruPreferred',true], ['strictFailure','mineruOnly',true], ['pdfOnly','pdfOnly',true],
    ['preferredSuccess','mineruPreferred',false], ['strictSuccess','mineruOnly',false]
  ]) {
    const actual = await runScenario(path.join(dir, name), mode, failure);
    const rejected = mode === 'mineruOnly' && failure;
    const structured = mode !== 'pdfOnly' && !failure;
    assert.deepEqual(actual, {
      parserCalled: mode !== 'pdfOnly', keptPrevious: rejected, keptBookmark: true,
      structured, readPdfText: !rejected && !structured, reportedError: rejected,
      reportedFallback: mode === 'mineruPreferred' && failure, originalAvailable: !rejected
    }, name);
    outcomes[name] = actual;
  }
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
    const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
    assert.deepEqual(outcomes, native.importModes, 'Five normal PDF imports match the native Mac view model');
  }
  console.log(JSON.stringify({dir, outcomes}));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
