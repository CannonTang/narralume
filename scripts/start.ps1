param(
  [switch]$NoBrowser,
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root ".runtime"
$logs = Join-Path $runtime "logs"
$pidFile = Join-Path $runtime "server.pid"
$lockFile = Join-Path $root "package-lock.json"
$installMarker = Join-Path $runtime "package-lock.sha256"
$minimumNodeVersion = [version]"24.0.0"
$minimumNpmMajor = 11
$portableVersion = if ($env:NARRALUME_NODE_VERSION) { $env:NARRALUME_NODE_VERSION } else { "24.15.0" }
$port = if ($env:NARRALUME_PORT) { [int]$env:NARRALUME_PORT } else { 4317 }
$url = "http://127.0.0.1:$port"
$dataDirectory = if ($env:NARRALUME_DATA_DIR) { $env:NARRALUME_DATA_DIR } else { Join-Path $root "data" }

New-Item -ItemType Directory -Force -Path $runtime, $logs | Out-Null

function Test-Node([string]$candidate) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { return $false }
  try {
    $version = [version](& $candidate -p "process.versions.node")
    return $version -ge $minimumNodeVersion
  } catch { return $false }
}

function Test-Npm([string]$candidate) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { return $false }
  try { return ([version](& $candidate --version)).Major -ge $minimumNpmMajor } catch { return $false }
}

function Install-PortableNode {
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw "The NarraLume portable runtime requires 64-bit Windows."
  }
  $folderName = "node-v$portableVersion-win-x64"
  $nodeHome = Join-Path $runtime $folderName
  $nodeExe = Join-Path $nodeHome "node.exe"
  if (Test-Node $nodeExe) { return $nodeExe }

  $archiveName = "$folderName.zip"
  $archive = Join-Path $runtime $archiveName
  $baseUrl = "https://nodejs.org/dist/v$portableVersion"
  Write-Host "Downloading the official Node.js $portableVersion portable runtime..."
  Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archive
  $checksums = (Invoke-WebRequest "$baseUrl/SHASUMS256.txt").Content
  $expectedLine = ($checksums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($archiveName))$" } | Select-Object -First 1)
  if (-not $expectedLine) { throw "The official Node.js checksum list does not contain $archiveName." }
  $expected = ($expectedLine -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "The Node.js portable runtime checksum is invalid." }
  Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
  Remove-Item -LiteralPath $archive -Force
  if (-not (Test-Node $nodeExe)) { throw "The Node.js portable runtime installation failed." }
  return $nodeExe
}

$systemNode = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($env:NARRALUME_FORCE_PORTABLE_NODE -ne "1" -and $systemNode -and (Test-Node $systemNode.Source)) {
  $systemNode.Source
} else {
  Install-PortableNode
}
$npmCommand = Join-Path (Split-Path -Parent $nodeExe) "npm.cmd"
if (-not (Test-Path -LiteralPath $npmCommand)) {
  $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $systemNpm) { throw "npm was not found next to Node.js or on PATH." }
  $npmCommand = $systemNpm.Source
}
if (-not (Test-Npm $npmCommand)) {
  throw "NarraLume requires npm $minimumNpmMajor or newer."
}

$lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
$installedHash = if (Test-Path -LiteralPath $installMarker) { (Get-Content -LiteralPath $installMarker -Raw).Trim() } else { "" }
$nodeModules = Join-Path $root "node_modules"
if ((Test-Path -LiteralPath $nodeModules) -and -not $installedHash) {
  & $npmCommand ls --all --silent --prefix $root | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Set-Content -LiteralPath $installMarker -Value $lockHash -Encoding ASCII
    $installedHash = $lockHash
  }
}
if (-not (Test-Path -LiteralPath $nodeModules) -or $installedHash -ne $lockHash) {
  Write-Host "Installing dependencies from package-lock.json..."
  & $npmCommand ci --prefix $root
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  Set-Content -LiteralPath $installMarker -Value $lockHash -Encoding ASCII
}

