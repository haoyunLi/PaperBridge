const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'renderer-recovery-'));
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' });
  const paper = { id: 'b'.repeat(64), name: 'Saved calibration study', type: 'text',
    blocks: [{ id: 1, text: 'A calibration check.', status: 'pending', bookmark: true,
      notes: [{ id: 'calibration-note', text: 'calibration', body: 'Check exposure two.', offset: 2, kind: 'source', scope: 'reader' }] }] };
  store.savePaper(paper);
  store.markPaperOpened(paper.id);

  const executablePath = process.argv[2];
  const args = ['--user-data-dir=' + path.join(workspace, 'profile')];
  if (!executablePath) args.unshift('.');
  const app = await _electron.launch({ executablePath, args, cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let exited = false;
  app.once('close', () => { exited = true; });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: paper.name, exact: true }).waitFor();
    const result = await app.evaluate(async ({ BrowserWindow, dialog }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const contents = window.webContents;
      const original = dialog.showMessageBox;
      const before = contents.getOSProcessId();
      let prompt;
      let timer;
      try {
        const loaded = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Reader did not reopen after process loss')), 20000);
          contents.once('did-finish-load', resolve);
        });
        dialog.showMessageBox = async (owner, options) => {
          prompt = { owned: owner === window, buttons: options.buttons, detail: options.detail };
          return { response: 0 };
        };
        contents.forcefullyCrashRenderer();
        await loaded;
        return { before, after: contents.getOSProcessId(), prompt };
      } finally {
        clearTimeout(timer);
        dialog.showMessageBox = original;
      }
    });
    assert.ok(result.before && result.after && result.before !== result.after);
    assert.equal(result.prompt.owned, true);
    assert.deepEqual(result.prompt.buttons, ['Reopen reader', 'Close PaperBridge']);
    assert.match(result.prompt.detail, /(?:killed|crashed) \(exit code -?\d+\)/);
    // Playwright marks the old page as crashed. Read the replacement renderer through Electron.
    const restored = await app.evaluate(({ BrowserWindow }, { id, name }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      return contents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 15000;
        while (!Array.from(document.querySelectorAll('h1,h2,h3')).some(h => h.textContent === ${JSON.stringify(name)})) {
          if (Date.now() > deadline) throw new Error('The recovered reader did not display the saved paper');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return window.paperBridge.loadPaper(${JSON.stringify(id)});
      })()`);
    }, { id: paper.id, name: paper.name });
    assert.equal(restored.blocks[0].bookmark, true);
    assert.deepEqual(restored.blocks[0].notes, paper.blocks[0].notes);
    const closed = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      setImmediate(() => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    });
    await closed;
    assert.deepEqual(store.paper(paper.id).blocks[0].notes, paper.blocks[0].notes);
    console.log('Reopened the saved paper, bookmark and note in a new renderer, then closed normally after a second termination.');
  } finally {
    if (!exited) await app.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
