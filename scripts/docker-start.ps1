$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Install and start Docker Desktop first." }
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The Docker service is not running." }
$envFile = Join-Path $root ".env.local"
if (-not (Test-Path -LiteralPath $envFile) -or -not (Select-String -LiteralPath $envFile -Pattern '^NARRATIVE_AUTH_TOKEN=' -Quiet)) {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  Add-Content -LiteralPath $envFile -Value "NARRATIVE_AUTH_TOKEN=$token"
}
Push-Location $root
try { docker compose up -d --build } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to start." }
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try { if ((Invoke-RestMethod "http://127.0.0.1:4318/api/health" -TimeoutSec 2).status -eq "ok") { Start-Process "http://127.0.0.1:4318"; exit 0 } } catch { }
  Start-Sleep -Seconds 2
}
throw "Docker health check timed out."
