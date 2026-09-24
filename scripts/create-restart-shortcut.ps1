[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop 'Freelancer Restart.lnk'
$iconPath = Join-Path $appRoot 'backend\.state\launcher\freelancer.ico'
if (-not (Test-Path -LiteralPath $iconPath)) {
    & (Join-Path $PSScriptRoot 'create-desktop-shortcut.ps1') | Out-Null
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'restart-chrome-app.vbs') + '"'
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Gracefully restart Freelancer through its system tray controller.'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
