#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int] $Port = 9222,

    [string] $ChromePath,
    [string] $ProfileDirectory,
    [string] $RuntimeDirectory,
    [string] $AppUrl,
    [string] $ExtensionPath,
    [switch] $LoadBuiltExtension,

    [ValidateRange(3, 120)]
    [int] $StartupTimeoutSeconds = 20
)

. (Join-Path $PSScriptRoot 'ChromeAutomation.Common.ps1')

$runtime = Get-AutumnChromeRuntimeDirectory -RuntimeDirectory $RuntimeDirectory
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($ProfileDirectory)) {
    $ProfileDirectory = Join-Path $runtime 'Profile'
}
$profile = Assert-DedicatedChromeProfile -ProfileDirectory $ProfileDirectory
if ($profile.Equals($runtime, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'ProfileDirectory must not be the Chrome automation runtime directory itself.'
}

if ($LoadBuiltExtension -and -not [string]::IsNullOrWhiteSpace($ExtensionPath)) {
    throw 'Use either -LoadBuiltExtension or -ExtensionPath, not both.'
}

if (Test-LoopbackPortOpen -Port $Port) {
    throw "TCP port $Port is already in use on 127.0.0.1. Refusing to attach to or replace an unknown process."
}

$existingProcesses = Get-ChromeProcessesForSession -ProfileDirectory $profile -Port $Port
if ($existingProcesses.Count -gt 0) {
    throw "A Chrome process already uses the requested dedicated profile and port. Stop that managed session first."
}

$chrome = Get-ChromeExecutable -ChromePath $ChromePath
New-Item -ItemType Directory -Path $profile -Force | Out-Null

$extensionSource = $null
if ($LoadBuiltExtension) {
    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    $extensionSource = Join-Path $projectRoot 'apps\extension\dist'
}
elseif (-not [string]::IsNullOrWhiteSpace($ExtensionPath)) {
    $extensionSource = [System.IO.Path]::GetFullPath($ExtensionPath)
}

$stagedExtension = $null
if ($null -ne $extensionSource) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionSource 'manifest.json') -PathType Leaf)) {
        throw "The extension is not built or has no manifest.json: $extensionSource"
    }

    # Chrome can reject a WSL UNC extension path. Copy only the built extension into the
    # dedicated Windows runtime directory; the source tree remains unchanged.
    $stagedExtension = Join-Path $runtime 'ExtensionStaging'
    if (-not (Test-PathInside -Candidate $stagedExtension -Parent $runtime)) {
        throw "Unsafe extension staging path: $stagedExtension"
    }
    if (
        (Test-PathInside -Candidate $extensionSource -Parent $stagedExtension) -or
        (Test-PathInside -Candidate $stagedExtension -Parent $extensionSource)
    ) {
        throw 'ExtensionPath must not overlap the managed extension staging directory.'
    }
    if (Test-Path -LiteralPath $stagedExtension) {
        Remove-Item -LiteralPath $stagedExtension -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stagedExtension -Force | Out-Null
    Get-ChildItem -LiteralPath $extensionSource -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $stagedExtension -Recurse -Force
    }
}

$localAppUrl = $null
if (-not [string]::IsNullOrWhiteSpace($AppUrl)) {
    $localAppUrl = ConvertTo-LocalAppUri -Value $AppUrl
}

$arguments = [System.Collections.Generic.List[string]]::new()
$arguments.Add("--remote-debugging-port=$Port")
$arguments.Add('--remote-debugging-address=127.0.0.1')
$arguments.Add("--user-data-dir=$profile")
$arguments.Add('--no-first-run')
$arguments.Add('--no-default-browser-check')
$arguments.Add('--new-window')

if ($null -ne $stagedExtension) {
    $arguments.Add("--disable-extensions-except=$stagedExtension")
    $arguments.Add("--load-extension=$stagedExtension")
}
if ($null -ne $localAppUrl) {
    $arguments.Add($localAppUrl)
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $chrome
$startInfo.UseShellExecute = $false
foreach ($argument in $arguments) {
    $startInfo.ArgumentList.Add($argument)
}

$process = [System.Diagnostics.Process]::Start($startInfo)
if ($null -eq $process) {
    throw 'Chrome did not start.'
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($StartupTimeoutSeconds)
$version = $null
while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $version = Get-ChromeDebugVersion -Port $Port -TimeoutSeconds 1
    if ($null -ne $version) {
        break
    }
    if ($process.HasExited) {
        break
    }
    Start-Sleep -Milliseconds 250
}

if ($null -eq $version) {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
    throw "Chrome started but its loopback DevTools endpoint did not become ready within $StartupTimeoutSeconds seconds."
}

$startedProcesses = Get-ChromeProcessesForSession -ProfileDirectory $profile -Port $Port
if ($startedProcesses.Count -eq 0) {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
    throw 'A DevTools endpoint responded, but no Chrome process matches the dedicated profile and port. Refusing to manage it.'
}

$session = [ordered]@{
    schemaVersion      = 1
    startedAt          = [DateTimeOffset]::Now.ToString('o')
    address            = '127.0.0.1'
    port               = $Port
    processId          = $process.Id
    chromePath         = $chrome
    profileDirectory   = $profile
    extensionDirectory = $stagedExtension
    appUrl              = $localAppUrl
}
Write-AutumnChromeSession -RuntimeDirectory $runtime -Session $session

[pscustomobject]@{
    Running              = $true
    Managed              = $true
    Address              = '127.0.0.1'
    Port                 = $Port
    ProcessId            = $process.Id
    ProfileDirectory     = $profile
    ExtensionDirectory   = $stagedExtension
    Browser              = $version.Browser
    WebSocketDebuggerUrl = $version.webSocketDebuggerUrl
}
