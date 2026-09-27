[CmdletBinding()]
param()
# Compatibility entry point: one desktop launcher; restart lives in the tray.
& (Join-Path $PSScriptRoot 'create-desktop-shortcut.ps1')
