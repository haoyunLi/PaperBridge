# Follow the public installer already opened by the installed app, on a disposable runner.
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
$setupPath = Join-Path $env:LOCALAPPDATA "PaperBridge\update-downloads\$setupName.exe"
if ($report.to -ne $feed.version -or $report.sha256 -ne $feed.files.Setup.sha256 -or
    (Get-FileHash -LiteralPath $setupPath).Hash -ne $report.sha256) { throw 'Unexpected installer.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$wizard = [ordered]@{ steps = @(); version = $feed.version }
function Save-Step($message) {
    $wizard.steps += $message
    Write-Host $message
    $report | Add-Member -MemberType NoteProperty -Name wizard -Value $wizard -Force
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportFile -Encoding UTF8
}
function Get-Controls($window, $controlType) {
    $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
    $window.FindAll([Windows.Automation.TreeScope]::Descendants, $condition) |
        Where-Object { $_.Current.IsEnabled -and !$_.Current.IsOffscreen }
}
$deadline = [DateTime]::UtcNow.AddSeconds(115)
$finished = $false
$lastButton = ''
while ([DateTime]::UtcNow -lt $deadline -and !$finished) {
    $owner = Get-Process -Name $setupName -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $setupPath -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (!$owner) { Start-Sleep -Milliseconds 350; continue }
    $window = [Windows.Automation.AutomationElement]::FromHandle($owner.MainWindowHandle)
    if ($window.Current.ProcessId -ne $owner.Id) { throw 'Unexpected window owner.' }
    if (!$wizard.Contains('installerPid')) {
        $wizard.installerPid = $owner.Id
        Save-Step "Visible installer window: $($window.Current.Name)"
    }
    $buttons = @(Get-Controls $window ([Windows.Automation.ControlType]::Button))
    $button = $buttons | Where-Object { ($_.Current.Name -replace '&','').Trim() -match '^(Next\s*>?|Install|Finish)$' } | Select-Object -First 1
    if (!$button) { Start-Sleep -Milliseconds 400; continue }
    $action = ($button.Current.Name -replace '&','').Trim()
    if ($action -eq $lastButton) { Start-Sleep -Milliseconds 350; continue }
    if ($action -eq 'Finish') {
        $run = Get-Controls $window ([Windows.Automation.ControlType]::CheckBox) |
            Where-Object { ($_.Current.Name -replace '&','') -match '^Run PaperBridge\b' } | Select-Object -First 1
        if (!$run) { throw 'The Finish page did not offer to run PaperBridge.' }
        $checked = $run.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
        if ($checked -ne [Windows.Automation.ToggleState]::On) { throw 'Run PaperBridge was not selected by default.' }
        Save-Step 'Run PaperBridge was selected on the Finish page'
    } else {
        $scope = Get-Controls $window ([Windows.Automation.ControlType]::RadioButton) |
            Where-Object { ($_.Current.Name -replace '&','') -match 'only for me|just for me|current user' } | Select-Object -First 1
        if ($scope) { $scope.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select() }
    }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Save-Step "Invoked $action in the verified installer"
    $lastButton = $action
    $finished = $action -eq 'Finish'
    Start-Sleep -Milliseconds 400
}
if (!$finished) {
    $trace = Join-Path (Split-Path $reportFile) 'windows-shell-open.json'
    Write-Host ("ShellExecute result: " + (Get-Content -LiteralPath $trace -Raw))
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
            Write-Host (($labels | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 25) -join ' | ')
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
