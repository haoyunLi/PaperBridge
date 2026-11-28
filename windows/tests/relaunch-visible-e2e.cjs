const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  assert.ok(executablePath, 'An actual packaged executable is required to exercise the single-instance lock');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'relaunch-visible-'));
  const args = ['--user-data-dir=' + path.join(workspace, 'profile')];
  const env = { ...process.env, PAPERBRIDGE_WORKSPACE: workspace };
  const name = '低温实验记录', id = 'b'.repeat(64);
  const store = createStore(workspace);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false });
  store.savePaper({ id, name, type: 'text', sourceMode: 'text', extraction: 'Pasted text', position: { tab: 'Reader' },
    blocks: [{ id: 1, text: 'The sample was cooled to 77 K.', translation: '样品被冷却至77 K。', bookmark: true }] });
  const app = await electron.launch({ executablePath, args, env, cwd: root });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    const snapshot = () => app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0], bounds = win.getBounds();
      const visible = screen.getAllDisplays().some(({ workArea: r }) => bounds.y >= r.y - 1 && bounds.y + 16 < r.y + r.height &&
        Math.min(bounds.x + bounds.width, r.x + r.width) - Math.max(bounds.x, r.x) >= 80);
      return { bounds, visible, minimized: win.isMinimized(), windows: BrowserWindow.getAllWindows().length, id: win.id };
    });
    const first = await snapshot();
    assert.ok(first.visible);
    for (const minimized of [false, true]) {
      await app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const right = Math.max(...screen.getAllDisplays().map(d => d.bounds.x + d.bounds.width));
        win.setPosition(right + 1000, screen.getPrimaryDisplay().workArea.y + 80);
      });
      const outside = await snapshot();
      assert.equal(outside.visible, false, JSON.stringify(outside));
      if (minimized) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        assert.ok((await snapshot()).minimized);
      }
      await execFile(executablePath, args, { cwd: root, env, windowsHide: true, timeout: 20000 });
      const deadline = Date.now() + 2500;
      let after;
      do {
        after = await snapshot();
        if (after.visible && !after.minimized) break;
        await new Promise(resolve => setTimeout(resolve, 60));
      } while (Date.now() < deadline);
      console.log(JSON.stringify({ minimized, before: outside, after }));
      if (process.argv.includes('--observe')) continue;
      assert.ok(after.visible && !after.minimized, 'Relaunch must return the existing title bar to a connected screen');
      assert.equal(after.id, first.id); assert.equal(after.windows, 1);
      assert.equal(await page.locator('.main-scroll').getAttribute('data-reading-paper-id'), id);
      assert.ok(store.paper(id).blocks[0].bookmark);
    }
    if (!process.argv.includes('--observe')) {
      await app.evaluate(({ BrowserWindow, screen }) => {
        const work = screen.getPrimaryDisplay().workArea;
        BrowserWindow.getAllWindows()[0].setPosition(work.x + work.width - 300, work.y + 60);
      });
      const partlyVisible = await snapshot();
      assert.ok(partlyVisible.visible);
      await execFile(executablePath, args, { cwd: root, env, windowsHide: true, timeout: 20000 });
      assert.deepEqual((await snapshot()).bounds, partlyVisible.bounds, 'Preserve the position of a reachable frame');
    }
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
