<# Reproducible local-asset build. PowerShell 5.1. No provider calls. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
Push-Location $appRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Application tests failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Web asset build failed.' }
    Write-Output (Join-Path $appRoot 'dist\index.html')
} finally { Pop-Location }
