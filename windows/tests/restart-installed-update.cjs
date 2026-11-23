// Run on a disposable Windows runner: NSIS restarts a real registered installation.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView, openPasteText, loadPastedText, revealSidebarSource } = require('./sidebar-controls.cjs');
const exec = promisify(execFile);

async function observeRestart(executable, oldPID, version) {
  const script = `$ErrorActionPreference='Stop'
    $limit=[DateTime]::UtcNow.AddMinutes(2)
    do {
      foreach ($p in @(Get-Process -Name PaperBridge -ErrorAction SilentlyContinue)) {
        if ($p.Id -eq [int]$env:PB_OLD_PID -or $p.MainWindowHandle -eq 0 -or $p.Path -ne $env:PB_INSTALLED_EXE) { continue }
        $line=(Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.Id)).CommandLine
        if ($line -notmatch '(?:^|\\s)--updated(?:\\s|$)') { continue }
        $product=(Get-Item -LiteralPath $p.Path).VersionInfo.ProductVersion
        if ($product -notin @($env:PB_TARGET_VERSION, "$env:PB_TARGET_VERSION.0")) { throw "Unexpected running version $product" }
        $title=$p.MainWindowTitle
        if (!$title) { continue }
        if (!$p.CloseMainWindow() -or !$p.WaitForExit(20000)) { throw 'Relaunched reader did not close normally' }
        [pscustomobject]@{pid=$p.Id;version=$product;title=$title;updated=$true} | ConvertTo-Json -Compress
        exit 0
      }
      Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $limit)
    Get-Process -Name '*PaperBridge*' -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,Path | Out-String | Write-Error
    throw 'No updated reader window appeared.'`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 150000,
    env: { ...process.env, PB_INSTALLED_EXE: executable, PB_OLD_PID: String(oldPID), PB_TARGET_VERSION: version } });
  return JSON.parse(stdout.trim());
}

async function run() {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'win32');
  const executablePath = path.resolve(process.env.PAPERBRIDGE_TEST_EXECUTABLE);
  const feed = JSON.parse(process.env.PAPERBRIDGE_RESTART_FEED);
  const report = { from: '0.1.0', to: feed.version };
  const reportFile = path.join(__dirname, '..', 'test-artifacts', 'installed-restart.json');
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
    const note = 'Keep this note through a verified Windows restart.';
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
    await Promise.all([app.waitForEvent('close', { timeout: 60000 }),
      settings.getByRole('button', { name: 'Install and restart', exact: true }).click()]);
    app = null;
    report.relaunched = await observeRestart(executablePath, actual.pid, feed.version);
    assert.notEqual(report.relaunched.pid, actual.pid);
    checkpoint('observed the new version reopening its own visible window');
    app = await launch(); page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), feed.version);
    await openWorkspaceView(page, 'Reader');
    await page.locator('.block-notes').getByText(note, { exact: false }).waitFor();
    const saved = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    assert.ok(saved.blocks.some(block => block.bookmark && block.notes?.some(item => item.body === note)));
    report.paper = id;
    checkpoint('reopened the saved paper with its bookmark and note');
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
