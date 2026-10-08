// Opt-in real NSIS lifecycle test. See installer-e2e.md before running.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'test-artifacts');
const metadata = require('../package.json');
const guid = '1a046d2c-29e5-5f45-8614-2c68ad2c6d75';
const note = 'Installer lifecycle: retain this annotation after same-version reinstall and uninstall.';

function safePath(value, parent) {
  const resolved = path.resolve(value);
  const relative = path.relative(path.resolve(parent), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || /['"\r\n]/.test(resolved)) throw new Error(`Unsafe test path: ${resolved}`);
  let current = resolved;
  for (;;) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing reparse/symlink path: ${current}`);
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  if (fs.existsSync(resolved) && fs.realpathSync.native(resolved).toLowerCase() !== resolved.toLowerCase()) throw new Error(`Path resolves elsewhere: ${resolved}`);
  return resolved;
}

function executable(file, parent) {
  safePath(file, parent);
  if (!fs.statSync(file).isFile() || path.extname(file).toLowerCase() !== '.exe') throw new Error(`Expected a real executable: ${file}`);
  return file;
}

function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function longestPackagedPath(installDir) {
  const unpacked = path.join(root, 'release', 'win-unpacked');
  if (!fs.statSync(unpacked).isDirectory()) throw new Error('Run npm run dist before the installer lifecycle test.');
  const pending = [unpacked];
  let longest = { relative: '', length: installDir.length };
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(unpacked, absolute);
        const length = path.join(installDir, relative).length;
        if (length > longest.length) longest = { relative, length };
      }
    }
  }
  return longest;
}

function safeUpdaterFile(cache, logicalLocalAppData) {
  const file = path.resolve(cache, 'installer.exe');
  if (path.dirname(file).toLowerCase() !== path.resolve(cache).toLowerCase()) throw new Error(`Unsafe updater cache file: ${file}`);
  for (const item of [cache, file]) {
    if (fs.existsSync(item) && fs.lstatSync(item).isSymbolicLink()) throw new Error(`Refusing updater cache symlink: ${item}`);
  }
  if (fs.existsSync(file)) {
    const real = fs.realpathSync.native(file);
    const local = path.resolve(logicalLocalAppData).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const logical = real.toLowerCase() === file.toLowerCase();
    const packaged = new RegExp(`^${local}\\\\Packages\\\\[^\\\\]+\\\\LocalCache\\\\Local\\\\paperbridge-windows-updater\\\\installer\\.exe$`, 'i').test(real);
    if (!logical && !packaged) throw new Error(`Updater cache resolves outside its Windows package projection: ${real}`);
  }
  return file;
}

async function powershell(script, input = {}, timeout = 30000) {
  const program = "$ErrorActionPreference = 'Stop'\n$spec = $env:PAPERBRIDGE_INSTALLER_TEST_SPEC | ConvertFrom-Json\n" + script;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')],
    { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PAPERBRIDGE_INSTALLER_TEST_SPEC: JSON.stringify(input) } });
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

async function inspectMachine() {
  return powershell(`
$rows = @()
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      $key = $base.OpenSubKey("Software\\$($spec.guid)")
      if ($null -ne $key) {
        try { $rows += [PSCustomObject]@{ type='install'; hive="$hive"; view="$view"; key=$key.Name; location=$key.GetValue('InstallLocation') } }
        finally { $key.Dispose() }
      }
      $uninstall = $base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
      if ($null -ne $uninstall) {
        try {
          foreach ($name in $uninstall.GetSubKeyNames()) {
            $key = $uninstall.OpenSubKey($name)
            if ($null -eq $key) { throw 'A registry entry changed during the installation safety check.' }
            try {
              $display = [string]$key.GetValue('DisplayName')
              $command = [string]$key.GetValue('UninstallString')
              $location = [string]$key.GetValue('InstallLocation')
              if ($name -eq $spec.guid -or "$display $command $location" -match '(?i)paperbridge') {
                $rows += [PSCustomObject]@{ type='uninstall'; hive="$hive"; view="$view"; key=$key.Name; name=$name; display=$display; location=$location; command=$command; version=$key.GetValue('DisplayVersion') }
              }
            } finally { $key.Dispose() }
          }
        } finally { $uninstall.Dispose() }
      }
    } finally { $base.Dispose() }
  }
}
$shortcuts = @()
$shell = New-Object -ComObject WScript.Shell
foreach ($kind in @('DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
  $folder = [Environment]::GetFolderPath($kind)
  if ($folder -and (Test-Path -LiteralPath $folder)) {
    foreach ($file in @(Get-ChildItem -LiteralPath $folder -Filter '*PaperBridge*.lnk' -File -Recurse -ErrorAction Stop)) {
      $shortcuts += [PSCustomObject]@{ path=$file.FullName; target=$shell.CreateShortcut($file.FullName).TargetPath }
    }
  }
}
$processes = @(Get-CimInstance Win32_Process -Filter "Name LIKE '%PaperBridge%'" | Select-Object ProcessId,Name,ExecutablePath)
[PSCustomObject]@{ registry=@($rows); shortcuts=@($shortcuts); processes=@($processes); localAppData=[Environment]::GetFolderPath('LocalApplicationData') } | ConvertTo-Json -Depth 8
`, { guid });
}

function assertNoProcesses(state) {
  if (state.processes.length) throw new Error(`Close existing PaperBridge processes before this test: ${JSON.stringify(state.processes)}`);
}

function assertOwned(state, installDir) {
  assertNoProcesses(state);
  const uninstaller = path.join(installDir, 'Uninstall PaperBridge.exe');
  for (const entry of state.registry) {
    if (entry.hive !== 'CurrentUser') throw new Error(`Refusing foreign installation: ${entry.key}`);
    if (entry.type === 'install') assert.equal(path.resolve(entry.location || '').toLowerCase(), installDir.toLowerCase(), 'InstallLocation must still belong to this test');
    else {
      assert.equal(entry.name, guid, 'Unexpected PaperBridge uninstall identity');
      assert.equal(entry.command?.toLowerCase(), `"${uninstaller}" /currentuser`.toLowerCase(), 'UninstallString must still belong to this test');
      assert.equal(entry.version, metadata.version, 'Registered version must match the tested installer');
    }
  }
  for (const shortcut of state.shortcuts) assert.equal(path.resolve(shortcut.target).toLowerCase(), path.join(installDir, 'PaperBridge.exe').toLowerCase(), 'Refusing a shortcut belonging to another installation');
}

async function runHidden(file, argumentsString, fixture, timeoutMs = 240000) {
  executable(file, fixture);
  return powershell(`
$started = Get-Date
$process = Start-Process -FilePath $spec.file -ArgumentList $spec.arguments -WorkingDirectory $spec.workingDirectory -WindowStyle Hidden -PassThru
$deadline = $started.AddMilliseconds([int]$spec.timeoutMs)
while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $process.Refresh()
}
if (-not $process.HasExited) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
  $owned = [System.Collections.Generic.HashSet[uint32]]::new()
  [void]$owned.Add([uint32]$process.Id)
  do {
    $added = $false
    foreach ($candidate in $all) {
      if ($owned.Contains([uint32]$candidate.ParentProcessId) -and $owned.Add([uint32]$candidate.ProcessId)) { $added = $true }
    }
  } while ($added)
  $tree = @($all | Where-Object { $owned.Contains([uint32]$_.ProcessId) })
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $windows = @()
  $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
  foreach ($window in @([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition))) {
    $children = @($window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
      if ($_.Current.Name) { [PSCustomObject]@{ name=$_.Current.Name; type=$_.Current.ControlType.ProgrammaticName; offscreen=$_.Current.IsOffscreen } }
    })
    $windows += [PSCustomObject]@{ name=$window.Current.Name; class=$window.Current.ClassName; offscreen=$window.Current.IsOffscreen; children=$children }
  }
  foreach ($item in @($tree | Sort-Object ProcessId -Descending)) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
  }
  throw "Timed out after $($spec.timeoutMs) ms. Process tree: $($tree | ConvertTo-Json -Compress -Depth 4). Windows: $($windows | ConvertTo-Json -Compress -Depth 6)"
}
if ($process.ExitCode -ne 0) { throw "Installer process exited with code $($process.ExitCode)." }
[PSCustomObject]@{ exitCode=$process.ExitCode; processId=$process.Id; elapsedMs=[int]((Get-Date) - $started).TotalMilliseconds } | ConvertTo-Json -Compress
`, { file, arguments: argumentsString, workingDirectory: fixture, timeoutMs }, timeoutMs + 30000);
}

async function waitFor(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${message}`);
}

