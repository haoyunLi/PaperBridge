const { revealSidebarSource } = require('./sidebar-controls.cjs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Atomic writes may briefly move the file. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function fixturePdf() {
  const stream = 'BT /F1 12 Tf 42 720 Td (Paragraph editor preflight fixture.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'paragraph-editor-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  const id = crypto.createHash('sha256').update('Paragraph editor annotation fixture').digest('hex');
  const otherId = crypto.createHash('sha256').update('Paragraph editor unrelated library fixture').digest('hex');
  const requests = [];
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.end(JSON.stringify({ response: '编辑后生成且应保留的新译文。', done: true }));
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`,
    translationModel: 'translategemma:4b', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
    autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const defaults = { heading: false, status: 'ok', bookmark: false, highlights: [], translationHighlights: [], notes: [] };
  const blocks = [
    { ...defaults, id: 1, text: 'Earlier source text remains unchanged throughout paragraph repair.', translation: 'Earlier saved translation.' },
    { ...defaults, id: 2, text: 'First sentence. Second sentence.', translation: '第一句话。第二句话。', bookmark: true,
      notes: [
        { id: 'exact-note', scope: 'reader', kind: 'source', text: 'Second', offset: 16, body: 'Keep this exact source note.' },
        { id: 'crossing-note', scope: 'reader', kind: 'source', text: 'sentence. Second', offset: 6, body: 'Crossing note must be retained for review.' }
      ],
      highlights: [{ id: 'second-highlight', scope: 'reader', text: 'Second', offset: 16, color: 'amber' }],
      translationHighlights: [{ id: 'translation-highlight', scope: 'reader', text: '第二句话', offset: 5, color: 'teal' }] },
    { ...defaults, id: 3, text: 'Later source text has an independently reviewed translation.', translation: 'Later saved translation.' }
  ];
  const paper = { id, name: 'Paragraph editor fixture', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inspectorOpen: false,
    taskSettings: settings, blocks, position: { tab: 'Reader', block: 2, displayMode: 'bilingual' } };
  const other = { ...paper, id: otherId, name: 'Other untouched paper', blocks: [{ ...defaults, id: 1,
    text: 'The other library document must never receive an editor draft.', translation: 'Other saved translation.' }] };
  const pdfBytes = fixturePdf();
  const pdfId = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const pdfPaper = { ...paper, id: pdfId, name: 'Editor PDF preflight fixture', type: 'pdf',
    sourceMode: 'pdf', extraction: 'PDF.js', pdfBlocks: blocks };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = (paperId = id) => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  fs.writeFileSync(paperFile(id), JSON.stringify(paper));
  fs.writeFileSync(paperFile(otherId), JSON.stringify(other));
  fs.writeFileSync(paperFile(pdfId), JSON.stringify(pdfPaper));
  fs.mkdirSync(path.join(workspace, 'pdfs'));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${pdfId}.pdf`), pdfBytes);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  let app, page;
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('#block-2').waitFor({ timeout: 20000 });
  };
  const dialog = () => page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true });
  const source = () => dialog().getByRole('textbox', { name: 'Paragraph source', exact: true });
  const save = () => dialog().getByRole('button', { name: 'Save', exact: true });
  const trigger = () => page.locator('#block-2').getByRole('button', { name: 'Paragraph actions', exact: true });
  const openEditor = async () => {
    await trigger().click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    await dialog().waitFor();
    await waitFor(() => source().evaluate(node => node === document.activeElement), 'editor focus');
  };
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await launch();
    await app.evaluate(({ dialog }) => {
      globalThis.__editorOpenDialogs = 0;
      dialog.showOpenDialog = async () => { globalThis.__editorOpenDialogs++; return { canceled: true, filePaths: [] }; };
    });
    const baseline = readPaper().blocks;
    const otherBaseline = readPaper(otherId).blocks;
    await openEditor();
    assert.equal(await source().inputValue(), blocks[1].text);
    assert.equal(await source().evaluate(node => getComputedStyle(node).fontSize), '15px');
    await source().fill('A👩‍👩‍👧‍👦é🇨🇳');
    await dialog().getByText(/^4 characters\./).waitFor();
    await source().evaluate(node => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      node.closest('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    assert.equal(await dialog().isVisible(), true, 'IME confirmation and dismissal must not save or close the paragraph editor');
    assert.equal(await source().inputValue(), 'A👩‍👩‍👧‍👦é🇨🇳');
    assert.deepEqual(readPaper().blocks, baseline);
    await source().fill('  \n \n  ');
    assert.equal(await save().isDisabled(), true);
    await page.keyboard.press('Control+Enter');
    assert.equal(await dialog().isVisible(), true);
    assert.deepEqual(readPaper().blocks, baseline);
    await source().fill('First sentence.');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Second sentence.');
    assert.equal(await source().inputValue(), 'First sentence.\nSecond sentence.', 'ordinary Enter edits text instead of submitting');
    assert.deepEqual(readPaper().blocks, baseline);
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog().evaluate(node => node.contains(document.activeElement)), true, 'Tab stays inside the modal editor');
    }
    await source().focus();
    const draft = 'Unsaved editor draft must survive background actions.';
    await source().fill(draft);
    await waitFor(async () => app.evaluate(({ Menu }) => ['openPdf', 'library', 'primaryTask', 'generateSummary', 'settings']
      .every(command => Menu.getApplicationMenu().getMenuItemById(`command:${command}`)?.enabled === false)), 'native commands disabled while repairing');
    // A click where the other paper sits must hit the modal backdrop, not switch papers.
    const otherRow = await page.locator('.library-row').filter({ hasText: other.name }).boundingBox();
    assert.ok(otherRow);
    await page.mouse.click(otherRow.x + 8, otherRow.y + otherRow.height / 2);
    assert.equal(await dialog().isVisible(), true);
    assert.equal(await source().inputValue(), draft);
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      for (const command of ['openPdf', 'library', 'primaryTask', 'generateSummary', 'settings', 'undo', 'readingBack']) {
        contents.send('paperbridge:command', command);
      }
    });
    await frames();
    assert.equal(await dialog().isVisible(), true, 'stale native commands cannot replace the modal editor');
    assert.equal(await source().inputValue(), draft);
    assert.equal(await app.evaluate(() => globalThis.__editorOpenDialogs), 0);
    assert.equal(requests.length, 0);
    assert.deepEqual(readPaper().blocks, baseline);
    assert.deepEqual(readPaper(otherId).blocks, otherBaseline);
    await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog().waitFor({ state: 'hidden' });
    await waitFor(() => trigger().evaluate(node => node === document.activeElement), 'Cancel restores actions focus');
    assert.deepEqual(readPaper().blocks, baseline);
    await openEditor();
    await source().fill('Another unsaved draft.');
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'hidden' });
    assert.deepEqual(readPaper().blocks, baseline);
    await waitFor(() => trigger().evaluate(node => node === document.activeElement), 'Escape restores actions focus');

    // A library-label operation started before the editor must not replace it
    // when its asynchronous load/save completes after the old dialog is closed.
    await page.getByRole('button', { name: 'Paper Library', exact: true }).click();
    await page.getByRole('button', { name: `Edit label for ${other.name}`, exact: true }).click();
    await page.getByLabel('Tags, separated by commas', { exact: true }).fill('background-label');
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('paper:load');
      ipcMain.removeHandler('paper:load');
      let hold = true;
      ipcMain.handle('paper:load', (event, paperId) => {
        if (!hold) return original(event, paperId);
        hold = false;
        return new Promise((resolve, reject) => {
          globalThis.__finishEditorLabelLoad = () => Promise.resolve(original(event, paperId)).then(resolve, reject);
        });
      });
    });
    await page.getByRole('button', { name: 'Save label', exact: true }).click();
    await waitFor(() => app.evaluate(() => typeof globalThis.__finishEditorLabelLoad === 'function'), 'held library-label load');
    await page.keyboard.press('Escape');
    await openEditor();
    await source().fill(draft);
    await app.evaluate(() => globalThis.__finishEditorLabelLoad());
    await waitFor(() => readPaper(otherId).tags?.includes('background-label'), 'late label save finished');
    await frames();
    assert.equal(await dialog().isVisible(), true);
    assert.equal(await source().inputValue(), draft, 'late library completion preserves the active paragraph draft');
    assert.deepEqual(readPaper().blocks, baseline);
    assert.deepEqual(readPaper(otherId).blocks, otherBaseline);
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'hidden' });

    const longDraft = ('A long editable paragraph needs its own scrollable text region. '.repeat(25) + '\n').repeat(25);
    for (const sample of [{ width: 980, height: 620, zoom: 1 }, { width: 1960, height: 1240, zoom: 2 }]) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), sample.zoom);
      await openEditor();
      await source().fill(longDraft);
      await source().press('Control+End');
      const layout = await dialog().evaluate(node => {
        const r = node.getBoundingClientRect();
        const text = node.querySelector('textarea');
        const footer = node.querySelector('button:last-of-type').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
          horizontalOverflow: node.scrollWidth - node.clientWidth, editorScrollable: text.scrollHeight > text.clientHeight,
          editorScroll: text.scrollTop, footerTop: footer.top, footerBottom: footer.bottom };
      });
      assert.ok(layout.left >= 0 && layout.top >= 0 && layout.right <= layout.viewportWidth + 1 && layout.bottom <= layout.viewportHeight + 1, JSON.stringify(layout));
      assert.ok(layout.horizontalOverflow <= 1 && layout.editorScrollable && layout.editorScroll > 0, JSON.stringify(layout));
      assert.ok(layout.footerTop >= layout.top && layout.footerBottom <= layout.bottom, JSON.stringify(layout));
      assert.equal(await source().inputValue(), longDraft);
      await page.screenshot({ path: path.join(workspace, `paragraph-editor-zoom-${sample.zoom}.png`) });
      await page.keyboard.press('Escape');
      await dialog().waitFor({ state: 'hidden' });
      assert.deepEqual(readPaper().blocks, baseline);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.setViewportSize({ width: 1320, height: 820 });

    // Save through the keyboard route, splitting only the selected source block.
    await openEditor();
    await source().fill(' First sentence.\n \nSecond\n  sentence. ');
    await page.keyboard.press('Control+Enter');
    await dialog().waitFor({ state: 'hidden' });
    await waitFor(() => readPaper().blocks.length === 4, 'split saved');
    const split = readPaper().blocks;
    assert.deepEqual(split.map(item => item.text), [blocks[0].text, 'First sentence.', 'Second sentence.', blocks[2].text]);
    assert.equal(split[0].translation, blocks[0].translation);
    assert.equal(split[3].translation, blocks[2].translation);
    assert.ok(split.slice(1, 3).every(item => item.bookmark && item.status === 'pending' && !item.translation));
    assert.equal(split[2].notes.find(note => note.id === 'exact-note').offset, 0);
    assert.equal(split[2].notes.find(note => note.id === 'exact-note').needsReview, false);
    assert.equal(split[2].highlights.find(mark => mark.id === 'second-highlight').offset, 0);
    assert.equal(split.flatMap(item => item.notes).find(note => note.id === 'crossing-note').needsReview, true);
    assert.equal(split.flatMap(item => item.translationHighlights || []).find(mark => mark.id === 'translation-highlight').needsReview, true);
    assert.deepEqual(readPaper(otherId).blocks, otherBaseline);

    // A newer unrelated translation must survive undoing the earlier source edit.
    await page.locator('#block-4').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
    await waitFor(() => readPaper().blocks[3].translation === '编辑后生成且应保留的新译文。', 'unrelated post-edit translation');
    await page.locator('.reader-top .undo-button').click();
    await waitFor(() => readPaper().blocks.length === 3, 'undo saved');
    const restored = readPaper().blocks;
    assert.equal(restored[1].text, blocks[1].text);
    assert.equal(restored[1].translation, blocks[1].translation);
    assert.deepEqual(restored[1].notes, baseline[1].notes);
    assert.deepEqual(restored[1].highlights, baseline[1].highlights);
    assert.deepEqual(restored[1].translationHighlights, baseline[1].translationHighlights);
    assert.equal(restored[2].translation, '编辑后生成且应保留的新译文。');
    assert.equal(requests.length, 1);
    await app.close(); app = null;
    await launch();
    await page.locator('#block-2 .source-text mark').getByText('Second', { exact: true }).waitFor();
    assert.deepEqual(readPaper().blocks[1].notes, baseline[1].notes);
    assert.equal(readPaper().blocks[2].translation, '编辑后生成且应保留的新译文。');

    await page.locator('.library-row').filter({ hasText: pdfPaper.name }).click();
    await page.getByRole('heading', { name: pdfPaper.name, exact: true }).waitFor();
    await app.evaluate(({ ipcMain }) => {
      globalThis.__editorMineruExtractions = 0;
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => new Promise(resolve => { globalThis.__editorMineruStatus = resolve; }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => { globalThis.__editorMineruExtractions++; throw new Error('Extraction must not begin under an active editor'); });
    });
    for (const compatible of [false, true]) {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.getByRole('button', { name: 'Parse with MinerU', exact: true }).click();
      await waitFor(() => app.evaluate(() => typeof globalThis.__editorMineruStatus === 'function'), 'held MinerU preflight');
      await openEditor();
      await source().fill(draft);
      await app.evaluate((_electron, compatible) => {
        globalThis.__editorMineruStatus({ compatible, installed: compatible, executable: 'C:\\fixture\\mineru.exe', reason: 'Fixture preflight result' });
        globalThis.__editorMineruStatus = null;
      }, compatible);
      await frames();
      assert.equal(await dialog().isVisible(), true);
      assert.equal(await source().inputValue(), draft);
      assert.equal(await page.getByRole('dialog', { name: 'Local AI setup', exact: true }).count(), 0);
      assert.equal(await app.evaluate(() => globalThis.__editorMineruExtractions), 0);
      assert.equal(await page.locator('.task-progress').count(), 0);
      assert.deepEqual(readPaper(pdfId).blocks, pdfPaper.blocks);
      await page.keyboard.press('Escape');
      await dialog().waitFor({ state: 'hidden' });
    }

    // Clear only this test's isolated workspace. A reset completing after a
    // new editor opens must close the erased document and release its modal lock.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('paper:clear-data');
      ipcMain.removeHandler('paper:clear-data');
      ipcMain.handle('paper:clear-data', event => new Promise((resolve, reject) => {
        globalThis.__finishEditorClearData = () => Promise.resolve(original(event)).then(resolve, reject);
      }));
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Local Data', exact: true }).click();
    await page.getByRole('button', { name: 'Remove all saved PaperBridge data…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove saved data', exact: true }).click();
    await waitFor(() => app.evaluate(() => typeof globalThis.__finishEditorClearData === 'function'), 'held isolated data reset');
    await page.keyboard.press('Escape');
    await openEditor();
    await source().fill(draft);
    await app.evaluate(() => globalThis.__finishEditorClearData());
    await page.locator('.welcome').waitFor();
    assert.equal(await page.getByRole('dialog', { name: /^Repair Paragraph/ }).count(), 0);
    await waitFor(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('command:openPdf')?.enabled === true), 'editor modal lock released after reset');
    assert.equal(fs.existsSync(paperFile(pdfId)), false);
    assert.deepEqual(fs.readFileSync(path.join(workspace, 'pdfs', `${pdfId}.pdf`)), pdfBytes, 'reset retains original PDF bytes');
    await revealSidebarSource(page);
    await page.locator('.sidebar').getByRole('button', { name: 'Paste Text', exact: true }).click();
    await page.locator('.paste-area').fill('A fresh document opens after the old editor was reset.');
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor();
    const result = { passed: true, workspace, requests: requests.length, checked: [
      'dialog focus, grapheme count, IME and blank-save guard', 'Enter newline and Ctrl+Enter save',
      'Cancel, Escape and outside clicks retain saved text', 'native commands and background library cannot replace draft',
      'late library-label completion cannot replace the active editor',
      'long text scroll at 980x620 and 200% zoom', 'split annotation migration and selective translation invalidation',
      'undo preserves newer unrelated output', 'restart annotations and translations',
      'MinerU preflight cannot replace an active editor', 'isolated data reset closes erased drafts and releases commands'
    ] };
    fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
