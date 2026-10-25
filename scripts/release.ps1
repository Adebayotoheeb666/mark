# Build, bundle and publish a Windows release into website/downloads.
#
#   .\scripts\release.ps1                 # version from tauri.conf.json
#   .\scripts\release.ps1 -Version 0.1.1  # must already be set in tauri.conf.json
#
# Requires: the GNU Rust toolchain + Zig shims described in hub-desktop/README.md,
# and the Tauri CLI installed globally (npm i -g @tauri-apps/cli).
#
# It does five things:
#   1. cargo/tauri release build + NSIS and MSI bundles
#   2. portable ZIP with README.txt
#   3. copies all three artifacts into website/downloads with stable names
#   4. rewrites website/version.json and SHA256SUMS.txt
#   5. syncs the no-JS fallbacks in download.html

param(
  [string]$Version = "",
  [string]$Channel = "pilot",
  [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "hub-desktop"
$conf = Get-Content (Join-Path $app "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json

if (-not $Version) { $Version = $conf.version }
if ($conf.version -ne $Version) {
  throw "tauri.conf.json is version $($conf.version) but -Version $Version was requested. Bump the config first."
}

$tauri = Join-Path $env:APPDATA "npm\tauri.cmd"
if (-not (Test-Path $tauri)) { throw "Tauri CLI not found at $tauri. Run: npm i -g @tauri-apps/cli" }

Write-Host "==> Building Agent Mark Hub $Version" -ForegroundColor Cyan
Push-Location $app
try {
  $env:PATH = "$app\tools\bin;$env:PATH"
  $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"

  & $tauri build --bundles nsis,msi
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }

  $release = Join-Path $app "src-tauri\target\release"
  $setupSrc = Join-Path $release "bundle\nsis\Agent Mark Hub_${Version}_x64-setup.exe"
  if (-not (Test-Path $setupSrc)) { throw "installer not found: $setupSrc" }
  $msiSrc = Join-Path $release "bundle\msi\Agent Mark Hub_${Version}_x64_en-US.msi"
  if (-not (Test-Path $msiSrc)) { throw "MSI not found: $msiSrc" }

  Write-Host "==> Packaging portable ZIP" -ForegroundColor Cyan
  $stage = Join-Path $env:TEMP "agm-portable\Agent-Mark-Hub-$Version"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Copy-Item (Join-Path $release "agent-mark-hub.exe") $stage
  Copy-Item (Join-Path $release "WebView2Loader.dll") $stage

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
Pilot preview: use synthetic data only until the external security audit closes.
"@ | Set-Content -Encoding utf8 (Join-Path $stage "README.txt")

  $zip = Join-Path $env:TEMP "agm-portable-$Version.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $env:TEMP "agm-portable\*") -DestinationPath $zip -CompressionLevel Optimal

  Write-Host "==> Publishing artifacts" -ForegroundColor Cyan
  $dl = Join-Path $root "website\downloads"
  New-Item -ItemType Directory -Force -Path $dl | Out-Null
  Copy-Item $setupSrc (Join-Path $dl "Agent-Mark-Hub-$Version-x64-setup.exe") -Force
  Copy-Item $msiSrc (Join-Path $dl "Agent-Mark-Hub-$Version-x64.msi") -Force
  Copy-Item $zip (Join-Path $dl "Agent-Mark-Hub-$Version-windows-x64-portable.zip") -Force
} finally {
  Pop-Location
}

$stampArgs = @((Join-Path $root "scripts\stamp_release.py"), "--version", $Version, "--channel", $Channel)
if ($Notes) { $stampArgs += @("--notes", $Notes) }
& python @stampArgs
if ($LASTEXITCODE -ne 0) { throw "stamp_release.py failed" }

Write-Host ""
Write-Host "Artifacts are in website\downloads. Deploy with:" -ForegroundColor Green
Write-Host "  cd website; vercel --prod" -ForegroundColor Green
