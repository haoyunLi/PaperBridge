const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'edit-menu-'));
  const id = 'e'.repeat(64), passage = 'The calibration reading was stable.';
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify({ id, name: 'Calibration', type: 'text',
    sourceMode: 'text', blocks: [{ id: 1, text: passage }], inspectorOpen: true, position: { tab: 'Reader', block: 1 } }));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  const clipboardTest = process.env.RUNNER_ENVIRONMENT === 'github-hosted';
  try {
    const page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    const entries = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(menu =>
      (menu.submenu?.items || []).map(item => ({ menu: menu.role || menu.label, role: item.role,
        title: item.label, command: item.id, accelerator: item.accelerator || '' }))));
    const roles = entries.filter(item => item.menu === 'editmenu').map(item => item.role);
    const required = ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectall'];
    for (const role of required) assert.ok(roles.includes(role), 'Missing native Edit menu role ' + role);
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const menus = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).applicationMenu;
      assert.ok(menus?.Paper && menus?.Selection && menus?.Edit, 'Expected the public Mac menu observation');
      const labels = menus.Edit.map(item => item.title.toLowerCase().replaceAll(' ', ''));
      for (const role of required) assert.ok(labels.includes(role), 'Missing Mac Edit menu reference for ' + role);
      const titleKey = title => title.replace(/(?:\.{3}|…)$/, '');
      const nativeCommands = [...menus.Paper, ...menus.Selection,
        ...menus.File.filter(item => titleKey(item.title) === 'Open PDF'),
        ...menus.PaperBridge.filter(item => ['Settings', 'PaperBridge Getting Started', 'Check for Updates', 'About PaperBridge'].includes(titleKey(item.title)))];
      for (const item of nativeCommands) {
        const counterpart = entries.find(entry => titleKey(entry.title) === titleKey(item.title));
        assert.ok(counterpart, 'Missing Windows menu action ' + item.title);
        if (!item.key) continue;
        const key = item.key === '\r' ? 'Return' : item.key;
        const expected = ['CmdOrCtrl', ...(item.modifiers & 1 ? ['Shift'] : []), ...(item.modifiers & 2 ? ['Alt'] : []), key].join('+');
        assert.equal(counterpart.accelerator, expected, item.title);
      }
    }
    const clickRole = role => app.evaluate(({ Menu, BrowserWindow }, name) => {
      const window = BrowserWindow.getAllWindows()[0];
      const menu = Menu.getApplicationMenu().items.find(item => item.role === 'editmenu').submenu;
      menu.items.find(item => item.role === name).click(undefined, window, window.webContents);
    }, role);
    for (const [role, shortcut] of [['close', 'CmdOrCtrl+W'], ['togglefullscreen', 'F11']]) {
      assert.equal(entries.find(item => item.role === role)?.accelerator, shortcut);
    }
    assert.equal(entries.find(item => item.role === 'about')?.title, 'About PaperBridge');
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    for (const expected of [true, false]) {
      const fullscreen = await app.evaluate(async ({ Menu, BrowserWindow }, expected) => {
        const window = BrowserWindow.getAllWindows()[0];
        const item = Menu.getApplicationMenu().items.flatMap(menu => menu.submenu?.items || []).find(item => item.role === 'togglefullscreen');
        const changed = new Promise(resolve => window.once(expected ? 'enter-full-screen' : 'leave-full-screen', resolve));
        item.click(undefined, window, window.webContents);
        await changed;
        return window.isFullScreen();
      }, expected);
      assert.equal(fullscreen, expected);
    }
    await page.bringToFront();
    const source = page.locator('#block-1 .source-text');
    await source.waitFor();
    await source.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    if (clipboardTest) {
      await clickRole('copy');
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), passage);
    }
    const editor = page.locator('.inspector textarea');
    await editor.click();
    if (clipboardTest) {
      const target = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.focus();
        const buffer = window.getNativeWindowHandle();
        return { handle: String(buffer.length === 8 ? buffer.readBigUInt64LE() : buffer.readUInt32LE()), pid: process.pid };
      });
      for (const [layout, typed] of [['00000407', '€'], ['00000415', '€ś']]) {
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'type-altgr.ps1'),
          '-WindowHandle', target.handle, '-AppProcessId', String(target.pid), '-Layout', layout], { windowsHide: true, timeout: 15000 });
        assert.equal(await editor.inputValue(), typed, 'AltGr on layout ' + layout + ' must type in the note');
      }
      await clickRole('selectall');
      await page.keyboard.press('Backspace');
    }
    await page.keyboard.insertText('Field note');
    await clickRole('selectall');
    await page.waitForFunction(() => {
      const area = document.activeElement;
      return area.tagName === 'TEXTAREA' && area.value.slice(area.selectionStart, area.selectionEnd) === 'Field note';
    });
    await page.keyboard.insertText('Updated');
    await clickRole('undo');
    assert.equal(await editor.inputValue(), 'Field note', 'Edit > Undo must restore the replaced note draft');
    await clickRole('redo');
    assert.equal(await editor.inputValue(), 'Updated', 'Edit > Redo must restore the edit');
    if (clipboardTest) {
      await clickRole('selectall');
      await clickRole('cut');
      await page.waitForFunction(() => document.activeElement.value === '');
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Updated');
      await clickRole('paste');
      await page.waitForFunction(() => document.activeElement.value === 'Updated');
    }
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.locator('.annotation-row').filter({ hasText: 'Updated' }).waitFor();
    assert.equal((await page.evaluate(id => window.paperBridge.loadPaper(id), id)).blocks[0].text, passage);
    const closed = page.waitForEvent('close');
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const close = Menu.getApplicationMenu().items.flatMap(menu => menu.submenu?.items || []).find(item => item.role === 'close');
      setImmediate(() => close.click(undefined, window, window.webContents));
    });
    await closed;
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', id + '.json'), 'utf8'));
    assert.ok(saved.blocks[0].notes.some(note => note.body === 'Updated'));
    console.log(JSON.stringify({ roles: required, noteSaved: true, fullScreen: true, closed: true, systemClipboard: clipboardTest }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
