const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

// electron-builder's NSIS installation ID for net.paperbridges.windows.
const installId = '1a046d2c-29e5-5f45-8614-2c68ad2c6d75';
function windowsPowerShell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function isCurrentUserInstallation(executable = process.execPath) {
  if (process.platform !== 'win32') return false;
  const script = `$ErrorActionPreference='Stop'
    foreach ($view in 'Registry32','Registry64') {
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser',$view)
      try {
        $key=$base.OpenSubKey('Software\\${installId}')
        if ($null -eq $key) { continue }
        try {
          $folder=$key.GetValue('InstallLocation')
          if ($folder -and [IO.Path]::GetFullPath([IO.Path]::Combine($folder, 'PaperBridge.exe')) -eq $env:PAPERBRIDGE_RUNNING_APP) {
            Write-Output 'registered'; break
          }
        } finally { $key.Dispose() }
      } finally { $base.Dispose() }
    }`;
  try {
    const { stdout } = await run(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 5000, env: { ...process.env, PAPERBRIDGE_RUNNING_APP: executable }
    });
    return stdout.trim() === 'registered';
  } catch { return false; }
}

async function launchRestartingInstaller(filename, parentWindow) {
  if (!await isCurrentUserInstallation()) throw new Error('Use Open installer to update this copy with the Windows setup wizard.');
  // The Windows shell opens the Internet-marked file under the current user's
  // normal execution policy. NSIS replaces this installation and relaunches it.
  const script = `$ErrorActionPreference='Stop'
    $start=New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName=$env:PAPERBRIDGE_VERIFIED_INSTALLER
    $start.UseShellExecute=$true
    $start.ErrorDialog=$true
    $start.ErrorDialogParentHandle=[IntPtr]([long]$env:PAPERBRIDGE_READER_HWND)
    $start.Verb='open'
    $start.Arguments='/S /currentuser --updated --force-run'
    $process=[Diagnostics.Process]::Start($start)
    if ($null -eq $process) { throw 'Windows did not start the installer.' }
    $process.Dispose()`;
  try {
    await new Promise((resolve, reject) => {
      // Descendant installer handles must not hold the reader open while NSIS waits for it to exit.
      const child = spawn(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env, PAPERBRIDGE_VERIFIED_INSTALLER: filename, PAPERBRIDGE_READER_HWND: parentWindow.readBigUInt64LE(0).toString() }
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Windows declined the launch.')));
    });
  } catch { throw new Error('Windows did not open the verified installer. Your paper is saved. You can try Open installer.'); }
}

module.exports = { isCurrentUserInstallation, launchRestartingInstaller, installId };