async function waitForNoPaperBridgeProcesses(message) {
  await waitFor(async () => (await inspectMachine()).processes.length === 0, message, 30000);
}

async function run() {
  if (process.platform !== 'win32') throw new Error('This installer test requires Windows.');
  const preflightOnly = process.argv.includes('--preflight');
  if (!preflightOnly && process.env.PAPERBRIDGE_INSTALLER_E2E !== '1') throw new Error('Opt in with PAPERBRIDGE_INSTALLER_E2E=1, or run --preflight for a read-only check.');
  assert.equal(metadata.build.appId, 'net.paperbridges.windows');
  assert.equal(metadata.name, 'paperbridge-windows');
  assert.equal(metadata.build.productName, 'PaperBridge');
  assert.equal(metadata.build.nsis.oneClick, false);
  assert.equal(metadata.build.nsis.allowToChangeInstallationDirectory, false, 'The assisted installer must keep the safe default path');
  for (const option of ['perMachine', 'script', 'include', 'deleteAppDataOnUninstall']) if (metadata.build.nsis[option]) throw new Error(`Review test safety before using NSIS option ${option}`);
  const source = executable(path.join(root, 'release', `PaperBridge Setup ${metadata.version}.exe`), root);
  const initial = await inspectMachine();
  assertNoProcesses(initial);
  if (initial.registry.length || initial.shortcuts.length) throw new Error(`Refusing existing PaperBridge installation or shortcuts: ${JSON.stringify(initial)}`);
  const updaterCache = safePath(path.join(initial.localAppData, 'paperbridge-windows-updater'), initial.localAppData);
  if (fs.existsSync(updaterCache)) throw new Error(`Refusing existing installer cache: ${updaterCache}`);
  const fixture = safePath(path.join(artifacts, `i-${Date.now().toString(36)}-${process.pid.toString(36)}`), artifacts);
  const installDir = safePath(path.join(fixture, 'PaperBridge'), artifacts);
  const longestInstalledPath = longestPackagedPath(installDir);
  if (longestInstalledPath.length >= 260) throw new Error(`Test install path would exceed the NSIS update limit: ${JSON.stringify(longestInstalledPath)}`);
  if (fs.existsSync(fixture)) throw new Error('Installer fixture must be new.');
  const plan = { version: metadata.version, source, installerSha256: hash(source), fixture, installDir, updaterCache, longestInstalledPath,
    coverage: 'Real NSIS install, same-version reinstall, uninstall; isolated workspace preservation. Not a cross-version update.' };
  if (preflightOnly) { console.log(JSON.stringify({ preflight: 'passed', ...plan }, null, 2)); return; }

  fs.mkdirSync(path.join(fixture, 'input'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'runner'));
  const installer = path.join(fixture, 'input', path.basename(source));
  fs.copyFileSync(source, installer);
  assert.equal(hash(installer), plan.installerSha256);
  const workspace = safePath(path.join(fixture, 'workspace'), artifacts);
  const profile = safePath(path.join(fixture, 'profile'), artifacts);
  const tools = safePath(path.join(fixture, 'tools'), artifacts);
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const report = { ...plan, startedAt: new Date().toISOString(), stages: [] };
  const record = (stage, details = {}) => { report.stages.push({ stage, at: new Date().toISOString(), ...details }); fs.writeFileSync(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2)); console.log(stage); };
  let app;
  let installationAttempted = false;
  let uninstalled = false;
  let paperId;
  let savedPaper;
  const installedExe = path.join(installDir, 'PaperBridge.exe');
  const paperFile = () => path.join(workspace, 'papers', `${paperId}.json`);
  const launch = async () => {
    executable(installedExe, fixture);
    app = await electron.launch({ executablePath: installedExe, args: [`--user-data-dir=${profile}`], cwd: fixture,
      env: { ...process.env, PAPERBRIDGE_WORKSPACE: workspace, PAPERBRIDGE_TOOLS_ROOT: tools }, timeout: 30000 });
    const actual = await app.evaluate(({ app }) => ({ version: app.getVersion(), executable: process.execPath, userData: app.getPath('userData') }));
    assert.equal(path.resolve(actual.executable).toLowerCase(), installedExe.toLowerCase());
    assert.equal(path.resolve(actual.userData).toLowerCase(), profile.toLowerCase(), 'Chromium profile must be isolated');
    assert.equal(actual.version, metadata.version);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    return page;
  };
  const uninstall = async () => {
    const state = await inspectMachine();
    assertOwned(state, installDir);
    const sourceUninstaller = executable(path.join(installDir, 'Uninstall PaperBridge.exe'), fixture);
    const runner = path.join(fixture, 'runner', 'Uninstall PaperBridge.exe');
    safePath(runner, fixture);
    fs.copyFileSync(sourceUninstaller, runner);
    assert.equal(hash(runner), hash(sourceUninstaller));
    await runHidden(runner, `/S /currentuser _?=${safePath(installDir, fixture)}`, fixture);
    const after = await inspectMachine();
    assertNoProcesses(after);
    assert.deepEqual(after.registry, [], 'Uninstall must remove its registration');
    assert.deepEqual(after.shortcuts, [], 'Uninstall must remove its shortcuts');
    assert.equal(fs.existsSync(installedExe), false, 'Installed executable must be removed');
    uninstalled = true;
  };

  try {
    // Recheck immediately before every installer mutation, including same-version reinstall.
    const before = await inspectMachine();
    assertNoProcesses(before);
    assert.deepEqual(before.registry, []);
    assert.deepEqual(before.shortcuts, []);
    assert.equal(fs.existsSync(updaterCache), false);
    installationAttempted = true;
    const firstInstall = await runHidden(installer, `/S /currentuser /D=${installDir}`, fixture);
    let state = await inspectMachine();
    assertOwned(state, installDir);
    assert.ok(state.registry.some(entry => entry.type === 'install'));
    assert.ok(state.registry.some(entry => entry.type === 'uninstall'));
    record('Installed at the requested isolated absolute path', { elapsedMs: firstInstall.elapsedMs, registry: state.registry });
    let page = await launch();
    await page.locator('.welcome').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Try a Practice Paper' }).first().click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-2 .source-text').waitFor();
    await page.evaluate(() => {
      const source = document.querySelector('#block-2 .source-text');
      const text = document.createTreeWalker(source, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(12, text.length));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector blockquote').waitFor();
    await page.locator('.inspector .highlight.amber').click();
    await page.locator('.inspector textarea').fill(note);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.locator('#block-2 .block-notes').getByText(note, { exact: false }).waitFor();
    await waitFor(async () => {
      const snapshot = await page.evaluate(() => window.paperBridge.bootstrap());
      paperId = snapshot.lastPaperId;
      if (!paperId || !fs.existsSync(paperFile())) return false;
      const block = JSON.parse(fs.readFileSync(paperFile(), 'utf8')).blocks.find(block => block.id === 2);
      return block.highlights?.length && block.notes?.some(item => item.body === note);
    }, 'practice paper and annotation to save');
    await app.close(); app = null;
    await waitForNoPaperBridgeProcesses('installed app processes to exit before reinstall');
    savedPaper = JSON.parse(fs.readFileSync(paperFile(), 'utf8'));
    record('Installed app saved a practice paper, highlight, and note', { paperId });

    assertOwned(await inspectMachine(), installDir);
    assert.equal(hash(installer), plan.installerSha256, 'Reinstall must use the exact same installer');
    const reinstall = await runHidden(installer, `/S /currentuser /D=${safePath(installDir, fixture)}`, fixture);
    assertOwned(await inspectMachine(), installDir);
    assert.deepEqual(JSON.parse(fs.readFileSync(paperFile(), 'utf8')), savedPaper, 'Same-version reinstall must preserve saved paper data');
    page = await launch();
    await page.locator('.title-wrap h1').getByText(savedPaper.name, { exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-2 .source-text mark').waitFor();
    await page.locator('#block-2 .block-notes').getByText(note, { exact: false }).waitFor();
    await app.close(); app = null;
    await waitForNoPaperBridgeProcesses('reinstalled app processes to exit before uninstall');
    const beforeUninstall = hash(paperFile());
    record('Same-version reinstall reopened the saved paper with its highlight and note', { elapsedMs: reinstall.elapsedMs });
    await uninstall();
    assert.equal(hash(paperFile()), beforeUninstall, 'Uninstall must preserve the isolated saved paper and annotation');
    assert.equal(fs.existsSync(path.join(workspace, 'settings.json')), true);
    record('Uninstalled the app; isolated paper data and settings remain intact');
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    throw error;
  } finally {
    await app?.close();
    if (installationAttempted && !uninstalled && fs.existsSync(path.join(installDir, 'Uninstall PaperBridge.exe'))) {
      try { await uninstall(); record('Cleaned up this test installation after failure'); }
      catch (error) { report.cleanupError = error.stack; console.error(`Test installation remains for inspection: ${installDir}\n${error.message}`); }
    }
    // NSIS writes one installer cache outside /D. Remove only a newly created, matching file.
    if (installationAttempted && fs.existsSync(updaterCache)) {
      const cachedInstaller = safeUpdaterFile(updaterCache, initial.localAppData);
      if (uninstalled && fs.existsSync(cachedInstaller) && hash(cachedInstaller) === plan.installerSha256 && fs.readdirSync(updaterCache).length === 1) {
        fs.unlinkSync(cachedInstaller);
        fs.rmdirSync(updaterCache);
        report.updaterCacheCleaned = true;
      } else {
        report.cleanupError = `${report.cleanupError || ''}\nUpdater cache changed or installation remains; cache left untouched: ${updaterCache}`;
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Installer lifecycle report: ${path.join(fixture, 'report.json')}`);
    if (report.cleanupError) throw new Error(report.cleanupError);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
