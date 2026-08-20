param([string]$Label = "docker")

$ErrorActionPreference = "Stop"

try {
  $backup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4318/api/system/backups" -ContentType "application/json" -Body (@{ label = $Label } | ConvertTo-Json) -TimeoutSec 60
  Write-Host "Backup completed: $($backup.databaseFile)"
  $backup
} catch {
  throw "Could not create a consistent Docker backup. Start NarraLume first. $($_.Exception.Message)"
}
