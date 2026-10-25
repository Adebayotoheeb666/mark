@echo off
rem Wrapper so the release script runs on machines where PowerShell's execution
rem policy blocks .ps1 files (the default on this PC). Any arguments are passed
rem through, e.g.:  scripts\release.cmd -Version 0.1.1 -Notes "Bug fixes."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1" %*
exit /b %ERRORLEVEL%
