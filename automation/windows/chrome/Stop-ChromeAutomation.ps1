#requires -Version 7.0

[CmdletBinding()]
param(
    [string] $RuntimeDirectory,
    [switch] $Force
)

. (Join-Path $PSScriptRoot 'ChromeAutomation.Common.ps1')

$runtime = Get-AutumnChromeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
$session = Read-AutumnChromeSession -RuntimeDirectory $runtime
if ($null -eq $session) {
    throw 'No managed Chrome session file was found. Refusing to stop an unknown Chrome process.'
}

if (([string] $session.address) -ne '127.0.0.1') {
    throw "The session file does not describe a loopback-only endpoint. Refusing to continue."
}

$port = [int] $session.port
$profile = Assert-DedicatedChromeProfile -ProfileDirectory ([string] $session.profileDirectory)
$matchingProcesses = Get-ChromeProcessesForSession -ProfileDirectory $profile -Port $port
if ($matchingProcesses.Count -eq 0) {
    if ($null -ne (Get-ChromeDebugVersion -Port $port)) {
        throw 'A DevTools endpoint is active, but no Chrome process matches the managed profile and port. Refusing to stop it.'
    }

    Remove-Item -LiteralPath (Get-AutumnChromeSessionPath -RuntimeDirectory $runtime) -Force
    [pscustomobject]@{ Stopped = $true; AlreadyStopped = $true; Port = $port }
    return
}

$needsForcedTermination = $false
$version = Get-ChromeDebugVersion -Port $port
if ($null -ne $version -and -not [string]::IsNullOrWhiteSpace($version.webSocketDebuggerUrl)) {
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $timeoutSource = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(5))
    try {
        $socket.ConnectAsync([Uri] $version.webSocketDebuggerUrl, $timeoutSource.Token).GetAwaiter().GetResult()
        $payload = [System.Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Browser.close"}')
        $socket.SendAsync(
            [System.ArraySegment[byte]]::new($payload),
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            $timeoutSource.Token
        ).GetAwaiter().GetResult()
    }
    catch {
        Write-Warning "Chrome did not accept Browser.close: $($_.Exception.Message)"
    }
    finally {
        $socket.Dispose()
        $timeoutSource.Dispose()
    }
}
elseif (-not $Force) {
    throw 'The managed Chrome process exists but CDP is unavailable. Re-run with -Force to terminate only the matching process.'
}
else {
    $needsForcedTermination = $true
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds(8)
while ([DateTimeOffset]::UtcNow -lt $deadline -and (Test-LoopbackPortOpen -Port $port)) {
    Start-Sleep -Milliseconds 250
}

if (Test-LoopbackPortOpen -Port $port) {
    if (-not $Force) {
        throw 'Chrome is still running. Re-run with -Force to terminate only processes matching the dedicated profile and port.'
    }

    $needsForcedTermination = $true
}

if ($needsForcedTermination) {
    $matchingProcesses = Get-ChromeProcessesForSession -ProfileDirectory $profile -Port $port
    foreach ($chromeProcess in $matchingProcesses) {
        Stop-Process -Id $chromeProcess.ProcessId -Force -ErrorAction Stop
    }

    $forceDeadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
    while ([DateTimeOffset]::UtcNow -lt $forceDeadline -and (Test-LoopbackPortOpen -Port $port)) {
        Start-Sleep -Milliseconds 250
    }
}

if (Test-LoopbackPortOpen -Port $port) {
    throw "Port $port remains active. The endpoint was not stopped, and the session file was preserved."
}

Remove-Item -LiteralPath (Get-AutumnChromeSessionPath -RuntimeDirectory $runtime) -Force
[pscustomobject]@{
    Stopped          = $true
    AlreadyStopped   = $false
    Port             = $port
    ProfilePreserved = $profile
}
