# Build, bundle and publish a Windows release into website/downloads.
#
#   .\scripts\release.ps1                 # signed production release (cert required)
#   .\scripts\release.ps1 -AllowUnsigned  # internal pilot build, clearly marked unsigned
#   .\scripts\release.ps1 -OutDir .\pilot-dist -AllowUnsigned
#
# Signing identity (one of):
#   AGM_SIGN_THUMBPRINT=<SHA-1 thumbprint of an installed OV/EV certificate>   (preferred)
#   AGM_SIGN_PFX=C:\secure\agent-mark-ov.pfx + AGM_SIGN_PASSWORD=...
#   AGM_SIGN_TIMESTAMP_URL=https://timestamp.digicert.com   (optional)
#
# Requires: the GNU Rust toolchain + Zig shims described in hub-desktop/README.md,
# and the Tauri CLI installed globally (npm i -g @tauri-apps/cli).
#
# It does five things:
#   1. cargo/tauri release build + NSIS and MSI bundles (signs them when configured)
#   2. portable ZIP with README.txt
#   3. copies all three artifacts into website/downloads (or -OutDir)
#   4. rewrites website/version.json and SHA256SUMS.txt
#   5. syncs the no-JS fallbacks in download.html

param(
  [string]$Version = "",
  [string]$Channel = "pilot",
  [string]$Notes = "",
  [switch]$AllowUnsigned,
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "hub-desktop"
$conf = Get-Content (Join-Path $app "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json

if (-not $Version) { $Version = $conf.version }
if ($conf.version -ne $Version) {
  throw "tauri.conf.json is version $($conf.version) but -Version $Version was requested. Bump the config first."
}

$signThumb = $env:AGM_SIGN_THUMBPRINT
$signPfx = $env:AGM_SIGN_PFX
$signingConfigured = (($signThumb -ne $null -and $signThumb -ne "") -or ($signPfx -ne $null -and $signPfx -ne "" -and (Test-Path -LiteralPath $signPfx)))
if (-not $signingConfigured -and -not $AllowUnsigned) {
  throw "No code-signing identity configured. Set AGM_SIGN_THUMBPRINT (preferred) or AGM_SIGN_PFX + AGM_SIGN_PASSWORD. Use -AllowUnsigned only for an internal pilot build."
}
$signingStatus = if ($signingConfigured) { "signed" } else { "unsigned-internal-pilot" }
if ($signingConfigured) {
  Write-Host "==> Signing identity configured ($signingStatus)" -ForegroundColor Cyan
} else {
  Write-Host "==> WARNING: unsigned internal pilot build; do not publish as a production release" -ForegroundColor Yellow
}

$tauri = Join-Path $env:APPDATA "npm\tauri.cmd"
if (-not (Test-Path $tauri)) { throw "Tauri CLI not found at $tauri. Run: npm i -g @tauri-apps/cli" }

Write-Host "==> Building Agent Mark Hub $Version" -ForegroundColor Cyan
Push-Location $app
try {
  $env:PATH = "$app\tools\bin;$env:PATH"
  $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"

  $buildArgs = @("build", "--bundles", "nsis,msi")
  if ($signingConfigured) {
    $signScript = Join-Path $PSScriptRoot "sign-windows.ps1"
    $signCommand = @{
      cmd = "powershell"
      args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $signScript, "%1")
    }
    $configObj = @{ bundle = @{ windows = @{ signCommand = $signCommand } } }
    $buildArgs += @("--config", ($configObj | ConvertTo-Json -Depth 10 -Compress))
  }
  & $tauri @buildArgs
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }

  $release = Join-Path $app "src-tauri\target\release"
  $setupSrc = Join-Path $release "bundle\nsis\Agent Mark Hub_${Version}_x64-setup.exe"
  if (-not (Test-Path $setupSrc)) { throw "installer not found: $setupSrc" }
  $msiSrc = Join-Path $release "bundle\msi\Agent Mark Hub_${Version}_x64_en-US.msi"
  if (-not (Test-Path $msiSrc)) { throw "MSI not found: $msiSrc" }
  $appExe = Join-Path $release "agent-mark-hub.exe"

  if ($signingConfigured) {
    Write-Host "==> Signing app, NSIS and MSI" -ForegroundColor Cyan
    $signScript = Join-Path $PSScriptRoot "sign-windows.ps1"
    foreach ($artifact in @($appExe, $setupSrc, $msiSrc)) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $signScript $artifact
      if ($LASTEXITCODE -ne 0) { throw "signing failed: $artifact" }
    }
  }

  Write-Host "==> Packaging portable ZIP" -ForegroundColor Cyan
  $portableRoot = Join-Path $env:TEMP "agm-portable"
  $stage = Join-Path $portableRoot "Agent-Mark-Hub-$Version"
  if (Test-Path $portableRoot) { Remove-Item $portableRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Copy-Item (Join-Path $release "agent-mark-hub.exe") $stage
  Copy-Item (Join-Path $release "WebView2Loader.dll") $stage

  $signingLine = if ($signingConfigured) {
    "Signed Windows build: yes. Verify with: signtool verify /pa /v <file>"
  } else {
    "UNSIGNED INTERNAL PILOT BUILD. Do not publish this as a production release. Use it only under a written school pilot authorization, and do not enter real student data until the production gate is green."
  }
  $gateLine = if ($signingConfigured) {
    "Pilot gate: use synthetic data only until the external security review and school/legal gates close."
  } else {
    "Pilot gate: unsigned build. Synthetic data only unless the school has separately authorized a controlled test."
  }

  @"
Agent Mark Hub $Version - portable build (Windows 10/11, 64-bit)
=============================================================

This folder is the whole application. No installer, no admin rights.

To run: double-click agent-mark-hub.exe
To "install": move this folder somewhere permanent (e.g. C:\Apps\AgentMarkHub)
and create a shortcut to agent-mark-hub.exe.

Keep WebView2Loader.dll next to the .exe - the app will not start without it.

Data is stored in:
  %APPDATA%\org.agentmark.hub\agent-mark-hub\

Delete that folder for a factory reset. Backups are written to its backups\
subfolder and are encrypted.

No internet connection is required. No AI. No telemetry.
$signingLine
$gateLine
"@ | Set-Content -Encoding utf8 (Join-Path $stage "README.txt")

  $zip = Join-Path $env:TEMP "agm-portable-$Version.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $zip -CompressionLevel Optimal

  Write-Host "==> Publishing artifacts" -ForegroundColor Cyan
  $isDefaultOut = [string]::IsNullOrWhiteSpace($OutDir)
  $dl = if ($isDefaultOut) {
    Join-Path $root "website\downloads"
  } elseif ([System.IO.Path]::IsPathRooted($OutDir)) {
    $OutDir
  } else {
    Join-Path $root $OutDir
  }
  New-Item -ItemType Directory -Force -Path $dl | Out-Null
  $setupOut = Join-Path $dl "Agent-Mark-Hub-$Version-x64-setup.exe"
  $msiOut = Join-Path $dl "Agent-Mark-Hub-$Version-x64.msi"
  $zipOut = Join-Path $dl "Agent-Mark-Hub-$Version-windows-x64-portable.zip"
  Copy-Item $setupSrc $setupOut -Force
  Copy-Item $msiSrc $msiOut -Force
  Copy-Item $zip $zipOut -Force
} finally {
  Pop-Location
}

if ($isDefaultOut) {
  $stampArgs = @((Join-Path $root "scripts\stamp_release.py"), "--version", $Version, "--channel", $Channel, "--signing-status", $signingStatus)
  if ($Notes) { $stampArgs += @("--notes", $Notes) }
  if ($signingConfigured) { $stampArgs += "--signed" } else { $stampArgs += "--unsigned" }
  & python @stampArgs
  if ($LASTEXITCODE -ne 0) { throw "stamp_release.py failed" }
} else {
  $sums = @()
  foreach ($artifact in @($setupOut, $msiOut, $zipOut)) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash
    $sums += "$hash  $(Split-Path -Leaf $artifact)"
  }
  $sums | Set-Content -Encoding ascii (Join-Path $dl "SHA256SUMS.txt")
  Write-Host "Artifacts copied to $dl; version.json was not updated because -OutDir was used." -ForegroundColor Yellow
}

Write-Host ""
if ($isDefaultOut) {
  Write-Host "Artifacts are in website\downloads. Deploy with:" -ForegroundColor Green
  Write-Host "  cd website; vercel --prod" -ForegroundColor Green
} else {
  Write-Host "Internal pilot artifacts are in $dl" -ForegroundColor Green
}
