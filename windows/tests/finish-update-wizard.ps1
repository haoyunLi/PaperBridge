# Observe public download confirmation, or exercise the published build's own wizard on a fresh runner.
param([switch]$ObservePublic)
$ErrorActionPreference = 'Stop'
# The parent job uses PowerShell 7. Use desktop PowerShell's own in-box UI and hashing modules.
$env:PSModulePath = "$PSHOME\Modules"
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'This check requires a clean GitHub Windows runner.' }
$reportFile = Join-Path $PSScriptRoot '../test-artifacts/installed-update.json'
$report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
$feed = $env:PAPERBRIDGE_VERIFIED_FEED | ConvertFrom-Json
$installed = [IO.Path]::GetFullPath($env:PAPERBRIDGE_TEST_EXECUTABLE)
if ($installed -ne (Join-Path $env:RUNNER_TEMP 'PaperBridge update delivery\PaperBridge.exe')) { throw 'Unexpected installation path.' }
$setupName = "PaperBridge-Windows-$($feed.version)-x64-Setup"
$setupPath = if ($ObservePublic) {
    if ($report.internetZone -ne 3 -or $report.sha256 -ne $feed.files.Setup.sha256) { throw 'Missing verified public handoff.' }
    Join-Path $env:LOCALAPPDATA "PaperBridge\update-downloads\$setupName.exe"
} else {
    Join-Path $env:RUNNER_TEMP "PaperBridge release build\$setupName.exe"
}
if ($report.to -ne $feed.version -or (Get-FileHash -LiteralPath $setupPath).Hash -ne $feed.files.Setup.sha256) { throw 'Unexpected installer.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$wizard = [ordered]@{ steps = @(); version = $feed.version }
function Save-Step($message) {
    $wizard.steps += $message
    Write-Host $message
    $report | Add-Member -MemberType NoteProperty -Name wizard -Value $wizard -Force
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportFile -Encoding UTF8
}
# On Server 2025 the MSAA proxy can expose standard NSIS buttons as UIA panes.
# Restrict button messages to native child buttons of the exact verified Setup process.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SetupButton {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int capacity);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    public static bool Owned(IntPtr main, IntPtr child, uint process) {
        uint pid;
        var name = new StringBuilder(32);
        return child != IntPtr.Zero && IsChild(main, child) && IsWindowEnabled(child) &&
            GetWindowThreadProcessId(child, out pid) != 0 && pid == process &&
            GetClassName(child, name, name.Capacity) != 0 && name.ToString() == "Button";
    }
    public static bool Checked(IntPtr h) { return SendMessage(h, 0x00F0, IntPtr.Zero, IntPtr.Zero).ToInt64() == 1; }
    public static void Click(IntPtr h) {
        if (!PostMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("Could not activate Setup button");
    }
}
"@
if (!$ObservePublic) {
    Save-Step 'Opening the release build from the build artifact after verifying its public SHA-256'
    Start-Process -FilePath $setupPath -WindowStyle Normal
}
$deadline = [DateTime]::UtcNow.AddSeconds(100)
$finished = $false
$lastButton = ''
while ([DateTime]::UtcNow -lt $deadline -and !$finished) {
    $owner = Get-Process -Name $setupName -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $setupPath -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (!$owner) {
        if ($ObservePublic -and (Get-Process -Name smartscreen -ErrorAction SilentlyContinue)) {
            $named = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, 'Windows Defender SmartScreen')
            $prompt = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Descendants, $named)
            if ($prompt -and !$prompt.Current.IsOffscreen) {
                $wizard.result = 'requires Windows user confirmation'
                Save-Step 'The Internet-marked public download opened Windows Defender SmartScreen'
                exit 0
            }
        }
        Start-Sleep -Milliseconds 350; continue
    }
    $window = [Windows.Automation.AutomationElement]::FromHandle($owner.MainWindowHandle)
    if ($window.Current.ProcessId -ne $owner.Id) { throw 'Unexpected window owner.' }
    if (!$wizard.Contains('installerPid')) {
        $wizard.installerPid = $owner.Id
        Save-Step "Visible installer window: $($window.Current.Name)"
        if ($ObservePublic) { $wizard.result = 'public installer visible'; Save-Step 'The public Setup window is visible'; exit 0 }
    }
    $buttons = @($window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
        Where-Object { [SetupButton]::Owned($owner.MainWindowHandle, $_.Current.NativeWindowHandle, $owner.Id) })
    $scope = $buttons | Where-Object { ($_.Current.Name -replace '&','') -match 'only for me|just for me|current user' } | Select-Object -First 1
    if ($scope -and ![SetupButton]::Checked($scope.Current.NativeWindowHandle)) {
        [SetupButton]::Click($scope.Current.NativeWindowHandle)
        Start-Sleep -Milliseconds 250
        continue
    }
    $button = $buttons | Where-Object { ($_.Current.Name -replace '&','').Trim() -match '^(Next\s*>?|Install|Finish)$' } | Select-Object -First 1
    if (!$button) { Start-Sleep -Milliseconds 400; continue }
    $action = ($button.Current.Name -replace '&','').Trim()
    if ($action -eq $lastButton) { Start-Sleep -Milliseconds 350; continue }
    if ($action -eq 'Finish') {
        $run = $buttons |
            Where-Object { ($_.Current.Name -replace '&','') -match '^Run PaperBridge\b' } | Select-Object -First 1
        if (!$run) { throw 'The Finish page did not offer to run PaperBridge.' }
        if (![SetupButton]::Checked($run.Current.NativeWindowHandle)) { throw 'Run PaperBridge was not selected by default.' }
        Save-Step 'Run PaperBridge was selected on the Finish page'
    }
    [SetupButton]::Click($button.Current.NativeWindowHandle)
    Save-Step "Invoked $action in the verified installer"
    $lastButton = $action
    $finished = $action -eq 'Finish'
    Start-Sleep -Milliseconds 400
}
if (!$finished) {
    $trace = Join-Path (Split-Path $reportFile) 'windows-shell-open.json'
    if (Test-Path -LiteralPath $trace) { Write-Host ("ShellExecute result: " + (Get-Content -LiteralPath $trace -Raw)) }
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match 'paperbridge|smartscreen|consent|openwith|rundll32|dllhost'
    } | ForEach-Object { Write-Host "Process: $($_.ProcessName) | $($_.Id) | $($_.MainWindowTitle)" }
    $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
    foreach ($candidate in $windows) {
        $owner = Get-Process -Id $candidate.Current.ProcessId -ErrorAction SilentlyContinue
        Write-Host "Window: $($owner.ProcessName) | $($candidate.Current.Name)"
        $other = $candidate.FindAll([Windows.Automation.TreeScope]::Descendants,
            (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)))
        foreach ($item in $other) { Write-Host "Owned dialog: $($item.Current.Name)" }
        if ($candidate.Current.Name -match 'Setup|Security|Windows protected|SmartScreen|Open File' -or $owner.ProcessName -eq 'PaperBridge') {
            $labels = $candidate.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
            Write-Host (($labels | Where-Object { $_.Current.Name } | Select-Object -First 25 | ForEach-Object {
                "$($_.Current.Name) [$($_.Current.ControlType.ProgrammaticName), enabled=$($_.Current.IsEnabled), offscreen=$($_.Current.IsOffscreen)]"
            }) -join ' | ')
        }
    }
    throw "The verified installer did not reach Finish. Last page action: $lastButton"
}
$deadline = [DateTime]::UtcNow.AddSeconds(50)
do {
    $reader = Get-Process -Name PaperBridge -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $report.oldPID -and $_.Path -eq $installed -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'PaperBridge'
    } | Select-Object -First 1
    if ($reader) { break }
    Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
if (!$reader) { throw 'Finish did not open a visible reader from the original installation.' }
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo($installed).FileVersion
if ($version -ne $feed.version) { throw "Expected $($feed.version) after upgrade, found $version." }
$wizard.readerPid = $reader.Id
$wizard.readerTitle = $reader.MainWindowTitle
Save-Step "Finish opened the installed reader at version $version"
if (!$reader.CloseMainWindow() -or !$reader.WaitForExit(15000)) { throw 'The upgraded reader did not close normally.' }
