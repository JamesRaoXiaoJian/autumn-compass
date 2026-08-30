#requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true,Position=0)][ValidateSet('Check','Push','Pull')][string]$Action,
  [Parameter(Position=1,ValueFromRemainingArguments=$true)][string[]]$Path,
  [string]$Remote=$env:FALL_RECRUITMENT_SYNC_REMOTE,
  [ValidateRange(1,65535)][int]$SshPort=$(if($env:FALL_RECRUITMENT_SYNC_SSH_PORT){ [int]$env:FALL_RECRUITMENT_SYNC_SSH_PORT }else{ 22 }),
  [string]$SshIdentity=(Join-Path $HOME '.ssh\id_ed25519'),
  [string]$KnownHosts=(Join-Path $HOME '.ssh\known_hosts'),
  [string]$AgeRecipient=(Join-Path $env:APPDATA 'fall-recruitment-sync\age-recipient.txt'),
  [string]$AgeIdentity=(Join-Path $env:APPDATA 'fall-recruitment-sync\age-identity.txt'),
  [string]$ExpectedHostFingerprint=$env:FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT,
  [string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$RemoteDir='.local/share/fall-recruitment-sync'

function Invoke-Checked([string]$Exe,[string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe failed with exit code $LASTEXITCODE" }
}
function Test-BackupName([string]$Name) {
  return $Name -eq 'autumn-compass-profile.json' -or $Name -match '^autumn-compass-workspace-\d{4}-\d{2}-\d{2}([_-][A-Za-z0-9_-]+)?\.json$'
}
if([string]::IsNullOrWhiteSpace($Remote)){ throw 'Remote is required. Pass -Remote user@host or set FALL_RECRUITMENT_SYNC_REMOTE.' }
if([string]::IsNullOrWhiteSpace($ExpectedHostFingerprint)){ throw 'ExpectedHostFingerprint is required. Pass it explicitly or set FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT.' }
if($Remote -notmatch '^[A-Za-z_][A-Za-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*$'){ throw 'Remote must be a plain user@host value.' }
$hostName=($Remote -split '@')[-1]
if($ExpectedHostFingerprint -notmatch '^SHA256:[A-Za-z0-9+/]{43}$'){ throw 'ExpectedHostFingerprint must be one complete SHA256 fingerprint.' }
foreach($tool in 'ssh','scp','ssh-keygen','age') { if(-not (Get-Command $tool -ErrorAction SilentlyContinue)){ throw "Required command not found: $tool" } }
if(-not (Test-Path -LiteralPath $SshIdentity -PathType Leaf)){ throw "SSH identity not found: $SshIdentity" }
if(-not (Test-Path -LiteralPath $KnownHosts -PathType Leaf)){ throw "known_hosts not found: $KnownHosts" }
$knownHostName=if($SshPort -eq 22){ $hostName } else { "[$hostName]:$SshPort" }
$known=& ssh-keygen -F $knownHostName -f $KnownHosts 2>$null
if($LASTEXITCODE -ne 0 -or -not $known){ throw "Host is not pinned in known_hosts: $knownHostName" }
$ed25519Known=@($known | Where-Object {
  -not $_.StartsWith('#') -and (([string]$_ -split '\s+').Count -ge 2) -and (([string]$_ -split '\s+')[1] -ceq 'ssh-ed25519')
})
if($ed25519Known.Count -eq 0){ throw 'known_hosts does not contain an ED25519 key for this endpoint.' }
$fingerprints=@($ed25519Known | & ssh-keygen -lf - -E sha256 2>$null | ForEach-Object {
  $fields=([string]$_ -split '\s+')
  if($fields.Count -ge 2){ $fields[1] }
} | Sort-Object -Unique)
if($fingerprints.Count -ne 1 -or $fingerprints[0] -cne $ExpectedHostFingerprint){
  throw 'known_hosts must contain exactly the pinned ED25519 fingerprint for this endpoint.'
}
$commonSshOptions=@('-i',$SshIdentity,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','PreferredAuthentications=publickey','-o','PubkeyAuthentication=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$KnownHosts",'-o','HostKeyAlgorithms=ssh-ed25519','-o','ConnectTimeout=12')
$sshOptions=@('-p',[string]$SshPort)+$commonSshOptions
$scpOptions=@('-P',[string]$SshPort)+$commonSshOptions
Invoke-Checked ssh ($sshOptions+@($Remote,'set -eu; command -v sha256sum >/dev/null; d="$HOME/.local/share/fall-recruitment-sync"; if [ -e "$d" ]; then test -d "$d" && test ! -L "$d" && test -r "$d"; fi'))
if($Action -eq 'Check'){ Write-Host 'SSH key-only preflight passed.'; exit 0 }

$temp=Join-Path ([IO.Path]::GetTempPath()) ("fall-recruitment-sync-"+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  if($Action -eq 'Push') {
    if(-not $Path -or $Path.Count -eq 0){ throw 'Push requires explicit Autumn Compass JSON export paths.' }
    if(-not (Test-Path -LiteralPath $AgeRecipient -PathType Leaf)){ throw "age recipient not found: $AgeRecipient" }
    $seen=@{}; [long]$total=0; $stage=Join-Path $temp 'payload'; New-Item -ItemType Directory $stage | Out-Null
    foreach($item in $Path){
      if(-not (Test-Path -LiteralPath $item -PathType Leaf)){ throw "Input is not a file: $item" }
      $source=Get-Item -LiteralPath $item
      if($source.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){ throw "Refusing linked input: $item" }
      $resolved=(Resolve-Path -LiteralPath $item).Path; $file=Get-Item -LiteralPath $resolved
      if(-not (Test-BackupName $file.Name)){ throw "Refusing non-backup input: $item" }
      if($seen.ContainsKey($file.Name)){ throw "Duplicate basename: $($file.Name)" }; $seen[$file.Name]=$true
      $total += $file.Length; if($total -gt 104857600){ throw 'Inputs exceed the 100 MiB safety limit.' }
      Copy-Item -LiteralPath $resolved -Destination (Join-Path $stage $file.Name)
    }
    [IO.File]::WriteAllText((Join-Path $stage 'SYNC_MANIFEST.txt'),'Autumn Compass private browser exports; no credentials or SSH keys.',[Text.UTF8Encoding]::new($false))
    $archive=Join-Path $temp 'payload.zip'; Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'); $nonce=[guid]::NewGuid().ToString('N').Substring(0,16)
    $final="backup-$stamp-$nonce.age"; $sumName="$final.sha256"; $encrypted=Join-Path $temp $final
    Invoke-Checked age @('--encrypt','--recipients-file',$AgeRecipient,'--output',$encrypted,$archive)
    $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $encrypted).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $temp $sumName),"$hash  $final`n",[Text.UTF8Encoding]::new($false))
    $upAge=".upload-$nonce.age"; $upSum=".upload-$nonce.sha256"
    Invoke-Checked ssh ($sshOptions+@($Remote,'set -eu; umask 077; d="$HOME/.local/share/fall-recruitment-sync"; mkdir -p "$d"; test -d "$d" && test ! -L "$d"; chmod 700 "$d"'))
    Invoke-Checked scp ($scpOptions+@($encrypted,"${Remote}:$RemoteDir/$upAge"))
    Invoke-Checked scp ($scpOptions+@((Join-Path $temp $sumName),"${Remote}:$RemoteDir/$upSum"))
    $publish="set -eu; umask 077; d=`"`$HOME/$RemoteDir`"; cd `"`$d`"; trap 'rm -f `"$upAge`" `"$upSum`"' EXIT; expected=`$(sed -n '1{s/ .*//;p;}' `"$upSum`"); actual=`$(sha256sum `"$upAge`"); actual=`${actual%% *}; test `"`$expected`" = `"`$actual`"; grep -qx '[0-9a-f]\{64\}  $final' `"$upSum`"; test ! -e `"$final`"; test ! -e `"$sumName`"; chmod 600 `"$upAge`" `"$upSum`"; ln `"$upSum`" `"$sumName`"; ln `"$upAge`" `"$final`"; rm -f `"$upAge`" `"$upSum`"; trap - EXIT"
    Invoke-Checked ssh ($sshOptions+@($Remote,$publish)); Write-Host "Published immutable encrypted snapshot: $final"
  } else {
    if(-not (Test-Path -LiteralPath $AgeIdentity -PathType Leaf)){ throw "age identity not found: $AgeIdentity" }
    $latest=(& ssh @sshOptions $Remote 'set -eu; d="$HOME/.local/share/fall-recruitment-sync"; test -d "$d"; find "$d" -maxdepth 1 -type f -name "backup-*.age" -printf "%f\n" | LC_ALL=C sort | tail -n 1').Trim()
    if($LASTEXITCODE -ne 0 -or $latest -notmatch '^backup-\d{8}T\d{6}Z-[0-9a-f]{16}\.age$'){ throw 'No valid remote snapshot found.' }
    Invoke-Checked scp ($scpOptions+@("${Remote}:$RemoteDir/$latest",(Join-Path $temp $latest)))
    Invoke-Checked scp ($scpOptions+@("${Remote}:$RemoteDir/$latest.sha256",(Join-Path $temp "$latest.sha256")))
    if((Get-Item -LiteralPath (Join-Path $temp $latest)).Length -gt 115343360){ throw 'Encrypted snapshot exceeds the 110 MiB safety limit.' }
    $line=[IO.File]::ReadAllText((Join-Path $temp "$latest.sha256")).Trim()
    if($line -notmatch '^([0-9a-f]{64})  (.+)$' -or $Matches[2] -ne $latest){ throw 'Invalid checksum manifest.' }
    if((Get-FileHash -Algorithm SHA256 (Join-Path $temp $latest)).Hash.ToLowerInvariant() -ne $Matches[1]){ throw 'Encrypted snapshot checksum mismatch.' }
    $archive=Join-Path $temp 'payload.zip'; Invoke-Checked age @('--decrypt','--identity',$AgeIdentity,'--output',$archive,(Join-Path $temp $latest))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
      $seen=@{}; [long]$expandedTotal=0; $exportCount=0; $manifestCount=0
      if($zip.Entries.Count -gt 16){ throw 'Payload contains too many archive members.' }
      foreach($entry in $zip.Entries){
        if($entry.FullName -ne $entry.Name -or [string]::IsNullOrWhiteSpace($entry.Name)){ throw "Unsafe archive member: $($entry.FullName)" }
        if($seen.ContainsKey($entry.Name)){ throw "Duplicate archive member: $($entry.Name)" }; $seen[$entry.Name]=$true
        $unixType=($entry.ExternalAttributes -shr 16) -band 0xF000
        if($unixType -notin @(0,0x8000) -or $entry.Name.EndsWith('/')){ throw "Non-regular archive member rejected: $($entry.Name)" }
        if($entry.Name -eq 'SYNC_MANIFEST.txt'){ $manifestCount++ }
        elseif(Test-BackupName $entry.Name){ $exportCount++ }
        else{ throw "Unsafe archive member: $($entry.FullName)" }
        $expandedTotal += $entry.Length
        if($expandedTotal -gt 104857600){ throw 'Expanded payload exceeds the 100 MiB safety limit.' }
      }
      if($manifestCount -ne 1 -or $exportCount -lt 1){ throw 'Payload must contain one manifest and at least one Autumn Compass export.' }
    } finally { $zip.Dispose() }
    if(-not $OutputDirectory){ $OutputDirectory=Join-Path $env:LOCALAPPDATA ("fall-recruitment-sync\restored-"+(Get-Date -Format 'yyyyMMdd-HHmmss')) }
    $OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
    if(Test-Path -LiteralPath $OutputDirectory){ throw "Restore destination already exists: $OutputDirectory" }
    $parent=Split-Path -Parent $OutputDirectory; New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if((Get-Item -LiteralPath $parent).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){ throw "Restore parent must not be a link: $parent" }
    $restoreStage=Join-Path $parent ('.fall-recruitment-restore-'+[guid]::NewGuid().ToString('N'))
    try {
      Expand-Archive -LiteralPath $archive -DestinationPath $restoreStage
      $unsafeRestored=Get-ChildItem -LiteralPath $restoreStage -Force -Recurse | Where-Object {
        $_.PSIsContainer -or $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)
      } | Select-Object -First 1
      if($null -ne $unsafeRestored){ throw "Restored payload contains a non-regular file: $($unsafeRestored.FullName)" }
      Move-Item -LiteralPath $restoreStage -Destination $OutputDirectory
    }
    finally { if(Test-Path -LiteralPath $restoreStage){ Remove-Item -LiteralPath $restoreStage -Recurse -Force } }
    Write-Host "Restored verified snapshot to: $OutputDirectory"
  }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
