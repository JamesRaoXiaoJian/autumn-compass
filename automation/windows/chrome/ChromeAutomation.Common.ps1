#requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AutumnChromeRuntimeDirectory {
    param([string] $RuntimeDirectory)

    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is unavailable. Run this script with Windows PowerShell 7, not Linux pwsh.'
    }

    $managedRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $env:LOCALAPPDATA 'AutumnCompass\ChromeAutomation')
    )
    if ([string]::IsNullOrWhiteSpace($RuntimeDirectory)) {
        return $managedRoot
    }

    $candidate = [System.IO.Path]::GetFullPath($RuntimeDirectory)
    if (-not (Test-PathInside -Candidate $candidate -Parent $managedRoot)) {
        throw "RuntimeDirectory must stay inside the managed Chrome automation root: $managedRoot"
    }
    return $candidate
}

function Get-AutumnChromeSessionPath {
    param([Parameter(Mandatory)] [string] $RuntimeDirectory)

    return Join-Path $RuntimeDirectory 'session.json'
}

function Read-AutumnChromeSession {
    param([Parameter(Mandatory)] [string] $RuntimeDirectory)

    $sessionPath = Get-AutumnChromeSessionPath -RuntimeDirectory $RuntimeDirectory
    if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $sessionPath -Raw -Encoding utf8 | ConvertFrom-Json
    }
    catch {
        throw "Chrome automation session file is invalid: $sessionPath. $($_.Exception.Message)"
    }
}

function Write-AutumnChromeSession {
    param(
        [Parameter(Mandatory)] [string] $RuntimeDirectory,
        [Parameter(Mandatory)] [object] $Session
    )

    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
    $sessionPath = Get-AutumnChromeSessionPath -RuntimeDirectory $RuntimeDirectory
    $Session | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $sessionPath -Encoding utf8NoBOM
}

function Get-ChromeExecutable {
    param([string] $ChromePath)

    if (-not [string]::IsNullOrWhiteSpace($ChromePath)) {
        $resolved = Resolve-Path -LiteralPath $ChromePath -ErrorAction Stop
        if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
            throw "Chrome executable is not a file: $ChromePath"
        }
        return $resolved.Path
    }

    $installRoots = @(
        $env:LOCALAPPDATA
        [Environment]::GetFolderPath('ProgramFiles')
        [Environment]::GetFolderPath('ProgramFilesX86')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $candidates = @($installRoots | ForEach-Object {
        Join-Path $_ 'Google\Chrome\Application\chrome.exe'
    })

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    throw 'Google Chrome was not found. Install Chrome or pass -ChromePath explicitly.'
}

function Test-PathInside {
    param(
        [Parameter(Mandatory)] [string] $Candidate,
        [Parameter(Mandatory)] [string] $Parent
    )

    $trimCharacters = [char[]] @('\', '/')
    $candidatePath = [System.IO.Path]::GetFullPath($Candidate).TrimEnd($trimCharacters)
    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd($trimCharacters)
    if ($candidatePath.Equals($parentPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    $prefix = $parentPath + [System.IO.Path]::DirectorySeparatorChar
    return $candidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-DedicatedChromeProfile {
    param([Parameter(Mandatory)] [string] $ProfileDirectory)

    $profilePath = [System.IO.Path]::GetFullPath($ProfileDirectory)
    $defaultRoot = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
    if (Test-PathInside -Candidate $profilePath -Parent $defaultRoot) {
        throw "Refusing to use Chrome's normal profile tree: $profilePath. Choose a dedicated directory outside $defaultRoot."
    }

    return $profilePath
}

function Test-LoopbackPortOpen {
    param(
        [Parameter(Mandatory)] [ValidateRange(1, 65535)] [int] $Port,
        [int] $TimeoutMilliseconds = 400
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync([System.Net.IPAddress]::Loopback, $Port)
        if (-not $task.Wait($TimeoutMilliseconds)) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Get-ChromeDebugVersion {
    param(
        [Parameter(Mandatory)] [ValidateRange(1, 65535)] [int] $Port,
        [int] $TimeoutSeconds = 2
    )

    try {
        $request = @{
            Uri         = "http://127.0.0.1:$Port/json/version"
            Method      = 'Get'
            TimeoutSec  = $TimeoutSeconds
            ErrorAction = 'Stop'
        }
        return Invoke-RestMethod @request
    }
    catch {
        return $null
    }
}

function Get-ChromeProcessesForSession {
    param(
        [Parameter(Mandatory)] [string] $ProfileDirectory,
        [Parameter(Mandatory)] [ValidateRange(1, 65535)] [int] $Port
    )

    $profileToken = "--user-data-dir=$ProfileDirectory"
    $portToken = "--remote-debugging-port=$Port"
    $profilePattern = '(?:^|[\s"])' + [regex]::Escape($profileToken) + '(?=$|[\s"])'
    $portPattern = '(?:^|[\s"])' + [regex]::Escape($portToken) + '(?=$|[\s"])'

    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
                [regex]::IsMatch($_.CommandLine, $profilePattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) -and
                [regex]::IsMatch($_.CommandLine, $portPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            }
    )
}

function Get-ManagedChromePort {
    param(
        [Parameter(Mandatory)] [string] $RuntimeDirectory,
        [int] $RequestedPort = 0
    )

    $session = Read-AutumnChromeSession -RuntimeDirectory $RuntimeDirectory
    if ($null -eq $session) {
        throw 'No managed Chrome session was found. Start it first.'
    }

    $sessionPort = [int] $session.Port
    if ($RequestedPort -gt 0 -and $RequestedPort -ne $sessionPort) {
        throw "Requested port $RequestedPort does not match managed session port $sessionPort."
    }

    return $sessionPort
}

function ConvertTo-LocalAppUri {
    param([Parameter(Mandatory)] [string] $Value)

    $uri = $null
    if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref] $uri)) {
        throw "AppUrl must be an absolute HTTP(S) URL: $Value"
    }

    if ($uri.Scheme -notin @('http', 'https')) {
        throw "AppUrl must use HTTP or HTTPS: $Value"
    }

    if ($uri.Host -notin @('localhost', '127.0.0.1', '::1')) {
        throw "AppUrl must target localhost. Received host '$($uri.Host)'."
    }

    return $uri.AbsoluteUri
}
