param([string]$Label = "launcher")

$ErrorActionPreference = "Stop"
$port = if ($env:NARRALUME_PORT) { [int]$env:NARRALUME_PORT } else { 4317 }
try {
  $backup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/system/backups" -ContentType "application/json" -Body (@{ label = $Label } | ConvertTo-Json) -TimeoutSec 60
  Write-Host "Backup completed: $($backup.databaseFile)"
  $backup
} catch {
  throw "Could not create a consistent backup. Start NarraLume first. $($_.Exception.Message)"
}
