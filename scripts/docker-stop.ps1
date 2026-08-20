$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is not installed."
}

Push-Location $root
try {
  docker compose down
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to stop." }
} finally {
  Pop-Location
}

Write-Host "NarraLume containers have stopped. The data volume was preserved."
