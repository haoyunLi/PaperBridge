const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* IPC and atomic saves may still be settling. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'sidebar-settings-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  const id = crypto.createHash('sha256').update('Sidebar language fixture A').digest('hex');
  const secondId = crypto.createHash('sha256').update('Sidebar language fixture B').digest('hex');
  const legacyId = crypto.createHash('sha256').update('Sidebar legacy language fixture').digest('hex');
  const model = 'translategemma:4b';
  const requests = [], tags = [], pulls = [];
  let generationMode = 'success', tagMode = 'success', heldGeneration;
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      tags.push(response);
      if (tagMode === 'hold') return;
      return response.end(JSON.stringify({ models: [{ model }] }));
    }
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/api/pull') {
        pulls.push(response);
        response.setHeader('Content-Type', 'application/x-ndjson');
        return response.write(`${JSON.stringify({ status: 'Downloading sidebar fixture', completed: 1, total: 100 })}\n`);
      }
      if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
      requests.push(JSON.parse(body));
      if (generationMode === 'hold') { heldGeneration = response; return; }
      response.end(JSON.stringify({ response: `Sidebar translation ${requests.length}.`, done: true }));
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { aiProvider: 'ollama', ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`,
    translationModel: model, summaryModel: model, explainModel: model, quickLookupModel: model,
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', maxParagraphChars: 2500,
    mineruExecutable: 'C:\\fixture\\initial\\mineru.exe', pdfExtractionMode: 'mineruPreferred',
    autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const block = { id: 1, text: 'A controlled study describes reproducible evidence for the sidebar settings regression.',
    heading: false, status: 'pending', translation: '', bookmark: false, highlights: [], translationHighlights: [], notes: [] };
  const paper = { id, name: 'Sidebar paper A', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    blocks: [block], taskSettings: settings, inspectorOpen: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual' } };
  const second = { ...paper, id: secondId, name: 'Sidebar paper B',
    blocks: [{ ...block, text: 'Paper B keeps its independent language direction and reviewed translation.', status: 'ok', translation: 'Paper B saved translation.' }],
    taskSettings: { ...settings, sourceLanguage: 'Japanese', targetLanguage: 'English' } };
  const legacy = { ...paper, id: legacyId, name: 'Sidebar legacy language',
    blocks: [{ ...block, status: 'ok', translation: 'Reviewed legacy Chinese translation.' }],
    taskSettings: { ...settings, targetLanguage: 'Chinese' } };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = (paperId = id) => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  const readSettings = () => JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8'));
  fs.writeFileSync(paperFile(id), JSON.stringify(paper));
  fs.writeFileSync(paperFile(secondId), JSON.stringify(second));
  fs.writeFileSync(paperFile(legacyId), JSON.stringify(legacy));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  let app, page;
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    // All parser checks are read-only fixtures. Online generation is forbidden in this suite.
    await app.evaluate(({ ipcMain }) => {
      globalThis.__sidebarParser = { mode: 'ready', requests: [], held: [], onlineRequests: 0 };
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', (_event, executable) => {
        const state = globalThis.__sidebarParser;
        state.requests.push(executable);
        if (state.mode === 'hold') return new Promise(resolve => state.held.push({ executable, resolve }));
        if (state.mode === 'error') throw new Error('Fixture parser permission error');
        return { installed: state.mode === 'ready', compatible: state.mode === 'ready', executable,
          version: executable.includes('replacement') ? '3.4.9 replacement' : '3.4.5 fixture',
          reason: state.mode === 'ready' ? '' : 'Fixture MinerU is missing.' };
      });
      for (const channel of ['openai:models', 'openai:generate']) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => { globalThis.__sidebarParser.onlineRequests++; throw new Error('No OpenAI network requests allowed in sidebar test'); });
      }
    });
    await page.reload();
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.locator('#block-1').waitFor({ timeout: 20000 });
  };
  const languages = () => page.locator('.sidebar-language');
  const from = () => languages().getByLabel('Sidebar from language', { exact: true });
  const to = () => languages().getByLabel('Sidebar to language', { exact: true });
  const swap = () => languages().getByRole('button', { name: 'Swap languages', exact: true });
  const ai = () => page.locator('.sidebar-ai-status');
  const refreshOllama = () => ai().getByRole('button', { name: 'Refresh Ollama models', exact: true });
  const refreshParser = () => ai().getByRole('button', { name: 'Refresh MinerU status', exact: true });
  const openDetails = async () => {
    const details = page.locator('.document-details');
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    await from().waitFor();
  };
  const closeSettings = () => page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const openSettings = async section => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: section, exact: true }).click();
  };
  const direction = async (source, target, paperId = id) => {
    await waitFor(async () => await from().inputValue() === source && await to().inputValue() === target &&
      readPaper(paperId).taskSettings.sourceLanguage === source && readPaper(paperId).taskSettings.targetLanguage === target, 'sidebar and per-paper languages');
  };
  const translated = async output => {
    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await waitFor(() => readPaper().blocks[0].status === 'ok' && readPaper().blocks[0].translation === output, output);
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
  };
  const assertLocked = async expected => {
    assert.equal(await from().isDisabled(), expected);
    assert.equal(await to().isDisabled(), expected);
    assert.equal(await swap().isDisabled(), expected);
  };
  try {
    await launch();
    assert.equal(await from().isVisible(), false, 'language controls share the collapsed Document & Import disclosure');
    assert.equal(await app.evaluate(() => globalThis.__sidebarParser.requests.length), 0, 'collapsed loaded-paper controls do not probe an invisible parser');
    await openDetails();
    await direction('English', 'Simplified Chinese');
    assert.equal(await from().locator('option').count(), 11, 'standard language choices remain unchanged');
    await ai().getByText('Ollama ready', { exact: true }).waitFor();
    await ai().getByText('MinerU ready', { exact: true }).waitFor();
    await translated('Sidebar translation 1.');
    await to().selectOption('French');
    await direction('English', 'French');
    await waitFor(() => readPaper().blocks[0].status === 'pending' && readPaper().blocks[0].translation === '', 'different language selects an uncached variant');
    generationMode = 'hold';
    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await waitFor(() => heldGeneration, 'held translation');
    await assertLocked(true);
    assert.equal(readPaper().taskSettings.targetLanguage, 'French');
    heldGeneration.end(JSON.stringify({ response: 'Sidebar translation 2.', done: true }));
    generationMode = 'success';
    await waitFor(() => readPaper().blocks[0].translation === 'Sidebar translation 2.', 'French translation completed');
    await waitFor(() => from().isEnabled(), 'language controls unlock after task');
    await to().selectOption('Simplified Chinese');
    await waitFor(() => readPaper().blocks[0].translation === 'Sidebar translation 1.', 'Chinese variant restored without another generation');
    await swap().click();
    await direction('Simplified Chinese', 'English');
    await translated('Sidebar translation 3.');
    await swap().click();
    await direction('English', 'Simplified Chinese');
    await waitFor(() => readPaper().blocks[0].translation === 'Sidebar translation 1.', 'one-step swap restores the previous output variant');
    assert.equal(requests.length, 3);
    assert.match(JSON.stringify(requests[0]), /Simplified Chinese/);
    assert.match(JSON.stringify(requests[1]), /French/);
    await openSettings('Reading');
    assert.equal(await page.locator('.settings-panel').getByLabel('Source language').inputValue(), 'English');
    assert.equal(await page.locator('.settings-panel').getByLabel('Target language').inputValue(), 'Simplified Chinese');
    await page.locator('.settings-panel').getByLabel('Target language').selectOption('French');
    await closeSettings();
    await direction('English', 'French');
    await waitFor(() => readPaper().blocks[0].translation === 'Sidebar translation 2.', 'Settings and sidebar share the same variant cache');
    await page.locator('.library-row').filter({ hasText: 'Sidebar paper B' }).click();
    await direction('Japanese', 'English', secondId);
    assert.equal(readPaper(secondId).blocks[0].translation, 'Paper B saved translation.');
    await from().selectOption('German');
    await direction('German', 'English', secondId);
    await page.locator('.library-row').filter({ hasText: 'Sidebar paper A' }).click();
    await direction('English', 'French');
    assert.equal(readPaper().blocks[0].translation, 'Sidebar translation 2.');
    assert.equal(readPaper(secondId).taskSettings.sourceLanguage, 'German');

    const beforeLegacyRequests = requests.length;
    await page.locator('.library-row').filter({ hasText: legacy.name }).click();
    await page.getByRole('heading', { name: legacy.name, exact: true }).waitFor();
    await direction('English', 'Chinese', legacyId);
    assert.equal(await to().locator('option:checked').textContent(), 'Chinese', 'legacy language must not display the first standard option');
    assert.deepEqual(readPaper(legacyId).blocks, legacy.blocks, 'displaying an old language must preserve its saved output');
    for (const control of [from(), to()]) assert.equal(await control.locator('option').evaluateAll(options =>
      options.filter(option => option.value === 'Chinese').length), 1, 'legacy option appears once on each side');
    await swap().click();
    await direction('Chinese', 'English', legacyId);
    await swap().click();
    await direction('English', 'Chinese', legacyId);
    await waitFor(() => readPaper(legacyId).blocks[0].translation === legacy.blocks[0].translation, 'swapping back restores the legacy language cache');
    await to().selectOption('French');
    await direction('English', 'French', legacyId);
    await waitFor(() => readPaper(legacyId).blocks[0].status === 'pending', 'known language selects its separate empty variant');
    await to().selectOption('Chinese');
    await direction('English', 'Chinese', legacyId);
    await waitFor(() => readPaper(legacyId).blocks[0].status === 'ok' && readPaper(legacyId).blocks[0].translation === legacy.blocks[0].translation, 'returning to a retained legacy option restores its cache');
    assert.equal(requests.length, beforeLegacyRequests, 'displaying, swapping and restoring legacy languages must not run AI');
    await page.locator('.library-row').filter({ hasText: 'Sidebar paper A' }).click();
    await direction('English', 'French');

    await openSettings('Models');
    await page.getByLabel('Model to download').fill('sidebar-download-fixture:1b');
    await page.getByRole('button', { name: 'Download model', exact: true }).click();
    await waitFor(() => pulls.length === 1, 'model download started');
    await closeSettings();
    await assertLocked(true);
    await openSettings('Models');
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel download', exact: true }).waitFor({ state: 'hidden' });
    await closeSettings();
    await assertLocked(false);

    tagMode = 'hold';
    const beforeTags = tags.length;
    await refreshOllama().click();
    await waitFor(() => tags.length === beforeTags + 1, 'sidebar model refresh');
    await ai().getByText('Checking Ollama…', { exact: true }).waitFor();
    assert.equal(await refreshOllama().isDisabled(), true);
    tags.at(-1).statusCode = 503;
    tags.at(-1).end(JSON.stringify({ error: 'Fixture local service unavailable' }));
    await ai().getByText('Ollama unavailable', { exact: true }).waitFor();
    await waitFor(() => refreshOllama().isEnabled(), 'failed model refresh can retry');
    tagMode = 'success';
    await refreshOllama().click();
    await ai().getByText('Ollama ready', { exact: true }).waitFor();
    assert.equal(requests.length, 3, 'status refresh must not generate or translate text');

    const originalParserPath = readSettings().mineruExecutable;
    await app.evaluate(() => { globalThis.__sidebarParser.mode = 'missing'; });
    await refreshParser().click();
    await ai().getByText('MinerU unavailable', { exact: true }).waitFor();
    await ai().getByText('Fixture MinerU is missing.', { exact: true }).waitFor();
    assert.equal(readSettings().mineruExecutable, originalParserPath, 'refresh must not silently discover and replace a parser setting');
    await app.evaluate(() => { globalThis.__sidebarParser.mode = 'error'; });
    await refreshParser().click();
    await ai().getByText(/Fixture parser permission error/).waitFor();
    await waitFor(() => refreshParser().isEnabled(), 'parser refresh failure unlocks retry');
    await app.evaluate(() => { globalThis.__sidebarParser.mode = 'hold'; });
    await refreshParser().click();
    await waitFor(() => app.evaluate(() => globalThis.__sidebarParser.held.length === 1), 'held parser status');
    await ai().getByText('Checking MinerU…', { exact: true }).waitFor();
    assert.equal(await refreshParser().isDisabled(), true);
    await app.evaluate(() => { globalThis.__sidebarParser.mode = 'ready'; });
    await ai().getByRole('button', { name: 'Parser, Models & Settings', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Parsing', exact: true }).getAttribute('aria-selected'), 'true');
    const replacementPath = 'C:\\fixture\\replacement\\mineru.exe';
    await page.getByLabel('MinerU executable', { exact: true }).fill(replacementPath);
    await closeSettings();
    await ai().getByText('Version 3.4.9 replacement', { exact: true }).waitFor();
    await app.evaluate(() => {
      const old = globalThis.__sidebarParser.held.shift();
      old.resolve({ installed: false, compatible: false, executable: old.executable, reason: 'Stale parser result must not appear' });
    });
    // A read-only IPC round trip and paint allow the deliberately late promise to settle.
    await page.evaluate(async () => { await window.paperBridge.openAIKeyStatus(); await new Promise(requestAnimationFrame); });
    assert.equal(await ai().getByText('Version 3.4.9 replacement', { exact: true }).isVisible(), true);
    assert.doesNotMatch(await ai().textContent(), /Stale parser result/);
    await waitFor(() => readSettings().mineruExecutable === replacementPath, 'replacement parser path saved');

    await openSettings('Models');
    await page.getByLabel('AI provider').selectOption('openai');
    await closeSettings();
    await ai().getByText('Online analysis is paused. Enable it in Settings > Models.', { exact: true }).waitFor();
    await ai().getByText('No translation model selected', { exact: true }).waitFor();
    assert.equal(await refreshOllama().count(), 0);
    await ai().getByRole('button', { name: 'Open AI Settings', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Models', exact: true }).getAttribute('aria-selected'), 'true');
    const fakeKey = 'sidebar-test-key-placeholder-never-networked';
    const onlineModel = 'gpt-sidebar-fixture-with-a-long-model-name-to-check-safe-wrapping';
    await page.getByLabel('New OpenAI API key').fill(fakeKey);
    await page.getByRole('button', { name: 'Save key', exact: true }).click();
    await page.getByText('Key saved for this Windows account', { exact: true }).waitFor();
    await page.getByLabel('Translation model ID', { exact: true }).fill(onlineModel);
    await closeSettings();
    await ai().getByText('Online analysis is paused. Enable it in Settings > Models.', { exact: true }).waitFor();
    assert.equal(await ai().locator('.sidebar-model-name').textContent(), onlineModel);
    assert.doesNotMatch(await page.locator('body').textContent(), new RegExp(fakeKey));
    assert.equal(fs.readFileSync(path.join(workspace, 'openai-key.bin')).includes(Buffer.from(fakeKey)), false);
    await ai().getByRole('button', { name: 'Open AI Settings', exact: true }).click();
    await page.getByLabel('I allow this text to be sent to OpenAI for this session').check();
    await closeSettings();
    await ai().getByText('Text analysis uses OpenAI. API usage is billed to your account.', { exact: true }).waitFor();
    assert.equal(await refreshParser().isEnabled(), true, 'parser checks remain available with an online provider');
    const beforeOnlineParserRefresh = await app.evaluate(() => globalThis.__sidebarParser.requests.length);
    await refreshParser().click();
    await waitFor(() => app.evaluate((_electron, before) => globalThis.__sidebarParser.requests.length === before + 1, beforeOnlineParserRefresh), 'parser refresh under the OpenAI provider');
    await ai().getByText('MinerU ready', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__sidebarParser.requests.at(-1)), replacementPath);
    assert.equal(await app.evaluate(() => globalThis.__sidebarParser.onlineRequests), 0);
    await waitFor(() => readSettings().openAITranslationModel === onlineModel, 'online model saved');
    assert.doesNotMatch(fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8'), /sidebar-test-key|openAIConsent|isOpenAIOptInConfirmed/);
    assert.doesNotMatch(fs.readFileSync(paperFile(id), 'utf8'), /sidebar-test-key|openAIConsent|isOpenAIOptInConfirmed/);

    const layouts = [];
    for (const sample of [{ width: 980, height: 620, zoom: 1 }, { width: 1960, height: 1240, zoom: 2 }]) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), sample.zoom);
      for (const control of [from(), to(), swap(), refreshParser(), ai().getByRole('button', { name: 'Open AI Settings', exact: true }), ai().getByRole('button', { name: 'Parser, Models & Settings', exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate(node => {
          const rect = node.getBoundingClientRect(), host = node.closest('.sidebar-scroll').getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            clipLeft: host.left, clipRight: host.right, clipTop: host.top, clipBottom: host.bottom, innerWidth, innerHeight };
        });
        assert.ok(bounds.left >= bounds.clipLeft - 1 && bounds.right <= bounds.clipRight + 1, `sidebar control fits horizontally: ${JSON.stringify(bounds)}`);
        assert.ok(bounds.top >= bounds.clipTop - 1 && bounds.bottom <= bounds.clipBottom + 1, `sidebar control scrolls fully into view: ${JSON.stringify(bounds)}`);
        assert.ok(bounds.right <= bounds.innerWidth && bounds.bottom <= bounds.innerHeight);
      }
      const layout = await page.locator('.sidebar-scroll').evaluate(host => ({ clientHeight: host.clientHeight, scrollHeight: host.scrollHeight,
        overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth, height: innerHeight }));
      assert.ok(layout.scrollHeight > layout.clientHeight, 'expanded document controls must have a usable scroll container');
      assert.ok(layout.overflow <= 1, 'sidebar content must not introduce page-wide horizontal overflow');
      layouts.push({ ...sample, ...layout });
      await page.screenshot({ path: path.join(workspace, `sidebar-settings-zoom-${sample.zoom}.png`) });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await app.close(); app = null;
    await launch();
    await openDetails();
    await direction('English', 'French');
    await ai().getByText('Online analysis is paused. Enable it in Settings > Models.', { exact: true }).waitFor();
    assert.equal(await ai().locator('.sidebar-model-name').textContent(), onlineModel);
    await ai().getByRole('button', { name: 'Open AI Settings', exact: true }).click();
    await page.getByText('Key saved for this Windows account', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('I allow this text to be sent to OpenAI for this session').isChecked(), false);
    await page.getByLabel('AI provider').selectOption('ollama');
    await closeSettings();
    await waitFor(() => readPaper().blocks[0].translation === 'Sidebar translation 2.', 'restart and provider round trip retain the local language variant');
    assert.equal(requests.length, 3);
    assert.equal(await app.evaluate(() => globalThis.__sidebarParser.onlineRequests), 0);
    await page.locator('.library-row').filter({ hasText: legacy.name }).click();
    await direction('English', 'Chinese', legacyId);
    await app.close(); app = null;
    await launch();
    await openDetails();
    await direction('English', 'Chinese', legacyId);
    assert.equal(await to().locator('option:checked').textContent(), 'Chinese');
    assert.equal(readPaper(legacyId).blocks[0].translation, legacy.blocks[0].translation);
    assert.equal(requests.length, 3, 'legacy language restart retains saved translation without inference');
    const result = { passed: true, translationRequests: requests.length, layouts, assertions: [
      'sidebar languages and Settings share per-paper output variants', 'atomic swap and per-paper restoration',
      'legacy language display, swap, switch-back cache and restart',
      'busy and model-download gates', 'Ollama refresh progress failure retry without inference',
      'MinerU refresh is read-only and ignores stale paths', 'direct Models and Parsing navigation',
      'OpenAI consent independent of stored key and revoked on restart', 'no plaintext key exposure',
      'expanded sidebar scroll at 980x620 and 200% zoom' ] };
    fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, workspace }));
  } catch (error) {
    await page?.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
    const parserDiagnostics = await app?.evaluate(() => ({ mode: globalThis.__sidebarParser?.mode,
      requests: globalThis.__sidebarParser?.requests, held: globalThis.__sidebarParser?.held.length })).catch(() => null);
    if (parserDiagnostics) fs.writeFileSync(path.join(workspace, 'parser-diagnostics.json'), JSON.stringify(parserDiagnostics, null, 2));
    console.error(`Sidebar settings artifacts: ${workspace}`);
    throw error;
  } finally {
    await app?.close().catch(() => {});
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
