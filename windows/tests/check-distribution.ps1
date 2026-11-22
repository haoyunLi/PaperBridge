# Run only on disposable CI machines: NSIS creates per-user registry entries.
param([Parameter(Mandatory)][string] $Directory, [Parameter(Mandatory)][string] $Version, [string] $MacReference)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Actual installation requires a fresh GitHub-hosted Windows runner.'
}
$dir = (Resolve-Path -LiteralPath $Directory).Path
$install = Join-Path $env:RUNNER_TEMP ('PaperBridge-' + [guid]::NewGuid().ToString('N'))
$setup = Join-Path $dir "PaperBridge-Windows-$Version-x64-Setup.exe"
$portable = Join-Path $dir "PaperBridge-Windows-$Version-x64-Portable.exe"
& "$PSScriptRoot/launch-distribution.ps1" -Executable $portable -CheckRelaunch
function Run-NSIS([string] $File, [string] $Arguments) {
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (!$p.WaitForExit(180000)) { throw "NSIS timed out: $File" }
    if ($p.ExitCode -ne 0) { throw "NSIS failed: $File ($($p.ExitCode))" }
}
try {
    Run-NSIS $setup "/S /currentuser /D=$install"
    $exe = Join-Path $install 'PaperBridge.exe'
    # Electron embeds a four-part Windows resource version. The NSIS wrappers
    # and package.json normally use three parts for the same release.
    $installedVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    if ($installedVersion -notin @($Version, "$Version.0")) {
        throw "Installed version $installedVersion does not match release $Version"
    }
    & "$PSScriptRoot/launch-distribution.ps1" -Executable $exe -CheckRelaunch
    if ($MacReference) {
        $previousExecutable = $env:PAPERBRIDGE_TEST_EXECUTABLE
        $previousReference = $env:PAPERBRIDGE_MAC_REFERENCE
        try {
            $env:PAPERBRIDGE_TEST_EXECUTABLE = $exe
            $env:PAPERBRIDGE_MAC_REFERENCE = (Resolve-Path -LiteralPath $MacReference).Path
            node "$PSScriptRoot/import-modes-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed app failed the native PDF import comparison' }
            node "$PSScriptRoot/scanned-original-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed app failed the offline scanned PDF comparison' }
            node "$PSScriptRoot/pdf-journal-export-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed app failed the journal reading and bilingual export comparison' }
            node "$PSScriptRoot/markdown-navigation-e2e.cjs" --reflow --modes --table --full-table
            if ($LASTEXITCODE -ne 0) { throw 'Installed reader failed the Markdown heading navigation and position restore checks' }
            node "$PSScriptRoot/translation-range-actions-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed app failed the translation range comparison' }
            node "$PSScriptRoot/structured-draft-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed reader did not restore structured translation formatting' }
            node "$PSScriptRoot/connected-translation-e2e.cjs"
            if ($LASTEXITCODE -ne 0) { throw 'Installed app failed connected translation and bibliography checks' }
        } finally {
            $env:PAPERBRIDGE_TEST_EXECUTABLE = $previousExecutable
            $env:PAPERBRIDGE_MAC_REFERENCE = $previousReference
        }
    }
} finally {
    $uninstall = Join-Path $install 'Uninstall PaperBridge.exe'
    if (Test-Path -LiteralPath $uninstall) { Run-NSIS $uninstall "/S /currentuser _?=$install" }
}
