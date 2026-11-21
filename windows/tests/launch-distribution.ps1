# Test the actual GUI executable from an unrelated working directory, without
# a debugging port, Electron CLI, development server, or launch arguments.
param([Parameter(Mandatory)][string] $Executable, [switch] $CheckRelaunch)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('PaperBridge smoke ' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'Skip setup')
if (!('PaperBridgeSmoke.ReaderInput' -as [type])) {
    Add-Type -Namespace PaperBridgeSmoke -Name ReaderInput -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PostMessage(System.IntPtr hwnd, uint message, System.IntPtr key, System.IntPtr flags);
'@
}
$original = @{}
$testEnvironment = @{
    ELECTRON_RUN_AS_NODE = '1'
    VITE_DEV_SERVER_URL = 'http://127.0.0.1:1/'
    PAPERBRIDGE_WORKSPACE = Join-Path $root 'workspace'
    PAPERBRIDGE_TOOLS_ROOT = Join-Path $root 'tools'
}
$launcher = $null
$windowProcess = $null
$secondLauncher = $null
try {
    foreach ($name in $testEnvironment.Keys) {
        $original[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $testEnvironment[$name])
    }
    $launcher = Start-Process -FilePath $binary -WorkingDirectory $root -PassThru
    $owned = @($launcher.Id)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $ready = $false
    $pressedEscape = [DateTime]::MinValue
    $settingsFile = Join-Path $testEnvironment.PAPERBRIDGE_WORKSPACE 'settings.json'
    do {
        if ($launcher.HasExited) { throw "Launcher exited before onboarding (exit $($launcher.ExitCode))" }
        # The Portable wrapper extracts a second executable. Only inspect
        # windows belonging to this launch or its descendants.
        $children = @(Get-CimInstance Win32_Process -Filter "Name = 'PaperBridge.exe'" |
            Where-Object { $owned -contains $_.ParentProcessId })
        $owned = @($owned + @($children | ForEach-Object { [int]$_.ProcessId }) | Select-Object -Unique)
        foreach ($processId in $owned) {
            $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if (!$candidate -or $candidate.MainWindowHandle -eq 0 -or $candidate.MainWindowTitle -ne 'PaperBridge') { continue }
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($candidate.MainWindowHandle)
            if (!$windowProcess -or $windowProcess.Id -ne $candidate.Id) {
                # A background shell may launch the reader behind the test runner.
                try { $window.SetFocus() } catch [System.InvalidOperationException] {}
            }
            $windowProcess = $candidate
            if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
                $ready = $true
                Write-Output 'Observed the Skip setup button through UI Automation'
                break
            }
            # Some Windows sessions expose the native menu through UI Automation
            # before Chromium publishes its accessibility tree. Escape dismisses
            # onboarding and saves its completion only through the live renderer.
            if (Test-Path -LiteralPath $settingsFile) {
                $saved = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
                if ($pressedEscape -ne [DateTime]::MinValue -and $saved.onboardingCompletedVersion -ge 1) {
                    $ready = $true
                    Write-Output 'Verified the guide handled a native Escape key and saved onboarding completion'
                    break
                }
                if ([DateTime]::UtcNow -gt $pressedEscape.AddSeconds(1)) {
                    $null = [PaperBridgeSmoke.ReaderInput]::PostMessage($candidate.MainWindowHandle, 0x0100, [IntPtr]27, [IntPtr]0x10001)
                    $null = [PaperBridgeSmoke.ReaderInput]::PostMessage($candidate.MainWindowHandle, 0x0101, [IntPtr]27, [IntPtr](-1073676287))
                    $pressedEscape = [DateTime]::UtcNow
                }
            }
        }
        if (!$ready) { Start-Sleep -Milliseconds 350 }
    } while (!$ready -and [DateTime]::UtcNow -lt $deadline)
    if (!$ready) { throw "The process started but the first-launch guide did not appear: $binary" }
    if ($CheckRelaunch) {
        if (!('PaperBridgeSmoke.WindowState' -as [type])) {
            Add-Type -Namespace PaperBridgeSmoke -Name WindowState -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindowAsync(System.IntPtr hwnd, int command);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hwnd);
'@
        }
        $handle = $windowProcess.MainWindowHandle
        $null = [PaperBridgeSmoke.WindowState]::ShowWindowAsync($handle, 6)
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (![PaperBridgeSmoke.WindowState]::IsIconic($handle) -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 100
        }
        if (![PaperBridgeSmoke.WindowState]::IsIconic($handle)) { throw 'Could not minimize the reader for the second launch' }
        $secondLauncher = Start-Process -FilePath $binary -WorkingDirectory $root -PassThru
        if (!$secondLauncher.WaitForExit(60000) -or $secondLauncher.ExitCode -ne 0) { throw 'The second launch did not hand off to the reader' }
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ([PaperBridgeSmoke.WindowState]::IsIconic($handle) -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 100
        }
        if ($windowProcess.HasExited -or [PaperBridgeSmoke.WindowState]::IsIconic($handle)) { throw 'The existing reader was not restored' }
        Write-Output 'Verified the second launch restored the existing reader window'
    }
    if (!$windowProcess.CloseMainWindow() -or !$launcher.WaitForExit(20000)) { throw 'The application did not close normally' }
    if ($launcher.ExitCode -ne 0) { throw "Unexpected exit code $($launcher.ExitCode)" }
    Write-Output "Verified visible first-launch guide and graceful exit: $([IO.Path]::GetFileName($binary))"
} finally {
    if ($secondLauncher -and !$secondLauncher.HasExited) { & taskkill.exe /PID $secondLauncher.Id /T /F | Out-Null }
    if ($launcher -and !$launcher.HasExited) {
        & taskkill.exe /PID $launcher.Id /T /F | Out-Null
        $null = $launcher.WaitForExit(5000)
    }
    foreach ($name in $original.Keys) { [Environment]::SetEnvironmentVariable($name, $original[$name]) }
    # Keep failed fixtures available for diagnostics.
    if ($ready -and $launcher.HasExited -and $launcher.ExitCode -eq 0) {
        $resolved = (Resolve-Path -LiteralPath $root).Path
        if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
            [IO.Path]::GetFileName($resolved) -match '^PaperBridge smoke [0-9a-f]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
