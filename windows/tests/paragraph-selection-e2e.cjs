const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout = 15000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; }
    catch { /* The save file and restored layout may still be settling. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function samplePdf() {
  const streams = ['Original PDF selection stays independent.', 'Second original PDF page verifies structural Undo.']
    .map(text => `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'paragraph-selection-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.mkdirSync(path.join(workspace, 'pdfs'));
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const id = hash('Independent paragraph selection and reading position');
  const otherId = hash('Other independently selected paper');
  const pdfId = hash('Original PDF does not select a Reader paragraph');
  let generationRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await bounded('fixture service listen', new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${server.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const blocks = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const heading = ({ 1: 'Abstract', 11: 'Methods', 19: 'Results' })[number];
    const text = heading || (number === 13 ? 'First editable sentence. Second editable sentence.' :
      `Passage ${number}. ${number === 20 ? 'Unique twentieth destination. ' : ''}` +
      'Independent reading positions retain the visible evidence while the inspector explains a separately selected paragraph. '.repeat(number === 12 ? 1 : 7));
    return { id: number, text, heading: Boolean(heading), status: 'ok', page: 1,
      translation: heading ? `章节 ${number}` : `段落 ${number} 的已存译文。` + '阅读位置和选中段落分别保留。'.repeat([12, 13].includes(number) ? 1 : 8),
      bookmark: false, highlights: [], translationHighlights: [], notes: [] };
  });
  const paper = { id, name: 'Independent paragraph selection', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    blocks, taskSettings: settings, selectedParagraphID: 1, inspectorOpen: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 2, displayMode: 'bilingual' },
    summary: { source: 'A source summary keeps its own selection scope.', target: '译文摘要保留自己的选择范围。',
      sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [] },
    connectedTranslation: 'A connected translation keeps its own selection scope.' };
  const other = { ...paper, id: otherId, name: 'Separate library selection', blocks: blocks.slice(0, 4),
    selectedParagraphID: 3, position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } } };
  const pdfBlocks = blocks.slice(0, 4).map((block, index) => ({ ...block, page: index < 2 ? 1 : 2 }));
  const pdf = { ...paper, id: pdfId, name: 'PDF selection boundary.pdf', type: 'pdf', sourceMode: 'pdf', extraction: 'PDF.js',
    blocks: pdfBlocks, pdfBlocks, selectedParagraphID: 2,
    position: { tab: 'Original', block: 1, page: 1, displayMode: 'bilingual' } };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = (paperId = id) => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  for (const document of [paper, other, pdf]) fs.writeFileSync(paperFile(document.id), JSON.stringify(document));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${pdfId}.pdf`), samplePdf());
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));

  let app, page, failure, phase = 'launch';
  const stages = [], errors = [];
  const stage = value => { phase = value; stages.push(value); console.log(`[paragraph-selection] ${value}`); };
  const fail = error => { failure ||= error; console.error(`[paragraph-selection] ${phase}: ${error.stack || error}`); };
  const evaluate = (fn, value) => bounded(`${phase}: renderer evaluation`, page.evaluate(fn, value));
  const ready = (paperId = id) => waitFor(() => evaluate(paperId => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === paperId && host.getAttribute('aria-busy') === 'false';
  }, paperId), 'reading surface restored');
  const firstVisible = () => evaluate(() => {
    const host = document.querySelector('.main-scroll');
    return Number([...document.querySelectorAll('.reader-list > .block')]
      .find(node => node.getBoundingClientRect().bottom > host.getBoundingClientRect().top + 12)?.id.replace('block-', ''));
  });
  const scroll = () => evaluate(() => document.querySelector('.main-scroll').scrollTop);
  const selected = async (number, paperId = id) => {
    await waitFor(() => readPaper(paperId).selectedParagraphID === number, `selected paragraph ${number} saved independently`);
    await page.locator('.save-status:is(.saved,.idle)').waitFor();
    assert.equal(readPaper(paperId).selectedParagraphID, number, 'Selection must remain correct after the current save finishes');
    if (await page.locator('.reader-list').count()) {
      assert.deepEqual(await page.locator('.reader-list > .block.current').evaluateAll(nodes => nodes.map(node => Number(node.id.slice(6)))), [number]);
    }
  };
  const position = async (number, paperId = id) => {
    await waitFor(async () => await firstVisible() === number && readPaper(paperId).position.block === number &&
      Math.abs(readPaper(paperId).position.scrollByTab.Reader - await scroll()) < 2, `visible paragraph ${number} and exact offset saved`);
  };
  const explainTarget = async number => {
    await page.locator('.paragraph-explanation > small').filter({ hasText: `EXPLANATION · BLOCK ${number}` }).waitFor();
    assert.match(await page.locator('.paragraph-explanation > small').textContent(), new RegExp(`BLOCK ${number}$`));
  };
  const wheelTo = async number => {
    await ready();
    const target = await evaluate(number => {
      const host = document.querySelector('.main-scroll').getBoundingClientRect();
      const block = document.getElementById(`block-${number}`).getBoundingClientRect();
      return { x: host.left + host.width / 2, y: host.top + Math.min(60, host.height / 2), delta: block.top - host.top + 24 };
    }, number);
    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(0, target.delta);
    await position(number);
  };
  const openPaper = async (document, number, viewport) => {
    const row = page.locator('.recent-papers .library-row').filter({ hasText: document.name.slice(0, 24) });
    assert.equal(await row.count(), 1, 'The saved paper must have one unambiguous recent-library entry');
    await row.click();
    await ready(document.id);
    await selected(number, document.id);
    if (viewport != null) await position(viewport, document.id);
  };
  const close = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    try { await bounded('Electron close', owned.close(), 15000); }
    catch (error) {
      fail(error);
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') await bounded('owned process termination', new Promise((resolve, reject) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
        }), 12000).catch(fail);
        else child.kill('SIGKILL');
      }
      throw error;
    } finally { app = null; }
  };
  const launch = async (paperId = id) => {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await bounded('native window size', app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setZoomFactor(1); window.setContentSize(1500, 900); window.show(); window.focus();
    }));
    await ready(paperId);
  };
  const chooseText = async (selector, quote) => {
    const node = page.locator(selector);
    await node.scrollIntoViewIfNeeded();
    await node.evaluate((host, quote) => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const start = text.textContent.indexOf(quote);
        if (start < 0) continue;
        const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + quote.length);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
      throw new Error(`Missing selection quote: ${quote}`);
    }, quote);
    await page.locator('.inspector-quote-text').getByText(quote, { exact: true }).waitFor();
  };
  const switchTab = async (name, paperId = id) => {
    await page.locator('.header-tools .tabs').getByRole('button', { name, exact: true }).click();
    await ready(paperId);
  };
  const pdfPage = async (number, zoom = 100) => {
    await ready(pdfId);
    await waitFor(async () => readPaper(pdfId).position.page === number && await evaluate(({ number, zoom }) => {
      const host = document.querySelector('.pdf-continuous[data-pdf-scope="pdf"]');
      if (!host || Number(host.dataset.pdfZoom) !== zoom) return false;
      const top = host.getBoundingClientRect().top + 36;
      const visible = [...host.querySelectorAll('.pdf-page-slot')].find(slot => {
        const box = slot.getBoundingClientRect();
        return box.top <= top && box.bottom > top;
      });
      const canvas = visible?.querySelector('canvas');
      return Number(visible?.dataset.pdfPage) === number && canvas?.width > 0 && canvas?.height > 0 &&
        visible.querySelector(`.textLayer[data-page="${number}"]`) &&
        document.querySelector('.pdf-toolbar')?.textContent.includes(`page ${number} of 2`) &&
        document.querySelector('[aria-label="PDF zoom level"]')?.textContent === `${zoom}%`;
    }, { number, zoom }), `PDF page ${number}: saved position, toolbar and visible rendered page at ${zoom}%`);
  };

  try {
    await launch();
    stage('Explain 2 remains selected after real wheel navigation to 12');
    await page.locator('#block-2').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await selected(2); await explainTarget(2);
    await wheelTo(12);
    await selected(2); await explainTarget(2);
    assert.equal(await page.locator('.document-outline [aria-current="location"]').count(), 0,
      'A selected body paragraph must not mark the containing viewport heading as selected');
    const offset12 = await scroll();

    stage('Current section follows viewport without changing the Inspector target');
    await page.getByRole('button', { name: 'Choose translation range', exact: true }).click();
    const range = page.getByRole('dialog', { name: 'Translation range', exact: true });
    await range.getByRole('button', { name: /^Current section: Methods/ }).waitFor();
    await selected(2);
    await range.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await explainTarget(2); await position(12);

    stage('Paper switch and complete restart restore independent selection and viewport');
    await openPaper(other, 3, 1);
    await openPaper(paper, 2, 12);
    assert.ok(Math.abs(await scroll() - offset12) < 2);
    await close(); await launch();
    await selected(2); await position(12); await explainTarget(2);
    assert.ok(Math.abs(await scroll() - offset12) < 2);

    stage('Explicit outline jump and Back/Forward restore both fields');
    await page.locator('.document-outline .outline-row[data-paragraph-id="19"]').click();
    await selected(19); await position(19);
    assert.equal(await page.locator('.document-outline [aria-current="location"]').getAttribute('data-paragraph-id'), '19');
    const back = page.getByRole('button', { name: 'Back to previous reading location', exact: true });
    const forward = page.getByRole('button', { name: 'Forward in reading history', exact: true });
    await back.click(); await selected(2); await position(12);
    await forward.click(); await selected(19); await position(19);
    await back.click(); await selected(2); await position(12);

    stage('Search selection survives clear while the original viewport returns');
    let search = page.getByRole('textbox', { name: 'Search original or translation', exact: true });
    await search.fill('Unique twentieth destination');
    await page.waitForFunction(() => document.querySelectorAll('.reader-list > .block').length === 1 && document.querySelector('#block-20'));
    await page.locator('#block-20').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await selected(20); await explainTarget(20);
    assert.equal(readPaper().position.block, 12, 'Filtered results must not overwrite the unfiltered viewport');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await position(12); await selected(20); await explainTarget(20);
    await switchTab('Overview'); await switchTab('Reader');
    await position(12); await selected(20);

    stage('Reader keyboard selection starts at the viewport, then preserves an existing caret');
    await evaluate(() => { window.getSelection().removeAllRanges(); document.querySelector('.reader-list').focus({ preventScroll: true }); });
    await page.keyboard.press('Shift+ArrowRight');
    await selected(12);
    assert.match(await page.locator('.selection-meta').textContent(), /BLOCK 12/);
    assert.equal(await evaluate(() => window.getSelection().anchorNode.parentElement.closest('[data-block-id]')?.dataset.blockId), '12');
    await page.locator('#block-14 .source-text').evaluate(host => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      window.getSelection().collapse(walker.nextNode(), 0);
      document.querySelector('.reader-list').focus({ preventScroll: true });
    });
    await page.keyboard.press('Control+Shift+ArrowRight');
    await selected(14);
    assert.match(await page.locator('.selection-meta').textContent(), /BLOCK 14/);
    await chooseText('#block-3 .source-text', 'Passage 3.');
    await selected(3);

    stage('Paper, Overview and Full Translation selections keep the Reader selection');
    await switchTab('Paper');
    await chooseText('[data-paper-block-id="20"] [data-paper-kind="source"]', 'Unique twentieth destination.');
    await selected(3);
    for (const [tab, selector, quote] of [
      ['Overview', '[data-view-scope="summarySource"] [data-markdown-host]', 'A source summary keeps its own selection scope.'],
      ['Overview', '[data-view-scope="summaryTarget"] [data-markdown-host]', '译文摘要保留自己的选择范围。'],
      ['Full Translation', '[data-view-scope="fullTranslation"] [data-markdown-host]', 'A connected translation keeps its own selection scope.']
    ]) {
      await switchTab(tab); await chooseText(selector, quote); await selected(3);
    }
    await switchTab('Reader'); await selected(3);

    stage('Original PDF exact text selection does not select its matching Reader block');
    await openPaper(pdf, 2);
    await page.locator('.textLayer[data-page="1"]').waitFor();
    await chooseText('.textLayer[data-page="1"]', 'Original PDF selection stays independent.');
    await selected(2, pdfId);
    assert.match(await page.locator('.selection-meta').textContent(), /ORIGINAL PDF/);

    stage('Cross-tab structural Undo restores the actual PDF page while retaining the current mode and zoom');
    await pdfPage(1);
    await switchTab('Reader', pdfId);
    await page.locator('#block-2').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    const pdfEditor = page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true });
    const beforePdfText = readPaper(pdfId).blocks[1].text;
    const revisedPdfText = `${beforePdfText.trimEnd()} Repaired before visiting the second PDF page.`;
    await pdfEditor.getByRole('textbox', { name: 'Paragraph source', exact: true }).fill(revisedPdfText);
    await pdfEditor.getByRole('button', { name: 'Save', exact: true }).click();
    await pdfEditor.waitFor({ state: 'hidden' });
    await waitFor(() => readPaper(pdfId).blocks[1].text === revisedPdfText, 'PDF Reader repair saved');
    await ready(pdfId);
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).check();
    await switchTab('Original', pdfId);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await pdfPage(2);
    await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await pdfPage(2, 125);
    await waitFor(() => readPaper(pdfId).position.pdfZoom?.pdf === 125 && readPaper(pdfId).position.displayMode === 'translation',
      'post-edit PDF zoom and reading mode saved');
    await page.locator('.inspector-title').getByRole('button', { name: 'Undo last highlight or note change', exact: true }).click();
    await waitFor(() => readPaper(pdfId).blocks[1].text === beforePdfText, 'PDF structural Undo saved');
    await pdfPage(1, 125);
    await selected(2, pdfId);
    assert.equal(await page.locator('.header-tools .tabs .active').textContent(), 'Original', 'Undo must retain the current tab');
    assert.equal(readPaper(pdfId).position.displayMode, 'translation', 'Undo must retain the post-edit display mode');
    assert.equal(readPaper(pdfId).position.pdfZoom.pdf, 125, 'Undo must retain the post-edit PDF zoom');

    stage('Restart keeps the restored PDF page, mode and zoom in agreement');
    await close(); await launch(pdfId);
    await pdfPage(1, 125);
    await selected(2, pdfId);
    assert.equal(await page.locator('.header-tools .tabs .active').textContent(), 'Original');
    assert.equal(readPaper(pdfId).position.displayMode, 'translation');
    assert.equal(readPaper(pdfId).position.pdfZoom.pdf, 125);
    await switchTab('Reader', pdfId);
    assert.equal(await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).isChecked(), true,
      'The current display mode must also be restored in the actual Reader controls');
    await openPaper(paper, 3);
    search = page.getByRole('textbox', { name: 'Search original or translation', exact: true });

    stage('Split and structural Undo preserve an independently located viewport');
    await wheelTo(12);
    const beforeEditOffset = await scroll();
    await page.locator('#block-13').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Repair Paragraph 13', exact: true });
    await selected(13);
    assert.equal(await firstVisible(), 12, 'Opening a visible neighboring paragraph editor must keep the top paragraph');
    await editor.getByRole('textbox', { name: 'Paragraph source', exact: true }).fill('First editable sentence.\n\nSecond editable sentence.');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await waitFor(() => readPaper().blocks.length === 25, 'paragraph split saved');
    await selected(13); await position(12);
    await wheelTo(21); await selected(13);
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await waitFor(() => readPaper().blocks.length === 24, 'structural undo saved');
    await selected(13); await position(12);
    assert.ok(Math.abs(await scroll() - beforeEditOffset) < 2, 'Undo must restore the pre-edit viewport independently of selection');
    assert.equal(readPaper().blocks[12].text, blocks[12].text);

    stage('Merge Undo restores the previous offscreen selection, not the merge target');
    await search.fill('Passage 2.');
    await page.waitForFunction(() => document.querySelectorAll('.reader-list > .block').length === 1 && document.querySelector('#block-2'));
    await page.locator('#block-2').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await selected(2);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await position(12); await selected(2);
    await page.locator('#block-12').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    // The menu trigger may need a few pixels of native reveal when paragraph 12
    // begins above the clipped viewport. Snapshot the actual action-time position.
    const beforeMergeOffset = await scroll();
    await page.getByRole('menuitem', { name: 'Merge with Next', exact: true }).click();
    await waitFor(() => readPaper().blocks.length === 23, 'paragraph merge saved');
    await selected(12); await position(12);
    await wheelTo(20); await selected(12);
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await waitFor(() => readPaper().blocks.length === 24, 'merge undo saved');
    await selected(2); await position(12); await explainTarget(2);
    const afterMergeUndoOffset = await scroll();
    assert.ok(Math.abs(afterMergeUndoOffset - beforeMergeOffset) < 2,
      `Merge Undo offset ${afterMergeUndoOffset} must restore the action-time offset ${beforeMergeOffset}`);
    assert.deepEqual(errors, []);
    assert.equal(generationRequests, 0, 'Selecting an explanation target must not request model generation');
  } catch (error) {
    fail(error);
    const diagnostics = { phase, paper: readPaper(), pdf: readPaper(pdfId), renderer: page && !page.isClosed() ? await bounded('failure diagnostics', page.evaluate(() => ({
      tab: document.querySelector('.tabs .active')?.textContent, selected: document.querySelector('.block.current')?.id,
      explanation: document.querySelector('.paragraph-explanation')?.textContent, scroll: document.querySelector('.main-scroll')?.scrollTop,
      pdfToolbar: document.querySelector('.pdf-toolbar')?.textContent,
      pdfScroll: document.querySelector('.pdf-continuous')?.scrollTop,
      viewport: { width: innerWidth, height: innerHeight }, active: document.activeElement?.outerHTML.slice(0, 600)
    })), 3000).catch(cause => ({ error: cause.message })) : { closed: true } };
    fs.writeFileSync(path.join(workspace, 'failure.json'), JSON.stringify(diagnostics, null, 2));
    if (app) await bounded('failure screenshot', app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => image.toDataURL())), 5000)
      .then(data => fs.writeFileSync(path.join(workspace, 'failure.png'), Buffer.from(data.split(',')[1], 'base64'))).catch(cause => console.error(cause));
  } finally {
    await close().catch(fail);
    server.closeAllConnections();
    await bounded('fixture service close', new Promise(resolve => server.close(resolve)), 3000).catch(fail);
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ stages, generationRequests, errors }, null, 2));
  console.log(`Paragraph selection passed: independent viewport, Inspector, current section, paper switch/restart, history, search, keyboard, scope boundaries, split and Undo, cross-tab PDF Undo/restart with retained mode and zoom. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
