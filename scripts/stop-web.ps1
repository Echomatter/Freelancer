[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$state = Join-Path $appRoot 'backend\.state\webpage'
$launchFile = Join-Path $state 'launch.json'
$lockFile = Join-Path $state 'application.lock'

if (Test-Path -LiteralPath $launchFile) {
    try { $record = Get-Content -LiteralPath $launchFile -Raw | ConvertFrom-Json }
    catch { throw 'Freelancer launch record is unreadable. No process was stopped.' }
    if ($record.appRoot -ne $appRoot -or -not $record.pid -or -not $record.shutdownToken -or
        $record.url -notmatch '^http://127\.0\.0\.1:\d+/?$') {
        throw 'Freelancer launch record cannot verify a graceful shutdown. No process was stopped.'
    }
    $serverProcess = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if ($serverProcess) {
        $procPath = $null
        try { $procPath = $serverProcess.Path } catch { }
        if (-not $procPath -or ([IO.Path]::GetFileName($procPath) -ne 'node.exe')) {
            throw "Refusing to stop unexpected process $($serverProcess.Id) ($procPath)."
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
            $serverProcess = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
        } while ($serverProcess -and (Get-Date) -lt $deadline)
        if ($serverProcess) { throw 'Freelancer did not finish its graceful shutdown. It was left running to protect local data.' }
    }
}

# Only remove a lock whose recorded owner has exited.
if (Test-Path -LiteralPath $lockFile) {
    try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json }
    catch { throw 'Freelancer application lock is unreadable.' }
    if (-not $lock.pid) { throw 'Freelancer application lock has no owner.' }
    if (-not (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $lockFile -Force
    }
}
$deadline = (Get-Date).AddSeconds(20)
while ((Test-Path -LiteralPath $lockFile) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $lockFile) { throw "Freelancer did not release its application lock. Inspect $state." }
if (Test-Path -LiteralPath $launchFile) { throw 'Freelancer did not remove its launch record.' }
