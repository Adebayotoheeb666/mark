# Launch the DEBUG desktop build with the test-only real-data override enabled.
#
# The production gate is unchanged: this only works for a debug build (or a release build
# compiled with --features allow-real-data-test) AND when AGM_TEST_ALLOW_REAL_DATA=1 is set.
# The app records the override reason in the audit log and shows a red TEST MODE banner.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1 -Build
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1 -DataDir D:\agm-test
param(
    [string]$DataDir = (Join-Path $env:TEMP "agent-mark-test-real"),
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "hub-desktop\src-tauri"
$exe = Join-Path $src "target\debug\agent-mark-hub.exe"

if ($Build -or -not (Test-Path $exe)) {
    Write-Host "Building the debug desktop app..." -ForegroundColor Cyan
    Push-Location $src
    try {
        $env:PATH = (Join-Path $root "hub-desktop\tools\bin") + ";" + $env:PATH
        if (-not $env:RUSTUP_TOOLCHAIN) { $env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu" }
        & cargo build
        if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $exe)) {
    throw "Debug build not found: $exe. Run with -Build or build it first."
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:AGM_DATA_DIR = $DataDir
$env:AGM_TEST_ALLOW_REAL_DATA = "1"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " TEST MODE: the production real-data gate is bypassed." -ForegroundColor Yellow
Write-Host " Use synthetic or explicitly authorized test data only." -ForegroundColor Yellow
Write-Host " This is NOT a production database. Record authorization and delete after testing." -ForegroundColor Yellow
Write-Host " Data dir: $DataDir" -ForegroundColor Yellow
Write-Host " The app will show a red TEST MODE banner and audit the override." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

Start-Process -FilePath $exe -WorkingDirectory $src
Write-Host "Started $exe"
Write-Host "To discard the test database later: close the app, then remove '$DataDir'."
