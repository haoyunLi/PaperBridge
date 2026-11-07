const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout = 15000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; }
    catch { /* Rendering and the disk save settle independently. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
function samplePdf() {
  const stream = 'BT /F1 18 Tf 72 720 Td (Original PDF saved phrase.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
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
  const workspace = fs.mkdtempSync(path.join(artifacts, 'saved-annotations-'));
  for (const directory of ['papers', 'pdfs']) fs.mkdirSync(path.join(workspace, directory));
  let generationRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ models: [] }));
  });
  await bounded('fixture server', new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${server.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const id = 'e'.repeat(64), at = day => `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`;
  const source = 'Alpha saved phrase is evidence. Beta saved phrase remains separate.';
  const longQuote = 'Long preserved quotation. ' + '完整引用🙂 keeps its context and precise source. '.repeat(7) + 'UNIQUE_QUOTE_END';
  const longBody = 'Historical note begins. ' + 'Multiline evidence must remain accessible.\n'.repeat(7) + 'UNIQUE_NOTE_END';
  const reader = { id: 'reader-current', kind: 'source', scope: 'reader', text: 'Alpha saved phrase', offset: 0, body: 'Reader current note.', createdAt: at(2) };
  const beta = { id: 'reader-other', kind: 'source', scope: 'reader', text: 'Beta saved phrase', offset: source.indexOf('Beta'), body: 'Other Reader note.', createdAt: at(3) };
  const translated = { id: 'reader-translation', kind: 'translation', scope: 'reader', text: reader.text, offset: 0, body: 'Translation side note.', createdAt: at(4) };
  const historical = { id: 'historical-one', kind: 'source', scope: 'reader', text: longQuote, offset: 0, body: longBody, createdAt: at(12) };
  const historicalTwo = { ...historical, body: 'A distinct historical note body at the same precise anchor.', createdAt: at(13) };
  const review = { id: 'legacy-review', kind: 'source', scope: 'reader', text: `Saved obsolete quote. ${longQuote}`, offset: 0,
    body: 'Legacy review note. ' + longBody, needsReview: true };
  const view = { id: 'view-current', scope: 'summarySource', text: 'Summary saved phrase', offset: 0, body: 'Source summary note.', createdAt: at(9) };
  const targetView = { id: 'view-target', scope: 'summaryTarget', text: '目标摘要', offset: 0, body: 'Target summary note.', createdAt: at(6) };
  const full = { id: 'view-full', scope: 'fullTranslation', text: '完整译文', offset: 0, body: 'Connected full translation note.', createdAt: at(7) };
  const pdf = { id: 'pdf-current', scope: 'pdf', page: 1, offset: 0, text: 'Original PDF saved phrase.', quote: 'Original PDF saved phrase.', body: 'Original PDF note.', createdAt: at(11) };
  const paperPdf = { ...pdf, id: 'paper-pdf', scope: 'paperPdf', body: 'Exact Paper PDF note.', createdAt: at(5) };
  const mark = (note, id, color, day) => { const { body, ...anchor } = note; return { ...anchor, id, color, ...(day && { createdAt: at(day) }) }; };
  const readerMark = mark(reader, 'reader-mark', 'amber', 1), viewMark = mark(view, 'view-mark', 'teal', 8), pdfMark = mark(pdf, 'pdf-mark', 'coral', 10);
  const paper = { id, name: 'Saved annotation behavior.pdf', type: 'pdf', sourceMode: 'pdf', extraction: 'PDF.js',
    blocks: [{ id: 1, text: source, translation: 'Alpha saved phrase 原译文应清楚区分。', translationLanguage: { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
      status: 'ok', page: 1, notes: [reader, beta, translated], highlights: [readerMark], translationHighlights: [] },
    { id: 2, text: longQuote, translation: '', status: 'pending', page: 1, notes: [historical, historicalTwo, review],
      highlights: [mark(historical, 'historical-mark', 'amber', 12), mark(review, 'review-mark', 'coral')], translationHighlights: [] }],
    summary: { source: 'Summary saved phrase remains available.', target: '目标摘要保留原有笔记。', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [] },
    connectedTranslation: '完整译文保留原有笔记。', connectedLanguage: { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
    viewNotes: [view, targetView, full], viewHighlights: [viewMark], pdfNotes: [pdf, paperPdf], pdfHighlights: [pdfMark],
    taskSettings: settings, inspectorOpen: true, selectedParagraphID: 1, position: { tab: 'Reader', block: 1, page: 1, displayMode: 'bilingual' }, createdAt: at(1) };
  const paperFile = path.join(workspace, 'papers', `${id}.json`), readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  fs.writeFileSync(paperFile, JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${id}.pdf`), samplePdf());
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  let app, page, failure, phase = 'launch';
  const stages = [], errors = [];
  const stage = label => { phase = label; stages.push(label); console.log(`[saved-annotations] ${label}`); };
  const fail = error => { failure ||= error; console.error(`[saved-annotations] ${phase}: ${error.stack || error}`); };
  const row = body => page.locator('.saved-annotations .annotation-row').filter({ has: page.locator('.annotation-note').getByText(body, { exact: true }) });
  const keyed = key => page.locator(`.saved-annotations .annotation-row[data-annotation-key=${JSON.stringify(key)}]`);
  const editor = () => page.getByRole('textbox', { name: 'Note for selected passage', exact: true });
  const undo = () => page.locator('.inspector-title').getByRole('button', { name: 'Undo last highlight or note change', exact: true }).click();
  const ready = () => page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id &&
    document.querySelector('.main-scroll')?.getAttribute('aria-busy') === 'false', id);
  const count = async expected => {
    await waitFor(async () => await page.locator('.saved-annotations .annotation-row').count() === expected, `${expected} unified annotation rows`);
    assert.match(await page.locator('.saved-annotations > small').textContent(), new RegExp(`\\b${expected}$`));
  };
  const open = async note => {
    assert.equal(await row(note.body).count(), 1, 'Each exact note body identifies its annotation group');
    await row(note.body).locator('.annotation-navigate').click();
    await waitFor(async () => await editor().inputValue() === note.body, `note ${note.id} opens in editor`);
    assert.equal(await page.locator('.inspector-quote-text').textContent(), note.quote ?? note.text);
  };
  const launch = async () => {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first window', app.firstWindow(), 30000); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setZoomFactor(1); win.setContentSize(1500, 900); win.show(); win.focus(); });
    await ready();
  };
  const close = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    try { await bounded('close Electron', owned.close()); }
    catch (error) {
      fail(error);
      if (process.platform === 'win32' && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        await bounded('terminate owned Electron', new Promise((resolve, reject) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
        }), 12000).catch(fail);
      }
      throw error;
    } finally { app = null; }
  };
  try {
    await launch();
    stage('Unified groups, exact labels and newest-created ordering preserve distinct historical bodies');
    await count(10);
    const orderedBodies = [historical.body, pdf.body, view.body, full.body, targetView.body, paperPdf.body, translated.body, beta.body, reader.body, review.body];
    const initialKeys = await page.locator('.annotation-row').evaluateAll(nodes => nodes.map(node => node.dataset.annotationKey));
    assert.equal(new Set(initialKeys).size, 10);
    assert.deepEqual(await page.locator('.annotation-row').evaluateAll(nodes => nodes.map(node => node.querySelector('.annotation-note')?.textContent)), orderedBodies);
    for (const [note, label] of [[reader, 'Reader · Block 1 · Original'], [translated, 'Reader · Block 1 · Translation'],
      [view, 'Source Summary · Original'], [targetView, 'Target Summary · Translation'], [full, 'Full Translation · Translation'],
      [pdf, 'Original PDF · page 1'], [paperPdf, 'Paper · exact PDF · page 1']]) {
      assert.equal(await row(note.body).locator('.annotation-label').textContent(), label);
    }
    assert.match(await row(view.body).locator('.annotation-colors').textContent(), /Cobalt/);
    const historyRow = row(historical.body);
    assert.equal(await historyRow.locator('.annotation-note').count(), 2);
    assert.equal(await historyRow.locator('.annotation-note').nth(1).textContent(), historicalTwo.body);
    for (const [index, note] of [historical, historicalTwo].entries()) {
      const button = historyRow.getByRole('button', { name: `Delete note historical-one (${index + 1} of 2)`, exact: true });
      assert.equal(await button.count(), 1, 'Duplicate-ID records need individually identifiable delete actions');
      assert.equal(await button.getAttribute('title'), `Delete note only: ${note.body}`);
    }

    stage('Full DOM quote and note text remain available behind two-line previews at wide and narrow widths');
    for (const width of [1500, 980]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      await waitFor(() => page.evaluate(width => innerWidth === width, width), `window width ${width}`);
      await historyRow.scrollIntoViewIfNeeded();
      const preview = await historyRow.evaluate(node => {
        const quote = node.querySelector('.annotation-quote'), note = node.querySelector('.annotation-note');
        const box = node.getBoundingClientRect();
        return { quote: quote.textContent, body: note.textContent, quoteClamp: getComputedStyle(quote).webkitLineClamp,
          noteClamp: getComputedStyle(note).webkitLineClamp, whitespace: getComputedStyle(quote).whiteSpace,
          width: node.clientWidth, scrollWidth: node.scrollWidth,
          actionsWithin: [...node.querySelectorAll('.annotation-actions button')].every(button => {
            const action = button.getBoundingClientRect(); return action.left >= box.left - 1 && action.right <= box.right + 1;
          }) };
      });
      assert.equal(preview.quote, longQuote); assert.equal(preview.body, longBody);
      assert.equal(preview.quoteClamp, '2'); assert.equal(preview.noteClamp, '2'); assert.equal(preview.whitespace, 'pre-wrap');
      assert.ok(preview.scrollWidth <= preview.width + 1 && preview.actionsWithin, `Preview/actions must fit at ${width}`);
      await page.screenshot({ path: path.join(workspace, `saved-preview-${width}.png`), fullPage: false });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 900));
    await ready();

    for (const [scope, note, highlight, deleteLabel, notesFor, marksFor] of [
      ['Reader', reader, readerMark, 'Delete note reader-current', current => current.blocks[0].notes, current => current.blocks[0].highlights],
      ['Source Summary', view, viewMark, 'Delete view note view-current', current => current.viewNotes, current => current.viewHighlights],
      ['Original PDF', pdf, pdfMark, 'Delete PDF note pdf-current', current => current.pdfNotes, current => current.pdfHighlights]
    ]) {
      stage(`${scope}: deleting the current note clears its draft and one Undo restores it`);
      await open(note);
      const key = await row(note.body).getAttribute('data-annotation-key');
      await row(note.body).getByRole('button', { name: deleteLabel, exact: true }).click();
      await waitFor(() => !notesFor(readPaper()).some(item => item.id === note.id), `${scope} note deletion saved`);
      assert.equal(await editor().inputValue(), '');
      assert.ok(marksFor(readPaper()).some(item => item.id === highlight.id), 'Deleting only the note must retain its highlight');
      await count(10); assert.equal(await keyed(key).locator('.annotation-note').count(), 0);
      await undo();
      await waitFor(() => notesFor(readPaper()).some(item => item.id === note.id && item.body === note.body), `${scope} Undo restores original note ID/body`);
      assert.equal(await editor().inputValue(), note.body);
      stage(`${scope}: Delete annotation removes note and highlight atomically with one Undo`);
      await row(note.body).getByRole('button', { name: /^Delete annotation / }).click();
      await waitFor(() => !notesFor(readPaper()).some(item => item.id === note.id) && !marksFor(readPaper()).some(item => item.id === highlight.id), `${scope} combined deletion saved`);
      assert.equal(await editor().inputValue(), ''); await count(9);
      assert.equal(await keyed(key).count(), 0);
      await undo();
      await waitFor(() => notesFor(readPaper()).some(item => item.id === note.id) && marksFor(readPaper()).some(item => item.id === highlight.id), `${scope} one Undo restores both records`);
      assert.equal(await editor().inputValue(), note.body); await count(10);
    }

    stage('Deleting a different note preserves the current typing session and Undo does not discard its text');
    await open(reader);
    const typedBody = `${reader.body} Newly typed evidence must survive deleting another note.`;
    await editor().fill(typedBody);
    await row(beta.body).getByRole('button', { name: 'Delete note reader-other', exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].notes.some(note => note.id === beta.id) &&
      readPaper().blocks[0].notes.find(note => note.id === reader.id)?.body === typedBody, 'noncurrent delete and current draft persisted');
    assert.equal(await editor().inputValue(), typedBody); await count(9);
    await undo();
    await waitFor(() => readPaper().blocks[0].notes.some(note => note.id === beta.id), 'Undo restores only the other note');
    assert.equal(await editor().inputValue(), typedBody);
    assert.equal(readPaper().blocks[0].notes.find(note => note.id === reader.id).body, typedBody); await count(10);

    stage('Friendly labels still navigate exact sides/scopes and invalid legacy anchors remain preserved');
    for (const [note, tab, side] of [[translated, 'Reader', 'TRANSLATION'], [targetView, 'Overview', 'TRANSLATION'],
      [full, 'Full Translation', 'TRANSLATION'], [paperPdf, 'Paper', 'ORIGINAL'], [historical, 'Reader', 'ORIGINAL']]) {
      await open(note);
      assert.equal(await page.locator('.header-tools .tabs .active').textContent(), tab);
      assert.match(await page.locator('.selection-meta').textContent(), new RegExp(side));
    }
    assert.equal(await editor().inputValue(), longBody);
    await row(review.body).locator('.annotation-navigate').click();
    await page.getByText('The saved Reader text no longer matches this block. The annotation was kept for review.', { exact: true }).waitFor();
    assert.equal(await editor().inputValue(), longBody, 'An invalid saved quote must not replace the valid active selection');
    assert.equal(await row(review.body).locator('.annotation-quote').textContent(), review.text);
    assert.equal(await row(review.body).locator('.annotation-note').textContent(), review.body);
    assert.ok(readPaper().blocks[1].notes.some(note => note.id === review.id && note.needsReview));
    assert.equal(readPaper().blocks[1].notes.find(note => note.id === review.id).createdAt, undefined, 'Do not invent an age for legacy annotations');

    stage('Deleting only the second duplicate-ID note preserves the first note and current draft');
    await historyRow.getByRole('button', { name: 'Delete note historical-one (2 of 2)', exact: true }).click();
    await waitFor(() => readPaper().blocks[1].notes.filter(note => note.id === historical.id).length === 1, 'second historical body deleted');
    assert.equal(readPaper().blocks[1].notes.find(note => note.id === historical.id).body, longBody);
    assert.equal(await editor().inputValue(), longBody);
    assert.equal(await historyRow.locator('.annotation-note').count(), 1);
    await undo();
    await waitFor(() => readPaper().blocks[1].notes.filter(note => note.id === historical.id).length === 2, 'Undo restores second duplicate-ID body');
    assert.deepEqual(readPaper().blocks[1].notes.filter(note => note.id === historical.id).map(note => note.body).sort(), [longBody, historicalTwo.body].sort());
    assert.equal(await editor().inputValue(), longBody);

    stage('Atomic Undo restores both different historical note bodies even when their saved IDs are identical');
    await historyRow.getByRole('button', { name: /^Delete annotation / }).click();
    await waitFor(() => !readPaper().blocks[1].notes.some(note => note.id === historical.id) &&
      !readPaper().blocks[1].highlights.some(mark => mark.id === 'historical-mark'), 'duplicate-ID group deletion saved');
    await count(9); assert.equal(await editor().inputValue(), '');
    await undo();
    await waitFor(() => readPaper().blocks[1].notes.filter(note => note.id === historical.id).length === 2 &&
      readPaper().blocks[1].highlights.some(mark => mark.id === 'historical-mark'), 'one Undo restores every historical record');
    assert.deepEqual(readPaper().blocks[1].notes.filter(note => note.id === historical.id).map(note => note.body).sort(), [longBody, historicalTwo.body].sort());
    await count(10);

    stage('Restart retains all groups, exact IDs, historical bodies and the original creation-time order');
    await close(); await launch(); await count(10);
    assert.deepEqual(await page.locator('.annotation-row').evaluateAll(nodes => nodes.map(node => node.dataset.annotationKey)), initialKeys);
    const byRecord = items => [...items].sort((a, b) => `${a.id}:${a.body}`.localeCompare(`${b.id}:${b.body}`));
    assert.deepEqual(byRecord(readPaper().blocks[1].notes), byRecord(paper.blocks[1].notes));
    assert.deepEqual(byRecord(readPaper().viewNotes), byRecord(paper.viewNotes));
    assert.deepEqual(byRecord(readPaper().pdfNotes), byRecord(paper.pdfNotes));
    assert.equal(readPaper().blocks[0].notes.find(note => note.id === reader.id).createdAt, reader.createdAt);
    await open({ ...reader, body: typedBody });
    const finalKey = await row(typedBody).getAttribute('data-annotation-key');
    await row(typedBody).getByRole('button', { name: 'Delete note reader-current', exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].notes.some(note => note.id === reader.id), 'final current deletion saved');
    assert.equal(await editor().inputValue(), '');
    await close(); await launch(); await count(10);
    await keyed(finalKey).locator('.annotation-navigate').click();
    await waitFor(async () => await editor().isVisible(), 'remaining highlight opens after restart');
    assert.equal(await editor().inputValue(), '');
    assert.equal(readPaper().blocks[0].notes.some(note => note.id === reader.id), false, 'A deleted draft cannot resurrect on restart');

    stage('Highlight-first note creation inherits the original age and removing either part cannot reorder the row');
    const stableKeys = () => page.locator('.annotation-row').evaluateAll(nodes => nodes.map(node => node.dataset.annotationKey));
    const beforeCreationKeys = await stableKeys();
    const newBody = 'A fresh note attached to an older highlight.';
    await editor().fill(newBody);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await waitFor(() => readPaper().blocks[0].notes.some(note => note.body === newBody), 'new counterpart note saved');
    const newNote = readPaper().blocks[0].notes.find(note => note.body === newBody);
    assert.equal(newNote.createdAt, readerMark.createdAt);
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    await row(newBody).getByRole('button', { name: 'Remove highlight 1 reader-mark', exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].highlights.some(mark => mark.id === readerMark.id), 'older highlight removed without moving new note');
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    assert.equal(await editor().inputValue(), newBody);
    await undo();
    await waitFor(() => readPaper().blocks[0].highlights.some(mark => mark.id === readerMark.id), 'older highlight restored');
    await row(newBody).getByRole('button', { name: `Delete note ${newNote.id}`, exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].notes.some(note => note.id === newNote.id), 'counterpart note removed');
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    assert.equal(await editor().inputValue(), '');

    stage('Note-first highlight creation inherits its age and individual note deletion preserves ordering');
    await open(beta);
    await page.locator('.inspector-primary').getByRole('button', { name: 'Cobalt highlight', exact: true }).click();
    await waitFor(() => readPaper().blocks[0].highlights.some(mark => mark.text === beta.text), 'new counterpart highlight saved');
    const betaMark = readPaper().blocks[0].highlights.find(mark => mark.text === beta.text);
    assert.equal(betaMark.createdAt, beta.createdAt);
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    await row(beta.body).getByRole('button', { name: 'Delete note reader-other', exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].notes.some(note => note.id === beta.id), 'older note removed without moving new highlight');
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    assert.equal(await editor().inputValue(), '');
    await undo();
    await waitFor(() => readPaper().blocks[0].notes.some(note => note.id === beta.id), 'older note restored');
    await row(beta.body).getByRole('button', { name: `Remove highlight 1 ${betaMark.id}`, exact: true }).click();
    await waitFor(() => !readPaper().blocks[0].highlights.some(mark => mark.id === betaMark.id), 'counterpart highlight removed');
    assert.deepEqual(await stableKeys(), beforeCreationKeys);
    assert.equal(await editor().inputValue(), beta.body);
    await close(); await launch(); await count(10);
    assert.deepEqual(await stableKeys(), beforeCreationKeys, 'Creation-time order also remains stable after restart');
    assert.equal(generationRequests, 0); assert.deepEqual(errors, []);
  } catch (error) {
    fail(error);
    fs.writeFileSync(path.join(workspace, 'failure.json'), JSON.stringify({ phase, paper: readPaper(), errors, generationRequests }, null, 2));
    if (app) await bounded('failure screenshot', app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => image.toDataURL())), 5000)
      .then(data => fs.writeFileSync(path.join(workspace, 'failure.png'), Buffer.from(data.split(',')[1], 'base64'))).catch(fail);
  } finally {
    await close().catch(fail); server.closeAllConnections();
    await bounded('close fixture service', new Promise(resolve => server.close(resolve)), 3000).catch(fail);
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ stages, generationRequests, errors }, null, 2));
  console.log(`Saved annotations passed: grouping, exact labels/order, complete previews, scoped deletion/Undo, preserved typing, reliable navigation and restart. Artifacts: ${workspace}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
