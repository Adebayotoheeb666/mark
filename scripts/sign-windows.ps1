# Sign and verify one Windows artifact with signtool.
#
# Preferred: install the OV/EV certificate in the current user's certificate store and set
#   AGM_SIGN_THUMBPRINT=<sha1 thumbprint>
#
# Alternative: point at a PFX and set the password in the environment (never on the command line):
#   AGM_SIGN_PFX=C:\secure\agent-mark-ov.pfx
#   AGM_SIGN_PASSWORD=...
#
# Optional: AGM_SIGN_TIMESTAMP_URL (default http://timestamp.digicert.com)
#
# This script is called by Tauri's bundle.windows.signCommand during release.ps1 and is also
# used to sign the NSIS/MSI installers after they are produced. It exits non-zero on failure.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$File
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $File)) {
  throw "File not found: $File"
}

function Find-SignTool {
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
    (Join-Path $env:ProgramFiles "Windows Kits\10\bin")
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $candidate = Get-ChildItem -LiteralPath $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  throw "signtool.exe not found. Install the Windows SDK signing tools."
}

$signtool = Find-SignTool
$timestamp = if ($env:AGM_SIGN_TIMESTAMP_URL) { $env:AGM_SIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }
$signArgs = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $timestamp)

if ($env:AGM_SIGN_THUMBPRINT) {
  $signArgs += @("/sha1", $env:AGM_SIGN_THUMBPRINT)
} elseif ($env:AGM_SIGN_PFX) {
  if (-not (Test-Path -LiteralPath $env:AGM_SIGN_PFX)) {
    throw "AGM_SIGN_PFX does not exist: $($env:AGM_SIGN_PFX)"
  }
  $signArgs += @("/f", $env:AGM_SIGN_PFX)
  if ($env:AGM_SIGN_PASSWORD) { $signArgs += @("/p", $env:AGM_SIGN_PASSWORD) }
} else {
  throw "No signing identity. Set AGM_SIGN_THUMBPRINT or AGM_SIGN_PFX/AGM_SIGN_PASSWORD."
}

$signArgs += $File
& $signtool @signArgs
if ($LASTEXITCODE -ne 0) { throw "signtool sign failed for $File ($LASTEXITCODE)" }

& $signtool verify /pa /v $File
if ($LASTEXITCODE -ne 0) { throw "signtool verify failed for $File ($LASTEXITCODE)" }

Write-Host "Signed and verified: $File" -ForegroundColor Green
