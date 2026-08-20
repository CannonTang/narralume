$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Install and start Docker Desktop first."
}
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The Docker service is not running." }

Push-Location $root
try {
  if (Test-Path -LiteralPath (Join-Path $root ".git")) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      throw "Updating a source checkout requires Git."
    }
    if (git status --porcelain) {
      throw "The checkout has local changes; update stopped."
    }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "Git update failed." }
  }

  docker compose build --pull
  if ($LASTEXITCODE -ne 0) { throw "Docker image rebuild failed." }
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to start the update." }
} finally {
  Pop-Location
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    if ((Invoke-RestMethod "http://127.0.0.1:4318/api/health" -TimeoutSec 2).status -eq "ok") {
      Write-Host "NarraLume Docker deployment is updated."
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 2
}
throw "Docker health check timed out after the update."
