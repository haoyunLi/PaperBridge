const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { withWindowsReadLock } = require('./windows-read-lock.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'interrupted-bundle-'));
  const exports = path.join(workspace, 'Exported papers'); fs.mkdirSync(exports);
  const source = path.join(__dirname, 'mac-parity', 'rotated-spectrometer.pdf');
  createStore(workspace).saveSettings({ ...defaults, pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, onboardingCompletedVersion: 1 });
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let closedForExport = false;
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(source), exact: true }).waitFor();
    await app.evaluate(({ shell, dialog }, dir) => {
      global.__reveals = []; shell.showItemInFolder = file => global.__reveals.push(file);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, exports);
    const exportBundle = async () => {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    };
    await exportBundle(); await page.getByText(/Exported .*Markdown files/).first().waitFor();
    const [first] = await app.evaluate(() => global.__reveals);
    const preview = fs.readFileSync(path.join(first, 'pages', 'page-002.png'));
    const original = fs.readFileSync(source);
    const list = () => fs.readdirSync(exports);
    const observe = process.argv.includes('--observe');
    for (const filename of ['paper_original.md', 'original.pdf', 'page-002.png', 'Original Pages.md']) {
      await app.evaluate((_electron, { dir, filename, preview }) => {
        const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path');
        const open = fs.openSync, write = fs.writeFileSync, copy = fs.copyFileSync;
        const targets = new Map();
        const within = name => typeof name === 'string' && name.startsWith(dir + path.sep);
        fs.openSync = function(file, ...args) { const fd = open.call(this, file, ...args); if (within(file)) targets.set(fd, file); return fd; };
        const fail = target => {
          fs.openSync = open; fs.writeFileSync = write; fs.copyFileSync = copy;
          write.call(fs, target, Buffer.alloc(19, 0x42));
          throw Object.assign(Error('The test export volume is full.'), { code: 'ENOSPC' });
        };
        fs.writeFileSync = function(target, bytes, ...args) {
          const actual = typeof target === 'number' ? targets.get(target) : target;
          if (within(actual)) {
            const name = path.basename(actual);
            const atomic = name.startsWith('.paperbridge-export.');
            const match = filename === 'page-002.png' ? Buffer.isBuffer(bytes) && bytes.length === preview.length && bytes.equals(Buffer.from(preview.base64, 'base64'))
              : filename === 'Original Pages.md' ? typeof bytes === 'string' && bytes.startsWith('# Original PDF facsimile') && !bytes.includes('\n---\n')
              : filename === 'paper_original.md' && typeof bytes === 'string' && bytes.includes('Lamp calibration') && !bytes.includes('# Original PDF facsimile');
            if (name === filename || atomic && match) return fail(target);
          }
          return write.call(this, target, bytes, ...args);
        };
        fs.copyFileSync = function(src, dest, ...args) {
          if (filename === 'original.pdf' && within(dest) && (path.basename(dest) === filename || path.basename(dest).startsWith('.paperbridge-export.'))) return fail(dest);
          return copy.call(this, src, dest, ...args);
        };
      }, { dir: exports, filename, preview: { base64: preview.toString('base64'), length: preview.length } });
      const before = new Set(list());
      await exportBundle();
      const message = page.getByText(/Bundle export incomplete/).first(); await message.waitFor();
      const folder = path.join(exports, list().find(name => !before.has(name)));
      const target = filename.endsWith('.png') ? path.join(folder, 'pages', filename) : path.join(folder, filename);
      const partialBytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
      console.log(JSON.stringify({ filename, partialBytes }));
      if (!observe) {
        assert.equal(partialBytes, 0);
        assert.match(await message.innerText(), /not enough free space/i);
        assert.ok((await message.innerText()).includes(folder));
        assert.equal(fs.readdirSync(folder, { recursive: true }).some(name => name.endsWith('.tmp')), false);
        if (filename.endsWith('.png')) {
          assert.deepEqual(fs.readFileSync(path.join(folder, 'original.pdf')), original);
          assert.deepEqual(fs.readFileSync(path.join(folder, 'pages', 'page-001.png')), fs.readFileSync(path.join(first, 'pages', 'page-001.png')));
          assert.doesNotMatch(fs.readFileSync(path.join(folder, 'Original Pages.md'), 'utf8'), /pages\/page-002\.png/);
        }
      }
      assert.deepEqual(await app.evaluate(() => global.__reveals), [first]);
    }
    if (observe) return;
    await exportBundle();
    await page.waitForFunction(() => /Exported .*Markdown files/.test(document.body.innerText) && !/Bundle export incomplete/.test(document.body.innerText));
    const reveals = await app.evaluate(() => global.__reveals);
    assert.equal(reveals.length, 2);
    const retry = reveals[1];
    assert.notEqual(first, retry);
    for (const name of ['paper_original.md', 'Original Pages.md', 'original.pdf', 'pages/page-001.png', 'pages/page-002.png']) {
      assert.deepEqual(fs.readFileSync(path.join(first, name)), fs.readFileSync(path.join(retry, name)), name);
    }
    if (process.platform === 'win32') {
      await app.evaluate(({ ipcMain }) => {
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        const finish = ipcMain._invokeHandlers.get('markdown:bundle-finish');
        ipcMain.removeHandler('markdown:bundle-finish');
        ipcMain.handle('markdown:bundle-finish', async (...args) => {
          const target = path.join(args[1].folder, 'paper_original.md');
          global.__lockedEdition = target;
          await new Promise(resolve => { global.__beginIndex = resolve; });
          const rename = fs.renameSync;
          fs.renameSync = function (from, to) {
            try { return rename.call(this, from, to); }
            catch (error) {
              if (to === target && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) global.__sawIndexLock = true;
              throw error;
            }
          };
          try { return await finish(...args); }
          finally { fs.renameSync = rename; }
        });
      });
      const waitForMain = key => app.evaluate(async (_electron, key) => {
        const deadline = Date.now() + 10000;
        while (!global[key] && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        if (!global[key]) throw new Error('Export checkpoint timed out: ' + key);
        return global[key];
      }, key);
      await exportBundle();
      const locked = await waitForMain('__lockedEdition');
      const closed = app.waitForEvent('close', { timeout: 20000 });
      await withWindowsReadLock(locked, async release => {
        await app.evaluate(() => global.__beginIndex());
        await waitForMain('__sawIndexLock');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await release();
      });
      await closed; closedForExport = true;
      for (const name of ['paper_original.md', 'Original Pages.md', 'original.pdf', 'pages/page-001.png', 'pages/page-002.png']) {
        assert.deepEqual(fs.readFileSync(path.join(path.dirname(locked), name)), fs.readFileSync(path.join(retry, name)), name);
      }
    }
    console.log('Recovered partial files, retried export, and completed the page index while closing under a Windows read lock.');
  } finally { if (!closedForExport) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
