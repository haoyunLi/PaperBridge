const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const paperAId = 'a'.repeat(64);
const paperBId = 'b'.repeat(64);
const pdfId = 'c'.repeat(64);

async function bounded(label, operation, timeout = 15000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; } catch { /* Saved settings can be mid-write. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function paper(id, name, text, mineruExecutable, mineruBackend) {
  return {
    id, name, type: 'text', createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ id: 1, text: 'Abstract', heading: true, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] },
      { id: 2, text, heading: false, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }],
    tags: [], summary: null, connectedTranslation: '', extraction: 'Pasted text',
    taskSettings: { mineruExecutable, mineruBackend, pdfExtractionMode: 'mineruPreferred' },
    position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }
  };
}

async function openParsing(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Parsing', exact: true }).click();
  await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).waitFor();
  await waitFor(() => page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).isEnabled(), 'MinerU status check');
}

async function closeSettings(page) {
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('tab', { name: 'Parsing', exact: true }).waitFor({ state: 'detached' });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'mineru-detect-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  const papersDir = path.join(workspace, 'papers');
  fs.mkdirSync(papersDir, { recursive: true });
  const badA = 'C:\\missing\\paper-a-mineru.exe';
  const badB = 'C:\\missing\\paper-b-mineru.exe';
  const detected = 'C:\\managed\\mineru\\Scripts\\mineru.exe';
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9',
    mineruExecutable: badA, mineruBackend: 'pipeline', pdfExtractionMode: 'mineruPreferred'
  }));
  fs.writeFileSync(path.join(papersDir, `${paperAId}.json`), JSON.stringify(paper(paperAId, 'MinerU paper A', 'Paper A stays in its task.', badA, 'pipeline')));
  fs.writeFileSync(path.join(papersDir, `${paperBId}.json`), JSON.stringify(paper(paperBId, 'MinerU paper B', 'Paper B has its own parser path.', badB, 'auto')));
  const pdfBlocks = Array.from({ length: 18 }, (_, index) => ({ id: index + 1, page: 1, heading: index === 0,
    text: index === 0 ? 'Old PDF introduction' : `Old PDF passage ${index + 1}. ` +
      'The initial extracted text retains its own independent reading position and selected paragraph before parsing. '.repeat(7),
    translation: '', status: 'pending', bookmark: false, highlights: [], translationHighlights: [], notes: [] }));
  const pdf = { ...paper(pdfId, 'MinerU automatic adoption.pdf', '', detected, 'auto'), type: 'pdf',
    sourceMode: 'pdf', extraction: 'PDF.js', blocks: pdfBlocks, pdfBlocks, selectedParagraphID: 1,
    position: { block: 1, page: 1, tab: 'Reader', displayMode: 'bilingual' } };
  fs.writeFileSync(path.join(papersDir, `${pdfId}.json`), JSON.stringify(pdf));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id: paperAId }));
  const paperFile = id => JSON.parse(fs.readFileSync(path.join(papersDir, `${id}.json`), 'utf8'));

  let app, page, stage = 'existing auto-detect scenarios';
  const launch = async () => {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace,
        PAPERBRIDGE_TOOLS_ROOT: path.join(workspace, 'mock-tools') }, timeout: 30000 });
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1320, height: 820 });
  };
  const readingReady = () => page.waitForFunction(id => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false';
  }, pdfId, { timeout: 15000 });
  const viewport = () => bounded('Reader geometry', page.evaluate(() => {
    const host = document.querySelector('.main-scroll');
    const top = host.getBoundingClientRect().top;
    const first = [...document.querySelectorAll('.reader-list > .block')]
      .find(block => block.getBoundingClientRect().bottom > top + 12);
    return { block: Number(first?.id.slice(6)), offset: host.scrollTop,
      maximum: host.scrollHeight - host.clientHeight };
  }));
  try {
    await launch();
    await page.getByRole('heading', { name: 'MinerU paper A', exact: true }).waitFor({ timeout: 20000 });
    await app.evaluate(({ ipcMain }, fixture) => {
      global.__mineruDetectMode = 'success';
      global.__mineruDetectCalls = 0;
      global.__mineruDetectPending = null;
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', (_event, executable) => ({ installed: false, compatible: false, executable: '',
        version: '', runtime: null, reason: `Mock path unavailable: ${executable}` }));
      ipcMain.removeHandler('mineru:detect');
      ipcMain.handle('mineru:detect', () => {
        global.__mineruDetectCalls++;
        if (global.__mineruDetectMode === 'failure') return { installed: false, compatible: false, executable: '',
          version: '', runtime: null, reason: 'Mock MinerU discovery found no compatible installation.' };
        if (global.__mineruDetectMode === 'pending') return new Promise(resolve => { global.__mineruDetectPending = resolve; });
        return { installed: true, compatible: true, executable: fixture.detected, version: 'MinerU 3.4.5',
          source: 'managed', runtime: { checked: true, cuda: false }, reason: '' };
      });
    }, { detected });

    await openParsing(page);
    const executable = page.getByLabel('MinerU executable');
    const backend = page.getByLabel('MinerU backend');
    assert.equal(await executable.inputValue(), badA);
    assert.equal(await backend.inputValue(), 'pipeline');
    await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).click();
    await waitFor(() => executable.inputValue().then(value => value === detected), 'detected MinerU path in Settings');
    assert.equal(await backend.inputValue(), 'pipeline');
    await waitFor(() => paperFile(paperAId).taskSettings?.mineruExecutable === detected, 'detected path saved for paper A');

    const edited = 'C:\\custom\\still-missing-mineru.exe';
    await executable.fill(edited);
    await waitFor(() => page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).isEnabled(), 'status check after manual path');
    await app.evaluate(() => { global.__mineruDetectMode = 'failure'; });
    await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).click();
    await page.getByRole('alert').getByText('Mock MinerU discovery found no compatible installation.').waitFor();
    assert.equal(await executable.inputValue(), edited);
    assert.equal(await backend.inputValue(), 'pipeline');
    await waitFor(() => paperFile(paperAId).taskSettings?.mineruExecutable === edited, 'manual path retained after failed discovery');

    await page.getByLabel('PDF extraction mode').selectOption('pdfOnly');
    assert.equal(await executable.isDisabled(), true);
    assert.equal(await backend.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).isDisabled(), true);
    await page.getByLabel('PDF extraction mode').selectOption('mineruPreferred');
    await waitFor(() => page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).isEnabled(), 'auto-detect after PDF mode change');

    await app.evaluate(() => { global.__mineruDetectMode = 'pending'; });
    await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).click();
    await waitFor(() => app.evaluate(() => Boolean(global.__mineruDetectPending)), 'delayed discovery request');
    await closeSettings(page);
    await page.locator('.library-row').filter({ hasText: 'MinerU paper B' }).click();
    await page.getByRole('heading', { name: 'MinerU paper B', exact: true }).waitFor();
    await app.evaluate((_electron, fixture) => {
      global.__mineruDetectPending?.({ installed: true, compatible: true, executable: fixture.detected,
        version: 'MinerU 3.4.5', source: 'managed', runtime: { checked: true, cuda: false }, reason: '' });
      global.__mineruDetectPending = null;
    }, { detected });
    await openParsing(page);
    assert.equal(await page.getByLabel('MinerU executable').inputValue(), badB);
    assert.equal(await page.getByLabel('MinerU backend').inputValue(), 'auto');
    assert.equal(paperFile(paperBId).taskSettings.mineruExecutable, badB);
    assert.equal(paperFile(paperBId).taskSettings.mineruBackend, 'auto');

    await app.evaluate(({ ipcMain }) => {
      global.__mineruDetectMode = 'pending';
      global.__summaryPending = null;
      ipcMain.removeHandler('ollama:models');
      ipcMain.handle('ollama:models', () => ['translategemma:4b']);
      ipcMain.removeHandler('ollama:generate');
      ipcMain.handle('ollama:generate', () => new Promise(resolve => { global.__summaryPending = resolve; }));
    });
    await page.getByRole('button', { name: 'Use Auto-Detect', exact: true }).click();
    await waitFor(() => app.evaluate(() => Boolean(global.__mineruDetectPending)), 'second delayed discovery request');
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('command:generateSummary');
      if (!item?.enabled) throw new Error('Generate Summary menu was unavailable during Settings detection');
      item.click(null, BrowserWindow.getAllWindows()[0]);
    });
    await waitFor(() => app.evaluate(() => Boolean(global.__summaryPending)), 'delayed summary task');
    await page.locator('.task-progress').waitFor();
    await app.evaluate((_electron, fixture) => {
      global.__mineruDetectPending?.({ installed: true, compatible: true, executable: fixture.detected,
        version: 'MinerU 3.4.5', source: 'managed', runtime: { checked: true, cuda: false }, reason: '' });
      global.__mineruDetectPending = null;
    }, { detected });
    await page.getByRole('alert').getByText('Another task started during detection.', { exact: false }).waitFor();
    assert.equal(await page.getByLabel('MinerU executable').inputValue(), badB);
    assert.equal(await page.locator('.task-progress').isVisible(), true, 'late detection must not cancel the new summary task');
    assert.equal(paperFile(paperBId).taskSettings.mineruExecutable, badB);
    console.log('MinerU Auto-Detect handled success, failure, PDF-only controls, closed-dialog results and a newer native-menu summary task without changing its paper settings.');
    await closeSettings(page);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await app.evaluate(() => { global.__summaryPending?.('Cancelled fixture response'); global.__summaryPending = null; });
    await page.locator('.task-progress').waitFor({ state: 'hidden' });

    stage = 'automatic adoption from an independently selected and scrolled PDF';
    console.log(`[mineru-detect] ${stage}`);
    await app.evaluate(({ ipcMain }, { detected, pdfId }) => {
      global.__mineruAdoptionRequests = [];
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ installed: true, compatible: true, executable: detected,
        version: 'MinerU 3.4.5', runtime: { checked: true, cuda: false } }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', (_event, request) => {
        global.__mineruAdoptionRequests.push(request.id);
        if (request.id !== pdfId) throw new Error('Unexpected PDF sent to the fixture parser');
        return { markdown: ['# MinerU replacement introduction', ...Array.from({ length: 17 }, (_, index) =>
          `New MinerU passage ${index + 2}. ` + 'Reconstructed structure keeps the new reader independent of the previous PDF text, its selected paragraph, and the old search position. '.repeat(10))].join('\n\n'),
        pageHints: [] };
      });
    }, { detected, pdfId });
    await page.locator('.library-row').filter({ hasText: 'MinerU automatic adoption.pdf' }).click();
    await readingReady();
    await page.locator('#block-2').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await waitFor(() => paperFile(pdfId).selectedParagraphID === 2, 'old selected paragraph 2');
    const wheel = await bounded('wheel destination', page.evaluate(() => {
      const host = document.querySelector('.main-scroll').getBoundingClientRect();
      return { x: host.left + host.width / 2, y: host.top + 60,
        delta: document.getElementById('block-12').getBoundingClientRect().top - host.top + 24 };
    }));
    await page.mouse.move(wheel.x, wheel.y);
    await page.mouse.wheel(0, wheel.delta);
    await waitFor(async () => {
      const view = await viewport(), saved = paperFile(pdfId);
      return view.block === 12 && saved.position.block === 12 && saved.selectedParagraphID === 2 &&
        Math.abs(saved.position.scrollByTab?.Reader - view.offset) < 2;
    }, 'independent old selection and deep Reader viewport');
    const oldOffset = (await viewport()).offset;
    assert.ok(oldOffset > 1000);
    await page.getByRole('textbox', { name: 'Search original or translation', exact: true }).fill('Old PDF');
    await waitFor(() => paperFile(pdfId).position.readerSearchOrigin?.block === 12, 'old search origin saved');
    assert.equal((await viewport()).block, 12, 'the matching search keeps the deep old viewport before parsing');
    const preservedPdfBlocks = structuredClone(paperFile(pdfId).blocks);
    assert.ok(preservedPdfBlocks.every(block => block.status === 'pending' && !block.translation && !block.bookmark &&
      !block.notes?.length && !block.highlights?.length && !block.translationHighlights?.length));
    assert.equal(Boolean(paperFile(pdfId).summary || paperFile(pdfId).connectedTranslation), false);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('button', { name: 'Parse with MinerU', exact: true }).click();
    await page.getByText('MinerU structure ready:', { exact: false }).waitFor();
    await page.locator('.task-progress').waitFor({ state: 'hidden' });
    await readingReady();

    const assertAdopted = async () => {
      await page.locator('#block-1 .source-text').getByText('MinerU replacement introduction', { exact: true }).waitFor();
      await waitFor(async () => {
        const saved = paperFile(pdfId), view = await viewport();
        return saved.sourceMode === 'mineru' && saved.selectedParagraphID === 1 && saved.position.block === 1 &&
          !saved.position.readerSearchOrigin && view.block === 1 &&
          (saved.position.scrollByTab?.Reader == null || Math.abs(saved.position.scrollByTab.Reader - view.offset) < 2);
      }, 'new MinerU selection and viewport saved at the first paragraph');
      assert.deepEqual(await page.locator('.reader-list > .block.current').evaluateAll(nodes => nodes.map(node => node.id)), ['block-1']);
      assert.equal(await page.getByRole('textbox', { name: 'Search original or translation', exact: true }).inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Reader', exact: true }).getAttribute('class'), 'active');
      const saved = paperFile(pdfId), view = await viewport();
      assert.equal(saved.position.tab, 'Reader');
      assert.equal(saved.position.displayMode, 'bilingual');
      assert.deepEqual(saved.pdfBlocks, preservedPdfBlocks, 'automatic adoption preserves the entire original PDF block version');
      assert.deepEqual(saved.blocks, saved.mineruBlocks);
      assert.ok(view.maximum > oldOffset, 'the new document remains tall enough to expose an incorrectly retained old scroll offset');
      assert.ok(view.offset < oldOffset / 4, 'the old deep Reader pixel offset must not leak into the new source');
      assert.ok(saved.position.scrollByTab?.Reader == null || saved.position.scrollByTab.Reader < oldOffset / 4);
    };
    await assertAdopted();
    assert.deepEqual(await app.evaluate(() => global.__mineruAdoptionRequests), [pdfId]);
    stage = 'restart retains the new source and its first-paragraph state';
    console.log(`[mineru-detect] ${stage}`);
    await bounded('Electron restart close', app.close());
    app = null;
    await launch();
    await readingReady();
    await assertAdopted();
    console.log('MinerU automatic adoption reset the independent Reader selection, viewport and search origin, preserved PDF blocks, and survived a full restart.');
  } catch (error) {
    console.error(`[mineru-detect] ${stage}: ${error.stack || error}`);
    await page?.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await bounded('Electron close', app?.close() || Promise.resolve()); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
