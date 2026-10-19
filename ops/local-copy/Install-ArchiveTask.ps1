param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$SshKey,
    [Parameter(Mandatory)][string]$OneDriveRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { throw 'Existing SSH key is missing.' }
if (-not (Test-Path -LiteralPath $OneDriveRoot -PathType Container)) { throw 'Existing OneDrive folder is missing.' }
$runtime = Join-Path $env:LOCALAPPDATA 'STOR24Backup'
$archives = Join-Path $OneDriveRoot 'STOR24 Backups/Database'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
& icacls $runtime /inheritance:r /grant:r "*$($identity.User.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect local runtime directory.' }
New-Item -ItemType Directory -Path $archives -Force | Out-Null
foreach ($name in @('Copy-Archive.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $runtime -Force
}
[ordered]@{source=$Source; sshKey=(Resolve-Path $SshKey).Path; archives=$archives} | ConvertTo-Json | Set-Content "$runtime/config.json" -Encoding utf8
$powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$scriptBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'Copy-Archive.ps1')))
$configBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$runtime/config.json"))
# Materialize the pinned script in the scheduled user's profile, independent of the installer session.
$command = @'
$ErrorActionPreference='Stop'
$r=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STOR24Backup'
New-Item -ItemType Directory -Path $r -Force | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $r /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Cannot protect task runtime'}
[IO.File]::WriteAllBytes((Join-Path $r 'Copy-Archive.ps1'),[Convert]::FromBase64String('SCRIPT_BYTES'))
[IO.File]::WriteAllBytes((Join-Path $r 'config.json'),[Convert]::FromBase64String('CONFIG_BYTES'))
$cfg=Get-Content (Join-Path $r 'config.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $cfg.archives -Force | Out-Null
& (Join-Path $r 'Copy-Archive.ps1') *> (Join-Path $r 'task.log')
if (-not $?) { exit 1 }
'@
$command=$command.Replace('SCRIPT_BYTES',$scriptBytes).Replace('CONFIG_BYTES',$configBytes)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -EncodedCommand ' + $encoded)
$trigger = New-ScheduledTaskTrigger -Daily -At '03:20'
$trigger.StartBoundary = [DateTimeOffset]::Now.ToOffset([TimeSpan]::FromHours(2)).Date.AddDays(1).AddHours(3).AddMinutes(20).ToString('yyyy-MM-ddTHH:mm:ss') + '+02:00'
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'STOR24 encrypted backup to OneDrive' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '03:20 SAST daily: copy latest encrypted Hostinger archive; verify SHA256; retain history. Requires signed-in Windows session, AC power, internet and OneDrive sync. No production writes.' -Force | Out-Null
Write-Output "Archive task installed. Runtime: $runtime"
