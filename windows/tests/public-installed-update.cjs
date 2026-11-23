// Exercise public update delivery in a real registered installation on a clean Windows computer.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');
const { openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');

async function run() {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'win32');
  const executablePath = path.resolve(process.env.PAPERBRIDGE_TEST_EXECUTABLE);
  const feed = JSON.parse(process.env.PAPERBRIDGE_VERIFIED_FEED);
  const report = { from: '0.1.0', to: feed.version };
  const reportFile = path.join(__dirname, '..', 'test-artifacts', 'installed-update.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const checkpoint = stage => { report.stage = stage; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(stage); };
  const launch = () => electron.launch({ executablePath, args: [], timeout: 30000 });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(20000);
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
    const note = 'Keep this note while opening the verified Windows installer.';
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await row.locator('.block-notes').getByText(note, { exact: false }).waitFor();
    checkpoint('saved bookmark and note in the installed reader');
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
    await settings.getByRole('button', { name: 'Open installer', exact: true }).click();
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(trace) && Date.now() < deadline) await delay(100);
    const opened = JSON.parse(fs.readFileSync(trace, 'utf8'));
    assert.equal(path.resolve(opened.given).toLowerCase(), file.toLowerCase());
    assert.ok(!opened.error, opened.error);
    const saved = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    assert.ok(saved.blocks.some(block => block.bookmark && block.notes?.some(item => item.body === note)));
    report.paper = id;
    checkpoint('handed the verified Internet download to the Windows shell with its bookmark and note saved');
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
