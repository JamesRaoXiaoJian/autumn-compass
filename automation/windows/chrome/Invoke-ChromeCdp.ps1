#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateScript({ $_ -eq 0 -or ($_ -ge 1024 -and $_ -le 65535) })]
    [int] $Port = 0,
    [string] $RuntimeDirectory,

    [ValidateSet('Version', 'Targets', 'NewTarget', 'CloseTarget', 'Command')]
    [string] $Action = 'Targets',

    [string] $TargetId,
    [string] $Url,
    [string] $Method,
    [string] $ParamsJson = '{}',
    [switch] $Browser,
    [switch] $AsJson,

    [ValidateRange(1, 120)]
    [int] $TimeoutSeconds = 15
)

. (Join-Path $PSScriptRoot 'ChromeAutomation.Common.ps1')

function Invoke-CdpWebSocketCommand {
    param(
        [Parameter(Mandatory)] [string] $WebSocketUrl,
        [Parameter(Mandatory)] [string] $CdpMethod,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $CdpParams,
        [Parameter(Mandatory)] [int] $Timeout
    )

    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $timeoutSource = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($Timeout))
    try {
        $socket.ConnectAsync([Uri] $WebSocketUrl, $timeoutSource.Token).GetAwaiter().GetResult()

        $request = [ordered]@{
            id     = 1
            method = $CdpMethod
            params = $CdpParams
        } | ConvertTo-Json -Depth 20 -Compress
        $requestBytes = [System.Text.Encoding]::UTF8.GetBytes($request)
        $requestSegment = [System.ArraySegment[byte]]::new($requestBytes)
        $socket.SendAsync(
            $requestSegment,
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            $timeoutSource.Token
        ).GetAwaiter().GetResult()

        while ($true) {
            $buffer = [byte[]]::new(65536)
            $stream = [System.IO.MemoryStream]::new()
            try {
                do {
                    $segment = [System.ArraySegment[byte]]::new($buffer)
                    $received = $socket.ReceiveAsync($segment, $timeoutSource.Token).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                        throw 'Chrome closed the DevTools WebSocket before returning a response.'
                    }
                    $stream.Write($buffer, 0, $received.Count)
                } while (-not $received.EndOfMessage)

                $message = [System.Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                $messageId = $message.PSObject.Properties['id']
                if ($null -ne $messageId -and [int] $messageId.Value -eq 1) {
                    return $message
                }
            }
            finally {
                $stream.Dispose()
            }
        }
    }
    finally {
        $socket.Dispose()
        $timeoutSource.Dispose()
    }
}

$runtime = Get-AutumnChromeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
$effectivePort = Get-ManagedChromePort -RuntimeDirectory $runtime -RequestedPort $Port
$session = Read-AutumnChromeSession -RuntimeDirectory $runtime
if (([string] $session.address) -ne '127.0.0.1') {
    throw 'The managed session is not loopback-only. Refusing to connect.'
}
$managedProcessArguments = @{
    ProfileDirectory = [string] $session.profileDirectory
    Port             = $effectivePort
}
$managedProcesses = Get-ChromeProcessesForSession @managedProcessArguments
if ($managedProcesses.Count -eq 0) {
    throw 'No Chrome process matches the managed profile and port. Refusing to operate an unknown CDP endpoint.'
}
$baseUri = "http://127.0.0.1:$effectivePort"
$version = Get-ChromeDebugVersion -Port $effectivePort
if ($null -eq $version) {
    throw "Chrome DevTools is not available at $baseUri."
}

switch ($Action) {
    'Version' {
        $result = $version
    }
    'Targets' {
        $result = Invoke-RestMethod -Uri "$baseUri/json/list" -Method Get -TimeoutSec $TimeoutSeconds
    }
    'NewTarget' {
        if ([string]::IsNullOrWhiteSpace($Url)) {
            throw '-Url is required for NewTarget.'
        }
        $encodedUrl = [System.Uri]::EscapeDataString($Url)
        $result = Invoke-RestMethod -Uri "$baseUri/json/new?$encodedUrl" -Method Put -TimeoutSec $TimeoutSeconds
    }
    'CloseTarget' {
        if ([string]::IsNullOrWhiteSpace($TargetId)) {
            throw '-TargetId is required for CloseTarget.'
        }
        $encodedTargetId = [System.Uri]::EscapeDataString($TargetId)
        $result = Invoke-RestMethod -Uri "$baseUri/json/close/$encodedTargetId" -Method Get -TimeoutSec $TimeoutSeconds
    }
    'Command' {
        if ([string]::IsNullOrWhiteSpace($Method)) {
            throw '-Method is required for Command.'
        }

        try {
            $params = $ParamsJson | ConvertFrom-Json -AsHashtable
        }
        catch {
            throw "ParamsJson is not valid JSON: $($_.Exception.Message)"
        }
        if ($params -isnot [System.Collections.IDictionary]) {
            throw 'ParamsJson must decode to a JSON object.'
        }

        if ($Browser) {
            $webSocketUrl = [string] $version.webSocketDebuggerUrl
        }
        else {
            $targets = @(Invoke-RestMethod -Uri "$baseUri/json/list" -Method Get -TimeoutSec $TimeoutSeconds)
            if (-not [string]::IsNullOrWhiteSpace($TargetId)) {
                $target = $targets | Where-Object { $_.id -eq $TargetId } | Select-Object -First 1
            }
            else {
                $target = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
            }
            if ($null -eq $target) {
                throw 'No matching page target was found. Use -Action Targets or -Browser.'
            }
            $webSocketUrl = [string] $target.webSocketDebuggerUrl
        }

        $commandArguments = @{
            WebSocketUrl = $webSocketUrl
            CdpMethod    = $Method
            CdpParams    = $params
            Timeout      = $TimeoutSeconds
        }
        $result = Invoke-CdpWebSocketCommand @commandArguments
    }
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 20 -Compress
}
else {
    $result
}
