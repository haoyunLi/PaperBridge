// Exercise public update delivery in a real registered installation on a clean Windows computer.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron: electron } = require('playwright-core');
const { openPasteText, loadPastedText, revealSidebarSource, openWorkspaceView } = require('./sidebar-controls.cjs');

const note = 'Keep this note while opening the verified Windows installer.';

async function run() {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'win32');
  const executablePath = path.resolve(process.env.PAPERBRIDGE_TEST_EXECUTABLE);
  const feed = JSON.parse(process.env.PAPERBRIDGE_VERIFIED_FEED);
  const onClose = process.env.PAPERBRIDGE_TEST_SETUP_ON_CLOSE === 'true';
  const report = { from: '0.1.0', to: feed.version, onClose };
  const reportFile = path.join(__dirname, '..', 'test-artifacts', 'installed-update.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const checkpoint = stage => { report.stage = stage; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(stage); };
  const launch = () => electron.launch({ executablePath, args: [], timeout: 30000 });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    if (process.argv.includes('--verify-restored')) {
      const previous = JSON.parse(fs.readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));
      assert.ok(previous.wizard?.readerPid && previous.wizard.readerPid !== previous.oldPID);
      const version = await app.evaluate(({ app }) => app.getVersion());
      assert.equal(version, previous.to);
      await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id, previous.paper);
      await openWorkspaceView(page, 'Reader');
      const row = page.locator('.reader-list article').filter({ hasText: 'Keep this bookmarked paragraph' });
      await row.locator('.block-notes').getByText(note, { exact: false }).waitFor();
      assert.equal(await row.locator('button[aria-pressed="true"][title*="bookmark" i]').count(), 1);
      Object.assign(report, previous);
      checkpoint('reopened the upgraded installation and read the original note and bookmark in Reader');
      return;
    }
    checkpoint('opened the installed reader');
    const actual = await app.evaluate(({ app }) => ({ version: app.getVersion(), pid: process.pid }));
    assert.equal(actual.version, report.from);
    report.oldPID = actual.pid;
    await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
    await page.setViewportSize({ width: 1320, height: 820 });
    await revealSidebarSource(page); await openPasteText(page);
    await page.locator('.paste-area').fill('Windows update reading sample\n\nKeep this bookmarked paragraph and its note after the reader restarts.');
    const id = await loadPastedText(page, { view: 'Reader' });
    const row = page.locator('.reader-list article').filter({ hasText: 'Keep this bookmarked paragraph' });
    await row.locator('button[title^="Bookmark"]').click();
    await row.locator('.source-text').evaluate(source => {
      const text = document.createTreeWalker(source, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 12);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await row.locator('.block-notes').getByText(note, { exact: false }).waitFor();
    report.paper = id;
    checkpoint('saved bookmark and note in the installed reader');
    if (process.argv.includes('--seed-only')) return;
    // A staged release is still waiting for this check before its public feed is promoted.
    // Only discovery is supplied. Chromium downloads the real Setup and the app checks its public proof.
    await app.evaluate((_electron, feed) => {
      const original = global.fetch;
      global.fetch = (url, options) => String(url).endsWith('/windows/latest-release.json') ? Promise.resolve(Response.json(feed)) : original(url, options);
    }, feed);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    const settings = page.getByRole('dialog');
    await settings.getByRole('button', { name: 'Check now', exact: true }).click();
    await settings.getByRole('button', { name: 'Download installer', exact: true }).click();
    await settings.getByText('Download complete. SHA-256 and GitHub build proof verified.').waitFor({ timeout: 90000 });
    checkpoint('verified the public Setup inside the earlier reader');
    const name = 'PaperBridge-Windows-' + feed.version + '-x64-Setup.exe';
    const file = path.join(process.env.LOCALAPPDATA, 'PaperBridge', 'update-downloads', name);
    assert.equal(fs.statSync(file).size, feed.files.Setup.size);
    report.sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(report.sha256, feed.files.Setup.sha256);
    assert.match(fs.readFileSync(file + ':Zone.Identifier', 'utf8'), /^ZoneId=3\s*$/m);
    report.internetZone = 3;
    // Observe the real operating-system handoff without answering any system dialog.
    const trace = path.join(path.dirname(reportFile), 'windows-shell-open.json');
    await app.evaluate(({ shell }, trace) => {
      const filesystem = process.getBuiltinModule('fs');
      const open = shell.openPath.bind(shell);
      shell.openPath = given => {
        filesystem.writeFileSync(trace, JSON.stringify({ given }));
        return open(given).then(error => {
          filesystem.writeFileSync(trace, JSON.stringify({ given, error }));
          return error;
        });
      };
    }, trace);
    const workspace = await app.evaluate(({ app }) => process.env.PAPERBRIDGE_WORKSPACE || process.getBuiltinModule('node:path').join(app.getPath('userData'), 'workspace'));
    if (onClose) {
      const schedule = settings.getByRole('checkbox', { name: /Setup when I close PaperBridge/ });
      assert.equal(await schedule.isChecked(), false);
      await schedule.check();
      assert.equal(fs.existsSync(trace), false);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    } else {
      await settings.getByRole('button', { name: 'Open installer', exact: true }).click();
    }
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(trace) && Date.now() < deadline) await delay(100);
    const opened = JSON.parse(fs.readFileSync(trace, 'utf8'));
    report.shellStatus = Object.hasOwn(opened, 'error') ? 'returned' : 'waiting for the native window';
    assert.equal(path.resolve(opened.given).toLowerCase(), file.toLowerCase());
    assert.ok(!opened.error, opened.error);
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', id + '.json'), 'utf8'));
    assert.ok(saved.blocks.some(block => block.bookmark && block.notes?.some(item => item.body === note)));
    checkpoint('handed the verified Internet download to the Windows shell with its bookmark and note saved');
    if (process.env.PAPERBRIDGE_VERIFY_WIZARD === 'true') {
      // Keep the original reader alive during ShellExecute, just as when a person clicks this button.
      const script = path.join(__dirname, 'finish-update-wizard.ps1');
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      try {
        const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-File', script, '-ObservePublic'], { windowsHide: true, timeout: 210000 });
        console.log(stdout);
        Object.assign(report, JSON.parse(fs.readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, '')));
        if (onClose && report.wizard?.result === 'public installer visible') {
          if (!page.isClosed()) await page.waitForEvent('close', { timeout: 20000 });
          checkpoint('the saved reader closed after Windows opened the verified Setup');
        } else if (report.wizard?.result === 'requires Windows user confirmation' && !page.isClosed()) {
          const advice = onClose ? settings.getByText(/Waiting for Windows Setup. Check the taskbar/) : settings.getByText(/Still waiting to open Setup|Follow the Windows setup wizard/);
          await advice.waitFor();
          report.readerGuidance = await advice.innerText();
          if (!onClose) {
            assert.match(report.readerGuidance, /Show downloaded update/);
            assert.ok(await settings.getByRole('button', { name: 'Show downloaded update', exact: true }).isEnabled());
          }
          checkpoint('showed how to locate Setup while Windows was requesting confirmation');
        }
      } catch (error) {
        console.error(error.stdout);
        if (!page.isClosed()) console.error('Update panel:', await settings.innerText().catch(() => 'closed'));
        throw error;
      }
    }
  } finally {
    if (app.process().exitCode === null) {
      // This isolated runner never answers the Windows trust prompt. It may still own ShellExecute.
      if (onClose) app.process().kill();
      else await app.close();
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
