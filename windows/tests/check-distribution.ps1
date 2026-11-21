# Run only on disposable CI machines: NSIS creates per-user registry entries.
param([Parameter(Mandatory)][string] $Directory, [Parameter(Mandatory)][string] $Version)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Actual installation requires a fresh GitHub-hosted Windows runner.'
}
$dir = (Resolve-Path -LiteralPath $Directory).Path
$install = Join-Path $env:RUNNER_TEMP ('PaperBridge-' + [guid]::NewGuid().ToString('N'))
$setup = Join-Path $dir "PaperBridge-Windows-$Version-x64-Setup.exe"
$portable = Join-Path $dir "PaperBridge-Windows-$Version-x64-Portable.exe"
& "$PSScriptRoot/launch-distribution.ps1" -Executable $portable
function Run-NSIS([string] $File, [string] $Arguments) {
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (!$p.WaitForExit(180000)) { throw "NSIS timed out: $File" }
    if ($p.ExitCode -ne 0) { throw "NSIS failed: $File ($($p.ExitCode))" }
}
try {
    Run-NSIS $setup "/S /currentuser /D=$install"
    $exe = Join-Path $install 'PaperBridge.exe'
    if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $Version) { throw 'Installed version mismatch' }
    & "$PSScriptRoot/launch-distribution.ps1" -Executable $exe
} finally {
    $uninstall = Join-Path $install 'Uninstall PaperBridge.exe'
    if (Test-Path -LiteralPath $uninstall) { Run-NSIS $uninstall "/S /currentuser _?=$install" }
}
