const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const paperAId = 'a'.repeat(64);
const paperBId = 'b'.repeat(64);

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Saved settings can be mid-write. */ }
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
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id: paperAId }));
  const paperFile = id => JSON.parse(fs.readFileSync(path.join(papersDir, `${id}.json`), 'utf8'));

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production',
      PAPERBRIDGE_WORKSPACE: workspace, PAPERBRIDGE_TOOLS_ROOT: path.join(workspace, 'mock-tools') }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
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
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
