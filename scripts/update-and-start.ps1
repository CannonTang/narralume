$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $root ".git")) {
  Push-Location $root
  try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Updating a source checkout requires Git." }
    if (git status --porcelain) { throw "The checkout has local changes; update stopped." }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "Git update failed." }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Updating a source checkout requires npm." }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build after update failed; refusing to start stale artifacts." }
  } finally { Pop-Location }
} else {
  Write-Host "This is a prebuilt release. Download the latest Release and preserve the data directory."
}
& (Join-Path $PSScriptRoot "start.ps1")
