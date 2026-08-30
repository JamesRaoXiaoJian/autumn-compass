#requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateNotNullOrEmpty()]
    [ValidateScript({
        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($_)) {
            throw 'TaskName cannot contain wildcard characters.'
        }
        return $true
    })]
    [string]$TaskName = 'Autumn Compass Recruitment Maintenance'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module ScheduledTasks -ErrorAction Stop

$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "Scheduled task '$TaskName' is not installed."
    exit 0
}

if ($PSCmdlet.ShouldProcess($TaskName, 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task '$TaskName' was removed."
}
