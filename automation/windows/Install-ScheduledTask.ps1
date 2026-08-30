#requires -Version 5.1

[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [ValidateScript({
        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($_)) {
            throw 'TaskName cannot contain wildcard characters.'
        }
        return $true
    })]
    [string]$TaskName = 'Autumn Compass Recruitment Maintenance',

    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
    [string]$DailyAt = '03:30',

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-PowerShellExecutable {
    $command = Get-Command -Name 'pwsh.exe' -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($null -eq $command) {
        $command = Get-Command -Name 'powershell.exe' -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }

    if ($null -eq $command) {
        throw 'Neither pwsh.exe nor powershell.exe was found on PATH.'
    }

    return $command.Path
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runnerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Run-JobMaintenance.ps1')).Path
$powerShellExecutable = Resolve-PowerShellExecutable

Import-Module ScheduledTasks -ErrorAction Stop

$existingTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask -and -not $Force) {
    throw "Scheduled task '$TaskName' already exists. Re-run with -Force only if you intend to replace it."
}

Write-Host 'Running maintenance preflight before registering the scheduled task...'
& $powerShellExecutable `
    -NoLogo `
    -NoProfile `
    -NonInteractive `
    -ExecutionPolicy Bypass `
    -File $runnerPath `
    -Check

if ($LASTEXITCODE -ne 0) {
    throw "Maintenance preflight failed with exit code $LASTEXITCODE. The task was not registered."
}

$scheduledTime = [datetime]::MinValue
$parsed = [datetime]::TryParseExact(
    $DailyAt,
    'HH:mm',
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::None,
    [ref]$scheduledTime
)
if (-not $parsed) {
    throw "DailyAt must use 24-hour HH:mm format: $DailyAt"
}

$escapedRunnerPath = $runnerPath.Replace('"', '""')
$actionArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $escapedRunnerPath
$action = New-ScheduledTaskAction `
    -Execute $powerShellExecutable `
    -Argument $actionArguments `
    -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $scheduledTime
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 30)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited
$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Audits Autumn Compass recruitment data and leaves validated changes uncommitted for review.'

$registerParameters = @{
    TaskName = $TaskName
    TaskPath = '\'
    InputObject = $task
}
if ($Force) {
    $registerParameters.Force = $true
}

Register-ScheduledTask @registerParameters | Out-Null

Write-Host "Scheduled task '$TaskName' was installed for $DailyAt local time."
Write-Host 'It runs only while this Windows user is logged on and does not store the account password.'
Write-Host "Run now: Start-ScheduledTask -TaskName '$TaskName'"
