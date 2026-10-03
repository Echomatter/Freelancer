[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'stop-web.ps1')
    if ($NoBrowser) { & (Join-Path $PSScriptRoot 'launch-web.ps1') -NoBrowser }
    else { & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp }
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Freelancer Restart', 'OK', 'Error') | Out-Null
    exit 1
}