$serverEntry = Join-Path $root "apps\server\dist\main.js"
$webIndex = Join-Path $root "apps\web\dist\index.html"
$localBuildMarker = Join-Path (Split-Path -Parent $webIndex) ".narralume-local-build"
$sourceCheckout = Test-Path -LiteralPath (Join-Path $root "apps\web\src")
$localBuildHash = ""
if ($sourceCheckout) {
  $workspaceRoots = @(
    Get-ChildItem -LiteralPath (Join-Path $root "apps") -Directory
    Get-ChildItem -LiteralPath (Join-Path $root "packages") -Directory
  )
  $buildInputs = @(
    foreach ($path in @("package.json", "package-lock.json", "tsconfig.json", "tsconfig.base.json")) {
      Get-Item -LiteralPath (Join-Path $root $path) -ErrorAction SilentlyContinue
    }
    foreach ($workspace in $workspaceRoots) {
      Get-ChildItem -LiteralPath $workspace.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "package.json" -or $_.Name -like "tsconfig*.json" -or $_.Name -in @("vite.config.ts", "index.html") }
      $sourceDirectory = Join-Path $workspace.FullName "src"
      if (Test-Path -LiteralPath $sourceDirectory) {
        Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File
      }
    }
    $webPublic = Join-Path $root "apps\web\public"
    if (Test-Path -LiteralPath $webPublic) {
      Get-ChildItem -LiteralPath $webPublic -Recurse -File
    }
  ) | Sort-Object FullName -Unique
  $fingerprint = $buildInputs | ForEach-Object {
    $relativePath = $_.FullName.Substring($root.Length).Replace("\", "/")
    "$relativePath=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
  }
  $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $hashAlgorithm.ComputeHash(
      [System.Text.Encoding]::UTF8.GetBytes("local-v1`n$($fingerprint -join "`n")")
    )
    $localBuildHash = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $hashAlgorithm.Dispose()
  }
}
$recordedLocalBuildHash = if (Test-Path -LiteralPath $localBuildMarker) {
  (Get-Content -LiteralPath $localBuildMarker -Raw).Trim()
} else { "" }
$needsBuild = -not (Test-Path -LiteralPath $serverEntry) -or
  -not (Test-Path -LiteralPath $webIndex) -or
  ($sourceCheckout -and $recordedLocalBuildHash -ne $localBuildHash)
if ($needsBuild) {
  Write-Host "Building NarraLume..."
  # Start-NarraLume.bat always produces the local variant. The production
  # deployment script sets the online-only Relay and trial variables separately.
  $env:VITE_TRIAL_MODE = "0"
  Remove-Item Env:VITE_DEMO_RELAY_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_DEMO_RELAY_MODEL -ErrorAction SilentlyContinue
  & $npmCommand run build --prefix $root
  if ($LASTEXITCODE -ne 0) { throw "The NarraLume build failed." }
  if ($sourceCheckout) {
    Set-Content -LiteralPath $localBuildMarker -Value $localBuildHash -Encoding ASCII
  }
}

try {
  $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
  if ($health.status -eq "ok") {
    Write-Host "NarraLume is already running at $url"
    if (-not $NoBrowser) { Start-Process $url }
    return
  }
} catch { }

$env:NODE_ENV = "production"
$env:NARRATIVE_SERVER_HOST = "127.0.0.1"
$env:NARRATIVE_SERVER_PORT = [string]$port
$env:NARRATIVE_STATIC_DIR = (Join-Path $root "apps\web\dist")
$env:NARRATIVE_DATA_DIR = $dataDirectory
$env:NARRATIVE_BACKUP_DIR = (Join-Path $dataDirectory "backups")
$stdout = Join-Path $logs "server.log"
$stderr = Join-Path $logs "server-error.log"
$process = Start-Process -FilePath $nodeExe -ArgumentList @($serverEntry) -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -NoNewWindow
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  if ($process.HasExited) { break }
  try {
    $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
    if ($health.status -eq "ok") { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) {
  throw "NarraLume failed to start. See $stderr."
}
Write-Host "NarraLume is running at $url"
Write-Host "Data: $dataDirectory"
Write-Host "Logs: $logs"
if (-not $NoBrowser) { Start-Process $url }

if ($NoWait) { return }
try {
  [void](Read-Host "Press Enter to stop NarraLume (or press Ctrl+C / close this window)")
} finally {
  if (-not $process.HasExited) {
    & (Join-Path $PSScriptRoot "stop.ps1")
  }
}
