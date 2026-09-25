# Fresh Windows setup for a source checkout. PowerShell 5.1 compatible.
[CmdletBinding()]
param(
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$SkipPrerequisiteInstall
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Require-Command($name, $package) {
    if (Get-Command $name -ErrorAction SilentlyContinue) { return }
    if ($SkipPrerequisiteInstall) { throw "$name is required. Install $package and rerun setup." }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "$name is required. Install $package, or install Windows Package Manager, then rerun setup."
    }
    Write-Host "Installing $package..."
    & winget.exe install --id $package --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Failed to install $package (exit $LASTEXITCODE)." }
    Refresh-Path
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$package was installed but $name is not on PATH yet. Open a new PowerShell window and rerun setup."
    }
}

if (-not $IsWindows -and -not $env:WINDIR) { throw 'This setup supports Windows only.' }
Require-Command 'node.exe' 'OpenJS.NodeJS.LTS'
Require-Command 'npm.cmd' 'OpenJS.NodeJS.LTS'
Require-Command 'git.exe' 'Git.Git'
Require-Command 'gh.exe' 'GitHub.cli'
if (-not $NoShortcuts) {
    $chromePaths = @(
        (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $chromePresent = (Get-Command 'chrome.exe' -ErrorAction SilentlyContinue) -or
        ($chromePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
    if (-not $chromePresent) {
        if ($SkipPrerequisiteInstall -or -not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw 'Google Chrome is required for the desktop shortcut. Install it and rerun setup, or use -NoShortcuts.'
        }
        & winget.exe install --id Google.Chrome --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Google Chrome installation failed.' }
    }
}

$versionText = (& node.exe --version).TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]$versionText -lt [version]'22.13.0') {
    throw "Node.js 22.13 or newer is required (found $versionText)."
}
if (-not (Get-Command 'opencode.cmd' -ErrorAction SilentlyContinue) -and
    -not (Get-Command 'opencode.exe' -ErrorAction SilentlyContinue)) {
    if ($SkipPrerequisiteInstall) { throw 'OpenCode is required. Install opencode-ai@1.18.31 and rerun setup.' }
    & npm.cmd install --global opencode-ai@1.18.31
    if ($LASTEXITCODE -ne 0) { throw 'OpenCode installation failed.' }
    Refresh-Path
    if (-not (Get-Command 'opencode.cmd' -ErrorAction SilentlyContinue) -and
        -not (Get-Command 'opencode.exe' -ErrorAction SilentlyContinue)) {
        throw 'OpenCode was installed but is not on PATH yet. Open a new PowerShell window and rerun setup.'
    }
}

Push-Location $appRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    & npm.cmd run smoke:runtime
    if ($LASTEXITCODE -ne 0) { throw 'Native startup check failed.' }
    if (-not $NoShortcuts) {
        & (Join-Path $PSScriptRoot 'create-desktop-shortcut.ps1')
        & (Join-Path $PSScriptRoot 'create-restart-shortcut.ps1')
    }
    if (-not $NoLaunch) {
        if ($NoShortcuts) { & (Join-Path $PSScriptRoot 'launch-web.ps1') }
        else { & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp }
    }
    Write-Host 'Freelancer setup completed.'
} finally { Pop-Location }
