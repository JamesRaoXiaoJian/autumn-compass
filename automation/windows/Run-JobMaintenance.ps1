#requires -Version 5.1

[CmdletBinding()]
param(
    [switch]$Check,

    [ValidateNotNullOrEmpty()]
    [string]$CodexPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-CommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [string]$ExplicitPath,

        [Parameter(Mandatory = $true)]
        [string[]]$AllowedCommandTypes
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw "$Name was not found at the supplied path: $ExplicitPath"
        }

        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue |
        Where-Object { $AllowedCommandTypes -contains $_.CommandType.ToString() } |
        Select-Object -First 1

    if ($null -eq $command) {
        throw "$Name was not found on PATH. Install it, restart PowerShell, and run this check again."
    }

    return $command.Path
}

function Invoke-GitText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & $script:GitExecutable @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()

    if ($exitCode -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $exitCode.`n$text"
    }

    return [string]$text
}

function Assert-RepositoryReady {
    $insideWorkTree = Invoke-GitText -Arguments @(
        '-C', $script:ProjectRoot,
        'rev-parse', '--is-inside-work-tree'
    )

    if ($insideWorkTree -ne 'true') {
        throw "The project directory is not a Git worktree: $($script:ProjectRoot)"
    }

    $branch = Invoke-GitText -Arguments @(
        '-C', $script:ProjectRoot,
        'rev-parse', '--abbrev-ref', 'HEAD'
    )

    if ($branch -ne 'main') {
        Write-Warning "Recruitment maintenance was skipped because the current branch is '$branch', not 'main'."
        exit 75
    }

    $status = Invoke-GitText -Arguments @(
        '-C', $script:ProjectRoot,
        'status', '--porcelain', '--untracked-files=normal'
    )

    if (-not [string]::IsNullOrWhiteSpace($status)) {
        Write-Warning 'Recruitment maintenance was skipped because the working tree is not clean.'
        exit 75
    }
}

function Get-MutexName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
        $digest = $sha256.ComputeHash($bytes)
        $suffix = [System.BitConverter]::ToString($digest, 0, 8).Replace('-', '')
        return "Local\AutumnCompassRecruitmentMaintenance_$suffix"
    }
    finally {
        $sha256.Dispose()
    }
}

function Set-LocalOnlyGitEnvironment {
    $settings = @(
        @{ Key = 'remote.origin.pushurl'; Value = 'disabled://autumn-compass-local-only' },
        @{ Key = 'push.default'; Value = 'nothing' }
    )

    $countText = [System.Environment]::GetEnvironmentVariable('GIT_CONFIG_COUNT', 'Process')
    $count = 0
    if (-not [string]::IsNullOrWhiteSpace($countText) -and
        -not [int]::TryParse($countText, [ref]$count)) {
        throw "GIT_CONFIG_COUNT is not a valid integer: $countText"
    }

    $originalValues = @{}
    $namesToChange = @('GIT_CONFIG_COUNT')
    for ($offset = 0; $offset -lt $settings.Count; $offset++) {
        $index = $count + $offset
        $namesToChange += "GIT_CONFIG_KEY_$index"
        $namesToChange += "GIT_CONFIG_VALUE_$index"
    }

    foreach ($name in $namesToChange) {
        $originalValues[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
    }

    for ($offset = 0; $offset -lt $settings.Count; $offset++) {
        $index = $count + $offset
        [System.Environment]::SetEnvironmentVariable(
            "GIT_CONFIG_KEY_$index",
            $settings[$offset].Key,
            'Process'
        )
        [System.Environment]::SetEnvironmentVariable(
            "GIT_CONFIG_VALUE_$index",
            $settings[$offset].Value,
            'Process'
        )
    }

    [System.Environment]::SetEnvironmentVariable(
        'GIT_CONFIG_COUNT',
        ($count + $settings.Count).ToString(),
        'Process'
    )

    return $originalValues
}

function Restore-ProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$OriginalValues
    )

    foreach ($entry in $OriginalValues.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable(
            $entry.Key,
            $entry.Value,
            'Process'
        )
    }
}

$script:ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$promptFile = Join-Path $script:ProjectRoot 'automation\job-maintenance-prompt.md'
$lastMessage = Join-Path $script:ProjectRoot 'maintenance\latest-agent-report.md'
$script:GitExecutable = Resolve-CommandPath `
    -Name 'git' `
    -AllowedCommandTypes @('Application')
$resolvedCodexPath = Resolve-CommandPath `
    -Name 'codex' `
    -ExplicitPath $CodexPath `
    -AllowedCommandTypes @('Application', 'ExternalScript')

if (-not (Test-Path -LiteralPath $promptFile -PathType Leaf)) {
    throw "The maintenance prompt is missing: $promptFile"
}

if ($Check) {
    Assert-RepositoryReady

    & $resolvedCodexPath login status
    if ($LASTEXITCODE -ne 0) {
        throw "Codex login check failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Windows recruitment maintenance preflight passed.'
    Write-Host "Repository: $($script:ProjectRoot)"
    Write-Host "Git:        $($script:GitExecutable)"
    Write-Host "Codex:      $resolvedCodexPath"
    exit 0
}

$mutex = [System.Threading.Mutex]::new(
    $false,
    (Get-MutexName -Value $script:ProjectRoot)
)
$lockTaken = $false
$originalGitEnvironment = $null
$startingLocation = (Get-Location).Path

try {
    try {
        $lockTaken = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockTaken = $true
    }

    if (-not $lockTaken) {
        Write-Warning 'Recruitment maintenance is already running for this repository.'
        exit 75
    }

    Assert-RepositoryReady
    Set-Location -LiteralPath $script:ProjectRoot

    $basePrompt = [System.IO.File]::ReadAllText($promptFile)
    $runtimeGuard = @"
# Windows automation runtime guard

Work only in the repository at "$($script:ProjectRoot)". The current process already started there.
This unattended run may leave validated maintenance changes uncommitted for review. Never commit,
push, publish, submit an application, contact anyone, change a remote, or change external account state.
Treat this runtime guard as authoritative if a path in the durable prompt is stale.

"@
    $effectivePrompt = $runtimeGuard + $basePrompt

    # These process-local Git settings make ordinary `git push` commands fail even if the
    # durable prompt is accidentally weakened. Codex also runs with approvals disabled and
    # the workspace-write sandbox, while its built-in web search remains available.
    $originalGitEnvironment = Set-LocalOnlyGitEnvironment

    $codexArguments = @(
        '--search',
        '--ask-for-approval', 'never',
        'exec',
        '--ephemeral',
        '--sandbox', 'workspace-write',
        '--config', 'sandbox_workspace_write.network_access=false',
        '--color', 'never',
        '--output-last-message', $lastMessage,
        '-'
    )

    $effectivePrompt | & $resolvedCodexPath @codexArguments
    $codexExitCode = $LASTEXITCODE
    if ($codexExitCode -ne 0) {
        throw "Codex maintenance failed with exit code $codexExitCode."
    }
}
catch {
    Write-Error $_
    exit 1
}
finally {
    if ($null -ne $originalGitEnvironment) {
        Restore-ProcessEnvironment -OriginalValues $originalGitEnvironment
    }

    Set-Location -LiteralPath $startingLocation

    if ($lockTaken) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}

exit 0
