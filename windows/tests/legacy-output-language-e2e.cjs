const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');
const { revealSidebarSource, openWorkspaceView } = require('./sidebar-controls.cjs');

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
    catch { /* Saved records and rendering can settle independently. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'legacy-output-language-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  const exportsDirectory = path.join(workspace, 'exports');
  fs.mkdirSync(exportsDirectory);
  const id = crypto.createHash('sha256').update('Unknown legacy translation language fixture').digest('hex');
  let generationRequests = 0;
  const service = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
  });
  await bounded('fixture service listen', new Promise(resolve => service.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${service.address().port}`, sourceLanguage: 'English', targetLanguage: 'German',
    translationModel: 'translategemma:4b', summaryModel: 'translategemma:4b', autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const source = 'Legacy evidence must retain its original translation and annotations.';
  const translation = '旧中文段落译文必须保留。';
  const connected = '这是独立保存的旧中文全文译文。';
  const summary = { source: 'A known English summary.', target: 'Un résumé français conservé.', sourceLanguage: 'English', targetLanguage: 'French', claims: [] };
  const notes = [{ id: 'source-note', kind: 'source', scope: 'reader', text: 'Legacy evidence', offset: 0, body: 'Retained source note.' },
    { id: 'translation-note', kind: 'translation', scope: 'reader', text: '旧中文', offset: 0, body: 'Retained translation note.' }];
  const highlights = [{ id: 'source-highlight', kind: 'source', scope: 'reader', text: 'Legacy evidence', offset: 0, color: 'amber' }];
  const translationHighlights = [{ id: 'translation-highlight', kind: 'translation', scope: 'reader', text: '旧中文', offset: 0, color: 'teal' }];
  const viewNotes = [{ id: 'summary-note', scope: 'summaryTarget', kind: 'translation', text: 'résumé français', offset: 3, body: 'Retained French summary note.' },
    { id: 'connected-note', scope: 'fullTranslation', kind: 'translation', text: '独立保存', offset: 2, body: 'Retained legacy full translation note.' }];
  const document = { id, name: 'Legacy multilingual.md', type: 'text', sourceMode: 'mineru', extraction: 'MinerU',
    blocks: [{ id: 1, text: source, sourceMarkdown: source, translation, translationMarkdown: translation, status: 'ok',
      bookmark: true, notes, highlights, translationHighlights }], mineruMarkdown: source,
    connectedTranslation: connected, summary, viewNotes, selectedParagraphID: 1, inspectorOpen: true,
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const knownId = crypto.createHash('sha256').update('Known independent artifact languages fixture').digest('hex');
  const knownTranslation = 'Une traduction française de ce paragraphe.';
  const known = { ...document, id: knownId, name: 'Known multilingual.txt', sourceMode: 'text', extraction: 'Pasted text', mineruMarkdown: undefined,
    taskSettings: settings, blocks: [{ id: 1, text: source, translation: knownTranslation, status: 'ok',
      translationLanguage: { sourceLanguage: 'English', targetLanguage: 'French' }, notes: [], highlights: [], translationHighlights: [] }],
    connectedLanguage: { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
    summary: { source: summary.source, target: 'Eine unabhängig gespeicherte Zusammenfassung.', sourceLanguage: 'English', targetLanguage: 'German', claims: [] },
    viewNotes: [] };
  // Deliberately no taskSettings or artifact-language fields: current global
  // German is not evidence of the language used for these saved Chinese texts.
  const paperFile = path.join(workspace, 'papers', `${id}.json`);
  const readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
  fs.writeFileSync(paperFile, JSON.stringify(document));
  fs.writeFileSync(path.join(workspace, 'papers', `${knownId}.json`), JSON.stringify(known));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));

  let app, page, failure, phase = 'launch';
  const stages = [], errors = [];
  const stage = value => { phase = value; stages.push(value); console.log(`[legacy-output-language] ${value}`); };
  const fail = error => { failure ||= error; console.error(`[legacy-output-language] ${phase}: ${error.stack || error}`); };
  const close = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    try { await bounded('Electron close', owned.close()); }
    catch (error) {
      fail(error);
      if (process.platform === 'win32' && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        await bounded('owned process termination', new Promise((resolve, reject) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
        }), 12000).catch(fail);
      }
      throw error;
    } finally { app = null; }
  };
  const ready = () => page.waitForFunction(id => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false';
  }, id);
  const launch = async () => {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, shell }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setZoomFactor(1); window.setContentSize(1500, 900); window.show(); window.focus();
      shell.showItemInFolder = folder => { globalThis.__languageBundle = folder; };
    });
    await ready();
  };
  const preserved = () => {
    const saved = readPaper();
    assert.equal(saved.blocks[0].text, source);
    assert.equal(saved.blocks[0].sourceMarkdown, source);
    assert.equal(saved.blocks[0].translation, translation);
    assert.equal(saved.blocks[0].translationMarkdown, translation);
    assert.equal(saved.blocks[0].translationLanguage, null, 'Unknown old Reader provenance must stay explicitly unknown');
    assert.equal(saved.connectedTranslation, connected);
    assert.equal(saved.connectedLanguage, null, 'Unknown independent full translation must not inherit German settings');
    assert.equal(saved.blocks[0].bookmark, true);
    assert.deepEqual(saved.blocks[0].notes, notes);
    assert.deepEqual(saved.blocks[0].highlights, highlights);
    assert.deepEqual(saved.blocks[0].translationHighlights, translationHighlights);
    assert.deepEqual(saved.summary, summary);
    assert.deepEqual([...saved.viewNotes].sort((a, b) => a.id.localeCompare(b.id)), [...viewNotes].sort((a, b) => a.id.localeCompare(b.id)));
  };
  const exportSingle = async (round, label, filename) => {
    const destination = path.join(exportsDirectory, `${round}-${filename}`);
    await app.evaluate(({ dialog }, destination) => {
      globalThis.__languageSaveDefault = null;
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.__languageSaveDefault = options.defaultPath;
        return { canceled: false, filePath: destination };
      };
    }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: label, exact: true }).click();
    await page.getByText(`Exported ${destination}`, { exact: true }).waitFor();
    assert.equal(path.basename(await app.evaluate(() => globalThis.__languageSaveDefault)), filename);
    return fs.readFileSync(destination, 'utf8');
  };
  const verifyExports = async round => {
    const analysis = await exportSingle(round, 'Summary, sources and notes', 'Legacy multilingual_bilingual.md');
    assert.match(analysis, /## Whole-paper summary \(English\)\n\nA known English summary\./);
    assert.match(analysis, /## Whole-paper summary \(French\)\n\nUn résumé français conservé\./);
    assert.match(analysis, /## Connected Full Translation\n\n这是独立保存的旧中文全文译文。/);
    assert.match(analysis, /#### Original\n\nLegacy evidence/);
    assert.match(analysis, /#### Translation\n\n旧中文段落译文必须保留。/);
    assert.doesNotMatch(analysis, /German|\(Chinese\)|\(Simplified Chinese\)/);
    for (const note of [...notes, ...viewNotes]) assert.ok(analysis.includes(note.body), `${note.body} must remain in Analysis`);
    assert.equal(await exportSingle(round, 'Full Translation Markdown', 'Legacy multilingual_full_translation.md'), connected);
    await app.evaluate(({ dialog }) => { globalThis.__languageBundle = null;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__languageExportDirectory] });
    });
    const directory = path.join(exportsDirectory, `Legacy multilingual_PaperBridge${round === 1 ? '' : `-${round}`}`);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await waitFor(async () => await app.evaluate(() => globalThis.__languageBundle) === directory, 'completed bundle reveal');
    assert.deepEqual(fs.readdirSync(directory).sort(), ['paper_analysis_notes.md', 'paper_bilingual.md', 'paper_full_translation.md', 'paper_original.md', 'paper_translation.md'].sort());
    assert.equal(fs.readFileSync(path.join(directory, 'paper_original.md'), 'utf8'), source);
    assert.equal(fs.readFileSync(path.join(directory, 'paper_translation.md'), 'utf8'), translation);
    assert.equal(fs.readFileSync(path.join(directory, 'paper_full_translation.md'), 'utf8'), translation,
      'The structured bundle rebuilds Full Translation from the Reader artifact; direct full export retains the independent draft');
    const bilingual = fs.readFileSync(path.join(directory, 'paper_bilingual.md'), 'utf8');
    assert.ok(bilingual.includes(source) && bilingual.includes(translation));
    assert.match(bilingual, /> \*\*Translation\*\*\n>\n> 旧中文段落译文必须保留。/);
    assert.doesNotMatch(bilingual, /German|French translation|Chinese translation/);
    assert.equal(fs.readFileSync(path.join(directory, 'paper_analysis_notes.md'), 'utf8'), analysis);
    preserved();
  };
  try {
    await launch();
    await app.evaluate((_electron, directory) => { globalThis.__languageExportDirectory = directory; }, exportsDirectory);
    stage('Legacy outputs export as unknown while the summary keeps its own French language');
    await page.locator('#block-1 .translation-text').getByText(translation, { exact: true }).waitFor();
    // A normal navigation saves the in-memory migration without generating output.
    await openWorkspaceView(page, 'Paper'); await ready();
    await openWorkspaceView(page, 'Reader'); await ready();
    await waitFor(() => Object.hasOwn(readPaper().blocks[0], 'translationLanguage') && Object.hasOwn(readPaper(), 'connectedLanguage'), 'unknown metadata persisted');
    await verifyExports(1);

    stage('Language setting variants preserve unknown metadata, translated annotations and independent output text');
    await revealSidebarSource(page);
    const target = page.getByLabel('Sidebar to language', { exact: true });
    assert.equal(await target.inputValue(), 'German');
    await target.selectOption('French');
    await waitFor(() => readPaper().taskSettings?.targetLanguage === 'French' && readPaper().blocks[0].translation === '', 'new French variant');
    await target.selectOption('German');
    await waitFor(() => readPaper().taskSettings?.targetLanguage === 'German' && readPaper().blocks[0].translation === translation && readPaper().summary?.target === summary.target, 'legacy variant restored');
    await verifyExports(2);

    stage('Complete restart retains explicit unknown output languages and the exact export filenames');
    await close(); await launch();
    await app.evaluate((_electron, directory) => { globalThis.__languageExportDirectory = directory; }, exportsDirectory);
    preserved();
    await verifyExports(3);

    stage('Known Reader, full translation and summary exports each retain their different artifact language');
    await page.locator('.recent-papers .library-row').filter({ hasText: 'Known multilingual' }).click();
    await page.waitForFunction(knownId => document.querySelector('.main-scroll')?.dataset.readingPaperId === knownId &&
      document.querySelector('.main-scroll')?.getAttribute('aria-busy') === 'false', knownId);
    await page.locator('#block-1 .translation-text').getByText(knownTranslation, { exact: true }).waitFor();
    const knownAnalysis = await exportSingle(4, 'Summary, sources and notes', 'Known multilingual_bilingual.md');
    assert.match(knownAnalysis, /## Whole-paper summary \(German\)\n\nEine unabhängig gespeicherte Zusammenfassung\./);
    assert.match(knownAnalysis, /## Connected Full Translation \(Simplified Chinese\)\n\n这是独立保存的旧中文全文译文。/);
    assert.match(knownAnalysis, /#### Original English\n\nLegacy evidence/);
    assert.match(knownAnalysis, /#### Translation \(French\)\n\nUne traduction française de ce paragraphe\./);
    assert.equal(await exportSingle(4, 'Translated Markdown', 'Known multilingual_translation_fr.md'), knownTranslation);
    assert.equal(await exportSingle(4, 'Full Translation Markdown', 'Known multilingual_full_translation_zh-Hans.md'), connected);
    await app.evaluate(({ dialog }) => { globalThis.__languageBundle = null;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__languageExportDirectory] });
    });
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export portable Markdown bundle', exact: true }).click();
    const knownBundle = path.join(exportsDirectory, 'Known multilingual_PaperBridge');
    await waitFor(async () => await app.evaluate(() => globalThis.__languageBundle) === knownBundle, 'known multilingual bundle');
    assert.deepEqual(fs.readdirSync(knownBundle).sort(), ['paper_analysis_notes.md', 'paper_bilingual_en_fr.md', 'paper_full_translation_zh-Hans.md', 'paper_original.md', 'paper_translation_fr.md'].sort());
    assert.equal(fs.readFileSync(path.join(knownBundle, 'paper_translation_fr.md'), 'utf8'), knownTranslation);
    assert.equal(fs.readFileSync(path.join(knownBundle, 'paper_full_translation_zh-Hans.md'), 'utf8'), connected);
    assert.equal(fs.readFileSync(path.join(knownBundle, 'paper_analysis_notes.md'), 'utf8'), knownAnalysis);
    assert.equal(generationRequests, 0, 'Loading, exporting and switching saved output variants must never request generation');
    assert.deepEqual(errors, []);
  } catch (error) {
    fail(error);
    fs.writeFileSync(path.join(workspace, 'failure.json'), JSON.stringify({ phase, paper: readPaper(), generationRequests, errors }, null, 2));
    if (app) await bounded('failure screenshot', app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => image.toDataURL())), 5000)
      .then(data => fs.writeFileSync(path.join(workspace, 'failure.png'), Buffer.from(data.split(',')[1], 'base64'))).catch(fail);
  } finally {
    await close().catch(fail);
    service.closeAllConnections();
    await bounded('fixture service close', new Promise(resolve => service.close(resolve)), 3000).catch(fail);
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ stages, generationRequests, errors }, null, 2));
  console.log(`Legacy output language passed: own summary language, unknown Reader/full translation, settings variants, restart, exact filenames and annotations. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
