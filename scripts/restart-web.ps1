[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$state = Join-Path $appRoot 'backend\.state\webpage'
$launchFile = Join-Path $state 'launch.json'
$lockFile = Join-Path $state 'application.lock'

function Get-LaunchRecord {
    if (-not (Test-Path -LiteralPath $launchFile)) { return }
    try { return Get-Content -LiteralPath $launchFile -Raw | ConvertFrom-Json } catch { return }
}

function Stop-FreelancerServer {
    $record = Get-LaunchRecord
    if (-not $record -or $record.appRoot -ne $appRoot -or -not $record.pid) { return }
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not $process) { return }
    # Fail closed: an unverifiable process identity must never be stopped.
    # .Path can throw (or be empty) for protected processes; a recycled PID
    # must not let us kill an unrelated process.
    $procPath = $null
    try { $procPath = $process.Path } catch { }
    if (-not $procPath -or ([IO.Path]::GetFileName($procPath) -ne 'node.exe')) {
        throw "Refusing to stop unexpected process $($process.Id) ($procPath)."
    }
    if ($record.shutdownToken) {
        if ($record.url -notmatch '^http://127\.0\.0\.1:\d+/$') {
            throw 'Freelancer has an invalid graceful-shutdown address. No process was stopped.'
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method Post `
                -Uri ($record.url.TrimEnd('/') + '/__shutdown') `
                -Headers @{ 'X-Freelancer-Shutdown' = [string]$record.shutdownToken } `
                -TimeoutSec 5
        } catch { throw 'Freelancer did not accept a graceful shutdown request. No process was stopped.' }
        if ($response.StatusCode -ne 202) { throw 'Freelancer rejected its graceful shutdown request. No process was stopped.' }
        $deadline = (Get-Date).AddSeconds(60)
        do {
            Start-Sleep -Milliseconds 250
            $stillRunning = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
        } while ($stillRunning -and (Get-Date) -lt $deadline)
        if ($stillRunning) { throw 'Freelancer did not finish its graceful shutdown. It was left running to protect local data.' }
        return
    }
    # Compatibility for a server started before graceful shutdown support.
    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 250
        $stillRunning = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    } while ($stillRunning -and (Get-Date) -lt $deadline)
    if ($stillRunning) {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
    }
}

function Remove-StaleLock {
    if (-not (Test-Path -LiteralPath $lockFile)) { return }
    try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { return }
    if (-not $lock.pid) { return }
    $owner = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
    if (-not $owner) {
        Remove-Item -LiteralPath $lockFile -Force
    }
}

try {
    Stop-FreelancerServer
    Remove-StaleLock
    $deadline = (Get-Date).AddSeconds(20)
    while ((Test-Path -LiteralPath $lockFile) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-Path -LiteralPath $lockFile) {
        throw "Freelancer did not release its application lock. Inspect $state."
    }
    & (Join-Path $PSScriptRoot 'launch-web.ps1') -ChromeApp
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Freelancer Restart', 'OK', 'Error') | Out-Null
    exit 1
}
