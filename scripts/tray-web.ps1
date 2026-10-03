[CmdletBinding()]
param([switch]$Restart, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $appRoot 'backend\scripts\state-database.ps1')
$state = Join-Path $appRoot 'backend\.state\webpage'
$iconPath = Join-Path $appRoot 'backend\.state\launcher\freelancer.ico'
$mutex = New-Object Threading.Mutex($false, 'Local\FreelancerTrayController')
$ownsTray = $false
$startMode = 'chrome'
try {
    $nodeScript = Join-Path $PSScriptRoot '..\backend\tools\runtime\application-settings-cli.mjs'
    $settingsJson = & node --disable-warning=ExperimentalWarning $nodeScript read
    if ($LASTEXITCODE -ne 0) { throw 'Application settings read failed.' }
    $saved = $settingsJson | ConvertFrom-Json
    if ($saved.values.launcher.startIn -in @('chrome', 'browser')) { $startMode = $saved.values.launcher.startIn }
} catch { }

function Set-StartMode([string]$mode) {
    $payload = @{ launcher = @{ startIn = $mode } } | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $encoded = [Convert]::ToBase64String($bytes)
    $encoded | & node --disable-warning=ExperimentalWarning $nodeScript update-launcher
    if ($LASTEXITCODE -ne 0) { throw 'Application settings write failed.' }
    $script:startMode = $mode
    $chromeItem.Checked = $mode -eq 'chrome'
    $browserItem.Checked = $mode -eq 'browser'
}

function Show-FreelancerError($message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show([string]$message, 'Freelancer', 'OK', 'Error') | Out-Null
}
function Open-Freelancer([string]$mode = $script:startMode) {
    & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp:($mode -eq 'chrome') | Out-Null
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Freelancer could not open.' }
}
function Restart-Freelancer {
    & (Join-Path $PSScriptRoot 'stop-web.ps1')
    Open-Freelancer
}

try {
    try { $ownsTray = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsTray = $true }
    if (-not $ownsTray) {
        if ($Restart) { Restart-Freelancer } elseif (-not $NoOpen) { Open-Freelancer }
        return
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    if (-not (Test-Path -LiteralPath $iconPath)) {
        & (Join-Path $PSScriptRoot 'create-desktop-shortcut.ps1') | Out-Null
    }
    if ($Restart) { Restart-Freelancer } elseif (-not $NoOpen) { Open-Freelancer }

    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = $menu.Items.Add('Open Freelancer')
    $openBrowserItem = $menu.Items.Add('Open in browser')
    $startItem = New-Object System.Windows.Forms.ToolStripMenuItem('Start in')
    $chromeItem = $startItem.DropDownItems.Add('Chrome app')
    $browserItem = $startItem.DropDownItems.Add('Browser')
    $chromeItem.Checked = $startMode -eq 'chrome'
    $browserItem.Checked = $startMode -eq 'browser'
    $menu.Items.Add($startItem) | Out-Null
    $restartItem = $menu.Items.Add('Restart server')
    $menu.Items.Add('-') | Out-Null
    $exitItem = $menu.Items.Add('Exit Freelancer')
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = New-Object System.Drawing.Icon($iconPath)
    $notify.Text = 'Freelancer'
    $notify.ContextMenuStrip = $menu
    $notify.Visible = $true
    $context = New-Object System.Windows.Forms.ApplicationContext
    $openItem.add_Click({ try { Open-Freelancer } catch { Show-FreelancerError $_.Exception.Message } })
    $openBrowserItem.add_Click({ try { Open-Freelancer 'browser' } catch { Show-FreelancerError $_.Exception.Message } })
    $chromeItem.add_Click({ try { Set-StartMode 'chrome' } catch { Show-FreelancerError $_.Exception.Message } })
    $browserItem.add_Click({ try { Set-StartMode 'browser' } catch { Show-FreelancerError $_.Exception.Message } })
    $restartItem.add_Click({ try { Restart-Freelancer } catch { Show-FreelancerError $_.Exception.Message } })
    $notify.add_DoubleClick({ try { Open-Freelancer } catch { Show-FreelancerError $_.Exception.Message } })
    $exitItem.add_Click({
        try {
            & (Join-Path $PSScriptRoot 'stop-web.ps1')
            $context.ExitThread()
        } catch { Show-FreelancerError $_.Exception.Message }
    })
    [System.Windows.Forms.Application]::Run($context)
} catch {
    Show-FreelancerError $_.Exception.Message
    exit 1
} finally {
    if ($notify) { $notify.Visible = $false; $notify.Dispose() }
    if ($menu) { $menu.Dispose() }
    if ($ownsTray) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
