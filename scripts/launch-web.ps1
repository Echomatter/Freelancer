[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$ChromeApp
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$state = Join-Path $appRoot 'backend\.state\webpage'
$mutex = New-Object Threading.Mutex($false, 'Local\FreelancerWebLauncher')
$held = $false
function Get-ChromePath {
    $candidates = @()
    foreach ($key in @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
    )) {
        try {
            $value = (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).'(default)'
            if ($value) { $candidates += $value }
        } catch { }
    }
    $candidates += @(
        (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $chrome = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $chrome) { throw 'Google Chrome is required for the Freelancer desktop app.' }
    return $chrome
}
function Get-RunningUrl {
    try {
        $info = Get-Content -LiteralPath (Join-Path $state 'launch.json') -Raw | ConvertFrom-Json
        $lock = Get-Content -LiteralPath (Join-Path $state 'application.lock') -Raw | ConvertFrom-Json
        if ($info.appRoot -ne $appRoot -or $info.pid -ne $lock.pid) { return }
        # Get-Process by ID is instant; a WMI/CIM query here would run on every
        # 400 ms readiness poll during startup.
        try { $process = Get-Process -Id ([int]$info.pid) -ErrorAction Stop }
        catch { return }
        if (-not $process -or $process.ProcessName -ne 'node') { return }
        $uri = [Uri]$info.url
        if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1') { return }
        $response = Invoke-WebRequest -UseBasicParsing -Uri $uri.AbsoluteUri -TimeoutSec 2
        if ($response.StatusCode -eq 200 -and $response.Content -match '<title>Freelancer</title>') { return $uri.AbsoluteUri }
    } catch { return }
}
try {
    try { $held = $mutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'Another Freelancer launch is still in progress. Try again shortly.' }
    $url = Get-RunningUrl
    if (-not $url) {
        if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) { throw 'Build the web app first: npm run build' }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        New-Item -ItemType Directory -Force -Path $state | Out-Null
        $env:FREELANCER_APP_ROOT = $appRoot
        $started = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $appRoot 'server\main.mjs') + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'server.stdout.log') -RedirectStandardError (Join-Path $state 'server.stderr.log') -PassThru
        $deadline = (Get-Date).AddSeconds(50)
        do {
            Start-Sleep -Milliseconds 400
            $url = Get-RunningUrl
            if ($url) { break }
            if ($started.HasExited) { throw "Freelancer could not start. See $state\server.stderr.log" }
        } while ((Get-Date) -lt $deadline)
        if (-not $url) { throw "Freelancer startup timed out. See $state\server.stderr.log" }
    }
    if (-not $NoBrowser) {
        if ($ChromeApp) {
            $chrome = Get-ChromePath
            # Bind the app window to the freshly checked loopback URL. A Chrome
            # PWA app-id may retain a dead port; --app always opens this runtime.
            Start-Process -FilePath $chrome -ArgumentList ('--app="' + $url + '"')
        } else {
            Start-Process $url
        }
    }
    Write-Output $url
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Freelancer', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
