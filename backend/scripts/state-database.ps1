# Shared SQLite bridge. JSON is only the process wire format, never a fallback.
$script:FreelancerStateCli = Join-Path $PSScriptRoot '..\tools\runtime\state-cli.mjs'
function Enter-FreelancerStateEnvironment([string]$Path) {
    $match = [regex]::Match([IO.Path]::GetFullPath($Path), '^(?<root>.+?)[\\/]+backend[\\/]+\.state[\\/]', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { throw 'Freelancer state path is outside a registered backend state directory.' }
    $previous = [pscustomobject]@{
        DataMode = $env:FREELANCER_RUNTIME_DATA_MODE; AppRoot = $env:FREELANCER_APP_ROOT
        RuntimeRoot = $env:FREELANCER_RUNTIME_ROOT; RuntimeID = $env:FREELANCER_RUNTIME_ID
        DataHome = $env:FREELANCER_DATA_HOME
    }
    $env:FREELANCER_APP_ROOT = $match.Groups['root'].Value
    $env:FREELANCER_RUNTIME_ROOT = Join-Path $env:FREELANCER_APP_ROOT 'backend'
    if (-not $env:FREELANCER_DATA_HOME) { $env:FREELANCER_DATA_HOME = Join-Path $env:LOCALAPPDATA 'Freelancer\workspace-v2' }
    $env:FREELANCER_RUNTIME_ID = 'freelancer-workspace-v2'
    $env:FREELANCER_RUNTIME_DATA_MODE = 'unified'
    return $previous
}
function Exit-FreelancerStateEnvironment($Previous) {
    if ($null -eq $Previous.AppRoot) { Remove-Item Env:FREELANCER_APP_ROOT -ErrorAction SilentlyContinue }
    else { $env:FREELANCER_APP_ROOT = $Previous.AppRoot }
    if ($null -eq $Previous.DataMode) { Remove-Item Env:FREELANCER_RUNTIME_DATA_MODE -ErrorAction SilentlyContinue }
    else { $env:FREELANCER_RUNTIME_DATA_MODE = $Previous.DataMode }
    if ($null -eq $Previous.RuntimeRoot) { Remove-Item Env:FREELANCER_RUNTIME_ROOT -ErrorAction SilentlyContinue }
    else { $env:FREELANCER_RUNTIME_ROOT = $Previous.RuntimeRoot }
    if ($null -eq $Previous.RuntimeID) { Remove-Item Env:FREELANCER_RUNTIME_ID -ErrorAction SilentlyContinue }
    else { $env:FREELANCER_RUNTIME_ID = $Previous.RuntimeID }
    if ($null -eq $Previous.DataHome) { Remove-Item Env:FREELANCER_DATA_HOME -ErrorAction SilentlyContinue }
    else { $env:FREELANCER_DATA_HOME = $Previous.DataHome }
}
function Read-FreelancerState([string]$Path) {
    $previousConsoleEncoding = [Console]::OutputEncoding
    $previousEnvironment = Enter-FreelancerStateEnvironment $Path
    try {
        # Launcher state is JSON under the installed app root; reading or
        # cleaning it must not activate the retired per-checkout database.
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $text = & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli read $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database read failed. Existing data was preserved.' }
        return ($text | ConvertFrom-Json)
    } finally {
        [Console]::OutputEncoding = $previousConsoleEncoding
        Exit-FreelancerStateEnvironment $previousEnvironment
    }
}
function Write-FreelancerState([string]$Path, [string]$Text) {
    $previousEncoding = $OutputEncoding
    $previousEnvironment = Enter-FreelancerStateEnvironment $Path
    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)) | & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli write-base64 $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database write failed.' }
    } finally {
        $OutputEncoding = $previousEncoding
        Exit-FreelancerStateEnvironment $previousEnvironment
    }
}
function Get-FreelancerStateFiles([string]$Path) {
    $previousConsoleEncoding = [Console]::OutputEncoding
    $previousEnvironment = Enter-FreelancerStateEnvironment $Path
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $text = & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli list $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database listing failed.' }
        return ($text | ConvertFrom-Json)
    } finally {
        [Console]::OutputEncoding = $previousConsoleEncoding
        Exit-FreelancerStateEnvironment $previousEnvironment
    }
}
function Remove-FreelancerState([string]$Path) {
    $previousEnvironment = Enter-FreelancerStateEnvironment $Path
    try {
        & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli remove $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database removal failed.' }
    } finally {
        Exit-FreelancerStateEnvironment $previousEnvironment
    }
}
