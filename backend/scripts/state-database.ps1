# Shared SQLite bridge. JSON is only the process wire format, never a fallback.
$script:FreelancerStateCli = Join-Path $PSScriptRoot '..\tools\runtime\state-cli.mjs'
function Read-FreelancerState([string]$Path) {
    $previousConsoleEncoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $text = & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli read $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database read failed. Existing data was preserved.' }
        return ($text | ConvertFrom-Json)
    } finally { [Console]::OutputEncoding = $previousConsoleEncoding }
}
function Write-FreelancerState([string]$Path, [string]$Text) {
    $previousEncoding = $OutputEncoding
    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)) | & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli write-base64 $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database write failed.' }
    } finally { $OutputEncoding = $previousEncoding }
}
function Get-FreelancerStateFiles([string]$Path) {
    $previousConsoleEncoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $text = & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli list $Path
        if ($LASTEXITCODE -ne 0) { throw 'Freelancer database listing failed.' }
        return ($text | ConvertFrom-Json)
    } finally { [Console]::OutputEncoding = $previousConsoleEncoding }
}
function Remove-FreelancerState([string]$Path) {
    & node --disable-warning=ExperimentalWarning $script:FreelancerStateCli remove $Path
    if ($LASTEXITCODE -ne 0) { throw 'Freelancer database removal failed.' }
}
