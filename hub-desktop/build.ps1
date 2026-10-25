# Builds the Agent Mark Hub desktop app on THIS machine (no Visual Studio installed).
#
# It uses the windows-gnu target with the bundled Zig toolchain in tools/. The same
# commands work on any Windows box that has Visual Studio Build Tools; there you can
# drop the --target flag and the .cargo/config.toml bridge.
#
#   .\build.ps1              # debug build + run
#   .\build.ps1 -Release     # optimised .exe in src-tauri\target\release
param([switch]$Release)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root                              # cargo reads .cargo/config.toml from cwd upward
$env:PATH = "$root\tools\bin;$env:PATH"          # windres shim for tauri-build
$cargo = "$env:USERPROFILE\.cargo\bin\cargo.exe"

$profileArg = if ($Release) { "--release" } else { "" }
$toolchain = "stable-x86_64-pc-windows-gnu"   # GNU host too: no MSVC anywhere in the loop
Write-Host "Building ($toolchain host+target, zig-backed linker)..." -ForegroundColor Cyan
& $cargo "+$toolchain" build --manifest-path "$root\src-tauri\Cargo.toml" $profileArg
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$dir = if ($Release) { "release" } else { "debug" }
# No --target flag: host == target, so cargo uses the plain target\<profile> directory.
$exe = "$root\src-tauri\target\$dir\agent-mark-hub.exe"
Write-Host "Built: $exe" -ForegroundColor Green

if (-not $Release) {
    Write-Host "Launching..." -ForegroundColor Cyan
    & $exe
}
