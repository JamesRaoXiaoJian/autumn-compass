#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateScript({ $_ -eq 0 -or ($_ -ge 1024 -and $_ -le 65535) })]
    [int] $Port = 0,
    [string] $RuntimeDirectory,
    [switch] $AsJson
)

. (Join-Path $PSScriptRoot 'ChromeAutomation.Common.ps1')

$runtime = Get-AutumnChromeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
$session = Read-AutumnChromeSession -RuntimeDirectory $runtime

if ($Port -gt 0) {
    $effectivePort = $Port
}
elseif ($null -ne $session) {
    $effectivePort = [int] $session.Port
}
else {
    $effectivePort = 9222
}

$version = Get-ChromeDebugVersion -Port $effectivePort
$processes = @()
if ($null -ne $session -and $null -ne $session.profileDirectory) {
    $processArguments = @{
        ProfileDirectory = [string] $session.profileDirectory
        Port             = $effectivePort
    }
    $processes = Get-ChromeProcessesForSession @processArguments
}

$managedRunning = ($null -ne $session -and $null -ne $version -and $processes.Count -gt 0)
$result = [pscustomobject]@{
    Running              = $managedRunning
    Managed              = $managedRunning
    StatePresent         = ($null -ne $session)
    EndpointReachable    = ($null -ne $version)
    Address              = '127.0.0.1'
    Port                 = $effectivePort
    ProcessMatchesState  = ($processes.Count -gt 0)
    ProcessIds           = @($processes | ForEach-Object { $_.ProcessId })
    ProfileDirectory     = if ($null -ne $session) { $session.profileDirectory } else { $null }
    ExtensionDirectory   = if ($null -ne $session) { $session.extensionDirectory } else { $null }
    Browser              = if ($null -ne $version) { $version.Browser } else { $null }
    WebSocketDebuggerUrl = if ($null -ne $version) { $version.webSocketDebuggerUrl } else { $null }
    StateFile            = Get-AutumnChromeSessionPath -RuntimeDirectory $runtime
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 6
}
else {
    $result
}
