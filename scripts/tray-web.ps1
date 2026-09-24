[CmdletBinding()]
param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$state = Join-Path $appRoot 'backend\.state\webpage'
$iconPath = Join-Path $appRoot 'backend\.state\launcher\freelancer.ico'
$mutex = New-Object Threading.Mutex($false, 'Local\FreelancerTrayController')
$ownsTray = $false

function Show-FreelancerError($message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show([string]$message, 'Freelancer', 'OK', 'Error') | Out-Null
}
function Open-Freelancer {
    & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp | Out-Null
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
        if ($Restart) { Restart-Freelancer } else { Open-Freelancer }
        return
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if (-not (Test-Path -LiteralPath $iconPath)) {
        & (Join-Path $PSScriptRoot 'create-desktop-shortcut.ps1') | Out-Null
    }
    if ($Restart) { Restart-Freelancer } else { Open-Freelancer }

    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $openItem = $menu.Items.Add('Open Freelancer')
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
