# Test the actual GUI executable from an unrelated working directory, without
# a debugging port, Electron CLI, development server, or launch arguments.
param([Parameter(Mandatory)][string] $Executable)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('PaperBridge smoke ' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'Skip setup')
$original = @{}
$testEnvironment = @{
    ELECTRON_RUN_AS_NODE = '1'
    VITE_DEV_SERVER_URL = 'http://127.0.0.1:1/'
    PAPERBRIDGE_WORKSPACE = Join-Path $root 'workspace'
    PAPERBRIDGE_TOOLS_ROOT = Join-Path $root 'tools'
}
$launcher = $null
$windowProcess = $null
try {
    foreach ($name in $testEnvironment.Keys) {
        $original[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $testEnvironment[$name])
    }
    $launcher = Start-Process -FilePath $binary -WorkingDirectory $root -PassThru
    $owned = @($launcher.Id)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $ready = $false
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
            $windowProcess = $candidate
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($candidate.MainWindowHandle)
            if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
                $ready = $true
                break
            }
        }
        if (!$ready) { Start-Sleep -Milliseconds 350 }
    } while (!$ready -and [DateTime]::UtcNow -lt $deadline)
    if (!$ready) { throw "The process started but the first-launch guide did not appear: $binary" }
    if (!$windowProcess.CloseMainWindow() -or !$launcher.WaitForExit(20000)) { throw 'The application did not close normally' }
    if ($launcher.ExitCode -ne 0) { throw "Unexpected exit code $($launcher.ExitCode)" }
    Write-Output "Verified visible first-launch guide and graceful exit: $([IO.Path]::GetFileName($binary))"
} finally {
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
