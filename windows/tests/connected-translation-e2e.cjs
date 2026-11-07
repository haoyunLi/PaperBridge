const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { revealSidebarSource, openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'connected-translation-'));
  const model = 'translategemma:4b';
  const citations = [
    '[1] Ng, A. (2021). Results for the previous sensor. Journal of Testing.',
    '[2] J. Lee and P. Moss. Sensors in the field. Proceedings of Testing, 2022.',
    '[3] Renée Moreau, Liam Clarke, and Amy Gold. Estimating calibration error, 2018.'
  ];
  const paragraphs = [
    'Opening method. ' + 'Sample measurement was calibrated. '.repeat(73),
    'Second opening paragraph. ' + 'The baseline was repeated. '.repeat(53),
    'Separate middle batch. ' + 'The measured difference was small. '.repeat(116),
    ...citations,
    'Appendix A. Final unprocessed batch. ' + 'Evidence requires further validation. '.repeat(112)
  ].map(text => text.trim());
  const excerpts = [];
  let heldResponse;
  let initialRun = true;
  const ollama = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).prompt;
    const excerpt = prompt.split('Paper excerpt:\n').at(-1);
    excerpts.push(excerpt);
    if (initialRun && excerpt.startsWith('Separate middle batch.')) {
      response.statusCode = 503;
      return response.end('{}');
    }
    if (initialRun && excerpt.startsWith('Appendix A.')) { heldResponse = response; return; }
    const number = excerpt.startsWith('Opening method.') ? 1 : excerpt.startsWith('Separate middle batch.') ? 2 : 3;
    const text = prompt.includes('from English into French.') ? `Traduction française ${number}.` : ['第一批译文。', '第二批译文。', '第三批译文。'][number - 1];
    response.end(JSON.stringify({ response: text, done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const chinese = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
    const french = { sourceLanguage: 'English', targetLanguage: 'French' };
    const exportFullTranslation = async (name, code = 'zh-Hans') => {
      const destination = path.join(workspace, name);
      await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async (_window, options) => {
        globalThis.__connectedExportDefault = options.defaultPath;
        return { canceled: false, filePath };
      }; }, destination);
      await page.getByRole('button', { name: 'More' }).click();
      await page.locator('.modal-body').getByRole('button', { name: 'Export Options…', exact: true }).click();
      await page.getByRole('button', { name: 'Full Translation Markdown', exact: true }).click();
      await page.getByText('Exported ' + destination, { exact: true }).waitFor();
      assert.equal(path.basename(await app.evaluate(() => globalThis.__connectedExportDefault)), `Pasted Text_full_translation${code ? `_${code}` : ''}.md`);
      return fs.readFileSync(destination, 'utf8');
    };
    await openPasteText(page);
    await page.locator('.paste-area').fill(paragraphs.join('\n\n'));
    const paperId = await loadPastedText(page, { view: 'Paper' });
    const paperFile = path.join(workspace, 'papers', `${paperId}.json`);
    const readPaper = () => JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    await openWorkspaceView(page, 'Full Translation');
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('Translating full paper · batch 3 of 3', { exact: true }).waitFor();
    for (let attempt = 0; attempt < 100 && !heldResponse; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(heldResponse, 'The last request should be in flight before testing Stop');
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await stop.click();
    heldResponse?.end(JSON.stringify({ response: 'Discard this late answer.', done: true }));
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).waitFor();
    const partial = page.locator('[data-view-scope="fullTranslation"]');
    await partial.getByText('第一批译文。', { exact: true }).waitFor();
    assert.match(await partial.innerText(), /Separate middle batch/);
    assert.match(await partial.innerText(), /Final unprocessed batch/);
    assert.doesNotMatch(await partial.innerText(), /Discard this late answer/);
    const partialExport = await exportFullTranslation('full-translation-partial.md');
    assert.match(partialExport, /^> 1 connected-translation batch\(es\) failed and were marked inline below\./);
    assert.equal(partialExport.split('[Connected translation failed for').length - 1, 1);
    assert.match(partialExport, /\[Connected translation failed for batch 2\]/);
    assert.ok(partialExport.includes(`> Original text retained below.\n\n${paragraphs[2]}`), 'The failed excerpt remains available verbatim beside its failure marker');
    assert.ok(partialExport.indexOf('第一批译文。') < partialExport.indexOf('[Connected translation failed for batch 2]'));
    assert.ok(partialExport.includes(citations.join('\n\n')));
    assert.ok(partialExport.includes(paragraphs.at(-1)), 'An interrupted batch retains its source without being labeled failed');
    assert.doesNotMatch(partialExport, /failed for batch [13]\]|Discard this late answer/);
    assert.doesNotMatch(await partial.innerText(), /Connected translation failed/, 'Export annotations must not rewrite the stored Reader draft');
    await app.close(); app = null;

    const interrupted = readPaper();
    assert.deepEqual(interrupted.connectedLanguage, chinese, 'New successful, failed and pending batches share their explicit task direction');
    for (const batch of interrupted.connectedBlocks.filter(batch => batch.kind === 'translation')) assert.deepEqual(batch.translationLanguage, chinese);
    // Recreate a migrated successful legacy batch whose historical direction is
    // unknown. Complete raw task settings must not override this explicit null.
    interrupted.connectedBlocks.find(batch => batch.kind === 'translation' && batch.status === 'ok').translationLanguage = null;
    interrupted.connectedLanguage = null;
    fs.writeFileSync(paperFile, JSON.stringify(interrupted));

    initialRun = false;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).waitFor();
    await page.keyboard.press('Control+Enter');
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    const completed = page.locator('[data-view-scope="fullTranslation"]');
    for (const text of ['第一批译文。', '第二批译文。', '第三批译文。', ...citations]) {
      await completed.getByText(text, { exact: true }).waitFor();
    }
    assert.equal(excerpts.length, 5, 'Only failed and interrupted batches should run again');
    assert.equal(excerpts[0], paragraphs.slice(0, 2).join('\n\n'));
    assert.equal(excerpts[1], paragraphs[2]);
    assert.equal(excerpts[3], excerpts[1]);
    assert.equal(excerpts[4], paragraphs.at(-1));
    assert.ok(excerpts.every(excerpt => excerpt.length <= 4800));
    assert.ok(excerpts.every(excerpt => citations.every(citation => !excerpt.includes(citation))));
    const file = fs.readdirSync(path.join(workspace, 'papers')).find(name => /^[a-f\d]{64}\.json$/.test(name));
    await page.waitForFunction(async id => {
      const paper = await window.paperBridge.loadPaper(id);
      return paper?.connectedBlocks?.every(batch => batch.status === 'ok');
    }, path.basename(file, '.json'));
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', file), 'utf8'));
    assert.equal(saved.connectedBatchVersion, 1);
    assert.ok(saved.blocks.every(block => block.status === 'pending'), 'Plain connected translation should leave Reader output independent');
    assert.equal(saved.connectedBlocks[0].translationLanguage, null, 'Resume must retain the unknown language of its reused successful batch');
    for (const batch of saved.connectedBlocks.filter(batch => batch.kind === 'translation').slice(1)) assert.deepEqual(batch.translationLanguage, chinese);
    assert.equal(saved.connectedLanguage, null, 'Known resumed batches cannot retroactively label the whole legacy draft');
    assert.notEqual(saved.connectedLanguageConflict, true, 'Unknown historical language alone is not a contradictory language declaration');
    const completedExport = await exportFullTranslation('full-translation-completed.md', null);
    assert.equal(completedExport, saved.connectedTranslation, 'Resuming successfully removes export failure markers without changing the completed text');
    assert.doesNotMatch(completedExport, /Connected translation failed|batch\(es\) failed|Original text retained below/);
    for (const text of ['第一批译文。', '第二批译文。', '第三批译文。', ...citations]) assert.ok(completedExport.includes(text));

    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(async paperId => {
      const current = await window.paperBridge.loadPaper(paperId);
      return current?.connectedLanguage?.targetLanguage === 'Simplified Chinese' && current.connectedBlocks.every(batch => batch.status === 'ok');
    }, paperId);
    assert.equal(excerpts.length, 8, 'Force regeneration must replace every translated batch before assigning a known whole-draft language');
    const regenerated = readPaper();
    assert.deepEqual(regenerated.connectedLanguage, chinese);
    for (const batch of regenerated.connectedBlocks.filter(batch => batch.kind === 'translation')) assert.deepEqual(batch.translationLanguage, chinese);
    assert.equal(await exportFullTranslation('full-translation-regenerated.md'), regenerated.connectedTranslation);

    await revealSidebarSource(page);
    await page.getByLabel('Sidebar to language', { exact: true }).selectOption('French');
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(async paperId => {
      const current = await window.paperBridge.loadPaper(paperId);
      return current?.connectedLanguage?.targetLanguage === 'French' && current.connectedBlocks.every(batch => batch.status === 'ok');
    }, paperId);
    const frenchSaved = readPaper();
    assert.deepEqual(frenchSaved.connectedLanguage, french);
    for (const batch of frenchSaved.connectedBlocks.filter(batch => batch.kind === 'translation')) assert.deepEqual(batch.translationLanguage, french);
    assert.equal(excerpts.length, 11);
    const frenchExport = await exportFullTranslation('full-translation-french.md', 'fr');
    for (const text of ['Traduction française 1.', 'Traduction française 2.', 'Traduction française 3.']) assert.ok(frenchExport.includes(text));
    await page.getByLabel('Sidebar to language', { exact: true }).selectOption('Simplified Chinese');
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.connectedLanguage?.targetLanguage === 'Simplified Chinese', paperId);
    assert.equal(readPaper().connectedTranslation, regenerated.connectedTranslation);
    assert.deepEqual(readPaper().connectedBlocks, regenerated.connectedBlocks);
    assert.deepEqual(readPaper().connectedLanguage, chinese);
    assert.equal(await exportFullTranslation('full-translation-restored.md'), regenerated.connectedTranslation);
    assert.equal(excerpts.length, 11, 'Switching back restores both text and language metadata without generation');

    // The stored whole-draft declaration conflicts with its exact batch
    // metadata. Loading or resuming must not silently choose one declaration.
    await app.close(); app = null;
    const conflicting = readPaper();
    conflicting.connectedLanguage = french;
    delete conflicting.connectedLanguageConflict;
    const failedBatch = conflicting.connectedBlocks.filter(batch => batch.kind === 'translation').at(-1);
    failedBatch.status = 'failed';
    failedBatch.output = failedBatch.source;
    failedBatch.error = 'Fixture interrupted batch with contradictory output language declarations.';
    conflicting.connectedTranslation = conflicting.connectedBlocks.map(batch => batch.output).join('\n\n');
    fs.writeFileSync(paperFile, JSON.stringify(conflicting));
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    await openWorkspaceView(page, 'Full Translation');
    await page.waitForFunction(async paperId => {
      const current = await window.paperBridge.loadPaper(paperId);
      return current?.connectedLanguageConflict === true && current.connectedLanguage === null;
    }, paperId);
    const conflictingExport = await exportFullTranslation('full-translation-conflicting.md', null);
    assert.equal(conflictingExport, conflicting.connectedTranslation, 'Conflicting metadata must export the raw saved text without guessing a batch language');
    assert.ok(conflictingExport.includes(paragraphs.at(-1)), 'The failed batch source remains present even when its failure marker cannot be attributed safely');
    assert.doesNotMatch(conflictingExport, /Connected translation failed|batch\(es\) failed|Original text retained below/);
    assert.equal(excerpts.length, 11, 'Reloading and exporting a conflict must not trigger generation');

    await page.getByRole('button', { name: 'Resume unfinished batches', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(async paperId => {
      const current = await window.paperBridge.loadPaper(paperId);
      return current?.connectedBlocks?.every(batch => batch.status === 'ok') && current.connectedLanguageConflict === true && current.connectedLanguage === null;
    }, paperId);
    const conflictResumed = readPaper();
    assert.equal(excerpts.length, 12, 'Resume retries only the failed batch while retaining the contradictory successful batches');
    assert.equal(excerpts.at(-1), paragraphs.at(-1));
    for (const batch of conflictResumed.connectedBlocks.filter(batch => batch.kind === 'translation')) assert.deepEqual(batch.translationLanguage, chinese);
    assert.equal(conflictResumed.connectedTranslation, regenerated.connectedTranslation);
    assert.equal(await exportFullTranslation('full-translation-conflicting-resumed.md', null), conflictResumed.connectedTranslation);

    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
    assert.equal(readPaper().connectedLanguageConflict, true, 'The contradiction survives a complete restart after Resume');
    assert.equal(readPaper().connectedLanguage, null);
    assert.equal(await exportFullTranslation('full-translation-conflicting-restarted.md', null), conflictResumed.connectedTranslation);
    assert.equal(excerpts.length, 12);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(async paperId => {
      const current = await window.paperBridge.loadPaper(paperId);
      return current?.connectedBlocks?.every(batch => batch.status === 'ok') && current.connectedLanguageConflict === false &&
        current.connectedLanguage?.targetLanguage === 'Simplified Chinese';
    }, paperId);
    assert.equal(excerpts.length, 15, 'Only replacing every translated batch clears the inherited language conflict');
    assert.deepEqual(readPaper().connectedLanguage, chinese);
    assert.equal(readPaper().connectedLanguageConflict, false);
    for (const batch of readPaper().connectedBlocks.filter(batch => batch.kind === 'translation')) assert.deepEqual(batch.translationLanguage, chinese);
    assert.equal(await exportFullTranslation('full-translation-conflict-cleared.md'), readPaper().connectedTranslation);
    await openWorkspaceView(page, 'Reader');
    const reference = page.locator('#block-4');
    await reference.getByText(citations[0], { exact: true }).waitFor();
    await reference.getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await revealSidebarSource(page);
    assert.equal(await page.locator('.document-details .side-stat').filter({ has: page.getByText('Paragraphs', { exact: true }) }).locator('b').innerText(), '4');
    assert.equal(await page.locator('.document-details .side-stat').filter({ has: page.getByText('Translated', { exact: true }) }).locator('b').innerText(), '0');
    await page.locator('.document-details > summary').click();
    await openWorkspaceView(page, 'Paper');
    const preview = page.locator('[data-paper-block-id="4"]');
    await preview.getByText(citations[0], { exact: true }).waitFor();
    assert.equal(await preview.locator('.paper-preview-translation').count(), 0);
    const destination = path.join(workspace, 'translated.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'More' }).click();
    await page.locator('.modal-body').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Translated Markdown', exact: true }).click();
    await page.getByText('Exported ' + destination, { exact: true }).waitFor();
    const exported = fs.readFileSync(destination, 'utf8');
    assert.ok(exported.includes(citations.join('\n\n')));
    assert.doesNotMatch(exported, /\[Untranslated block [456]\]/);
    console.log('Connected translation verified: excerpt batching, references, unknown legacy resume, failed-batch original fallback, language variants, contradictory metadata surviving Resume/restart and clearing only after full regeneration.');
  } finally {
    heldResponse?.destroy();
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
