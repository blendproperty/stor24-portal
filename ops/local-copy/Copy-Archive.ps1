param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-ArchiveMetadata($Metadata) {
    if ($Metadata.name -notmatch '\Astor24-\d{8}T\d{6}Z\.dump\.gpg\z' -or $Metadata.sha256 -notmatch '\A[a-f0-9]{64}\z') { throw 'Invalid archive metadata.' }
    if ($Metadata.ageHours -isnot [ValueType] -or [double]::IsNaN($Metadata.ageHours) -or $Metadata.ageHours -gt 30 -or $Metadata.ageHours -lt -0.1) { throw 'Source backup is stale or its timestamp is invalid.' }
}
if ($SelfTest) {
    $valid = @{name='stor24-20261019T010000Z.dump.gpg'; sha256=('a' * 64); ageHours=2.0}
    Assert-ArchiveMetadata $valid
    foreach ($change in @(@{name="$($valid.name)`n"}, @{sha256='invalid'}, @{ageHours=31.0}, @{ageHours=-1.0}, @{ageHours=[double]::NaN})) {
        $bad=$valid.Clone()
        foreach ($key in $change.Keys) { $bad[$key]=$change[$key] }
        $rejected=$false
        try { Assert-ArchiveMetadata $bad } catch { $rejected=$true }
        if (-not $rejected) { throw 'Unsafe source metadata was accepted.' }
    }
    Write-Output 'Passed: valid metadata; newline filename, invalid checksum, stale/future/NaN timestamps rejected.'
    return
}
Set-Location $PSScriptRoot
$config = Get-Content ./config.json -Raw | ConvertFrom-Json
$partial = Join-Path $PSScriptRoot 'incoming.gpg.partial'
$started = [DateTime]::UtcNow.ToString('o')
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $PSScriptRoot 'archive.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $sshOptions = @('-i', $config.sshKey, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20')
    $sourceScript = @'
import hashlib,json,pathlib,datetime
p=max(pathlib.Path('/opt/backups/stor24-dlp').glob('stor24-*.dump.gpg'),key=lambda p:p.name)
print(json.dumps(dict(name=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),ageHours=(datetime.datetime.now().timestamp()-p.stat().st_mtime)/3600)))
'@
    $metadata = $sourceScript | & ssh @sshOptions $config.source 'python3 -'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read production archive metadata.' }
    $metadata = $metadata | ConvertFrom-Json
    Assert-ArchiveMetadata $metadata
    if (-not (Test-Path -LiteralPath $config.archives -PathType Container)) { throw 'Configured OneDrive backup folder is missing.' }
    $archive = Join-Path $config.archives $metadata.name
    if (-not (Test-Path -LiteralPath $archive)) {
        & scp @sshOptions "$($config.source):/opt/backups/stor24-dlp/$($metadata.name)" $partial
        if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive transfer failed.' }
        if ((Get-FileHash $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) { throw 'Transferred archive checksum does not match production.' }
        Move-Item -LiteralPath $partial -Destination $archive
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) { throw 'Existing local archive checksum does not match production.' }
    "$($metadata.sha256)  $($metadata.name)" | Set-Content "$archive.sha256" -Encoding ascii
    $status = [ordered]@{status='copied-and-checksummed'; copiedAt=[DateTime]::UtcNow.ToString('o'); archive=$archive; sha256=$metadata.sha256; cloudUploadVerified=$false; productionModified=$false}
    $status | ConvertTo-Json | Set-Content ./archive-success.json.tmp -Encoding utf8
    Move-Item ./archive-success.json.tmp ./archive-success.json -Force
    $status | ConvertTo-Json | Set-Content ./archive-attempt.json -Encoding utf8
    [pscustomobject]$status
} catch {
    [ordered]@{status='failed'; startedAt=$started; failedAt=[DateTime]::UtcNow.ToString('o'); reason=$_.Exception.Message} | ConvertTo-Json | Set-Content ./archive-attempt.json -Encoding utf8
    throw
} finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    if ($lock) { $lock.Dispose() }
}
