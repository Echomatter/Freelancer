[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'stop-web.ps1')
    & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Freelancer Restart', 'OK', 'Error') | Out-Null
    exit 1
}
