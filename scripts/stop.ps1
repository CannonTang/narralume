$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".runtime\server.pid"
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "No launcher-managed NarraLume process is recorded."
  return
}
$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
if ($process -and $process.CommandLine -like "*apps*server*dist*main.js*") {
  Stop-Process -Id $serverPid
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    $running = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
  } while ($running -and [DateTime]::UtcNow -lt $deadline)
  if ($running) {
    Write-Warning "Graceful stop timed out; forcing NarraLume to stop."
    Stop-Process -Id $serverPid -Force
  }
  Write-Host "NarraLume has stopped."
} else {
  Write-Warning "PID $serverPid does not belong to NarraLume and was not stopped."
}
Remove-Item -LiteralPath $pidFile -Force
