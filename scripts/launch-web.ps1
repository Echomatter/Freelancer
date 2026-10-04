[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$ChromeApp
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$state = Join-Path $appRoot 'backend\.state\webpage'
. (Join-Path $appRoot 'backend\scripts\state-database.ps1')
$mutex = New-Object Threading.Mutex($false, 'Local\FreelancerWebLauncher')
$held = $false
$started = $null
$startupComplete = $false
$startupDeadlineSeconds = 85
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
function Get-RunningInfo {
    try {
        $info = Read-FreelancerState (Join-Path $state 'launch.json')
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
        if ($response.StatusCode -eq 200 -and $response.Content -match '<title>Freelancer</title>') {
            return [pscustomobject]@{ Url = $uri.AbsoluteUri; LanUrl = $info.lanUrl }
        }
    } catch { return }
}
function Get-ProcessStartTicks([int]$ProcessId) {
    try { return (Get-Process -Id $ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().Ticks }
    catch { return $null }
}
function Get-ObservedProcess([int]$ProcessId) {
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        try {
            return [pscustomobject]@{ State = 'present'; Name = $process.ProcessName.ToLowerInvariant();
                StartTicks = $process.StartTime.ToUniversalTime().Ticks; Path = [string]$process.Path }
        } catch {
            return [pscustomobject]@{ State = 'unknown'; Name = $process.ProcessName.ToLowerInvariant(); StartTicks = $null; Path = $null }
        }
    } catch {
        # Distinguish an exited PID from an access-denied/temporarily unreadable
        # process using a narrow PID-only query. Do not inspect command lines.
        try {
            $row = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" `
                -Property ProcessId, ParentProcessId, Name -ErrorAction Stop
            if ($row) { return [pscustomobject]@{ State = 'unknown'; Name = [IO.Path]::GetFileNameWithoutExtension([string]$row.Name).ToLowerInvariant(); StartTicks = $null; Path = $null } }
            return [pscustomobject]@{ State = 'missing'; Name = $null; StartTicks = $null; Path = $null }
        } catch {
            return [pscustomobject]@{ State = 'unknown'; Name = $null; StartTicks = $null; Path = $null }
        }
    }
}
function Get-StartupDescendants([int]$RootPID) {
    # Query only direct children of an already verified parent. Do not inspect
    # command lines or enumerate process arguments: identity is PID, parent PID,
    # executable name and process start time only.
    $queue = New-Object 'System.Collections.Generic.Queue[object]'
    $visited = New-Object 'System.Collections.Generic.HashSet[int]'
    $ordered = New-Object 'System.Collections.Generic.List[object]'
    [void]$visited.Add($RootPID)
    $queue.Enqueue([pscustomobject]@{ Pid = $RootPID; Depth = 0 })
    while ($queue.Count -gt 0 -and $ordered.Count -lt 32) {
        $parent = $queue.Dequeue()
        if ($parent.Depth -ge 5) { continue }
        try {
            $children = @(Get-CimInstance -ClassName Win32_Process `
                -Filter "ParentProcessId = $($parent.Pid)" `
                -Property ProcessId, ParentProcessId, Name -ErrorAction Stop)
        } catch { throw 'Could not enumerate the verified startup process tree.' }
        foreach ($child in $children) {
            $childPID = 0
            if (-not [int]::TryParse([string]$child.ProcessId, [ref]$childPID) -or
                $child.ParentProcessId -ne $parent.Pid -or $childPID -le 0 -or
                -not $visited.Add($childPID)) { continue }
            $name = [IO.Path]::GetFileNameWithoutExtension([string]$child.Name).ToLowerInvariant()
            if ($name -notin @('node', 'opencode', 'conhost')) { continue }
            $ticks = Get-ProcessStartTicks $childPID
            if (-not $ticks) { continue }
            $row = [pscustomobject]@{ Pid = $childPID; ParentPID = [int]$parent.Pid; Name = $name; StartTicks = $ticks; Depth = $parent.Depth + 1 }
            $ordered.Add($row)
            $queue.Enqueue($row)
            if ($ordered.Count -ge 32) { break }
        }
    }
    return $ordered.ToArray()
}
function Stop-OwnedStartupProcess {
    if (-not $started) { return }
    $rootPID = [int]$started.Id
    $root = Get-ObservedProcess $rootPID
    if ($root.State -ne 'present' -or $root.Name -ne 'node' -or
        $root.StartTicks -ne $startedStartTicks -or
        -not $root.Path -or [IO.Path]::GetFullPath($root.Path) -ine $startedExecutablePath) {
        throw 'Could not verify the launcher-owned Node process; refusing to terminate an unverified process.'
    }

    # Snapshot only the bounded native process tree under this exact Node PID.
    # Stop descendants leaf-first, rechecking each PID/start-time pair so PID
    # reuse or another Freelancer instance cannot be mistaken for our child.
    $descendants = @(Get-StartupDescendants $rootPID)
    $identities = @($descendants) + @([pscustomobject]@{
        Pid = $rootPID; Name = 'node'; StartTicks = $startedStartTicks; Path = $startedExecutablePath
    })
    $cleanupDeadline = (Get-Date).AddSeconds(4)
    $leafFirst = @($descendants)
    [array]::Reverse($leafFirst)
    foreach ($candidate in $leafFirst) {
        $current = Get-ObservedProcess ([int]$candidate.Pid)
        if ($current.State -eq 'present' -and $current.Name -eq $candidate.Name -and
            $current.StartTicks -eq $candidate.StartTicks) {
            try { Stop-Process -Id ([int]$candidate.Pid) -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    $currentRoot = Get-ObservedProcess $rootPID
    if ($currentRoot.State -eq 'present' -and $currentRoot.Name -eq 'node' -and
        $currentRoot.StartTicks -eq $startedStartTicks -and
        $currentRoot.Path -and [IO.Path]::GetFullPath($currentRoot.Path) -ieq $startedExecutablePath) {
        try { Stop-Process -Id $rootPID -Force -ErrorAction SilentlyContinue } catch { }
    }
    do {
        $remaining = @()
        foreach ($identity in $identities) {
            $current = Get-ObservedProcess ([int]$identity.Pid)
            if ($current.State -eq 'unknown' -or
                ($current.State -eq 'present' -and $current.Name -eq $identity.Name -and
                    $current.StartTicks -eq $identity.StartTicks)) { $remaining += $identity }
        }
        if (-not $remaining.Count) { return }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $cleanupDeadline)
    throw ('Could not confirm exit of launcher-owned startup process IDs: ' + (($remaining | ForEach-Object { $_.Pid }) -join ', ') + '.')
}
try {
    try { $held = $mutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'Another Freelancer launch is still in progress. Try again shortly.' }
    $running = Get-RunningInfo
    if (-not $running) {
        if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) { throw 'Build the web app first: npm run build' }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        New-Item -ItemType Directory -Force -Path $state | Out-Null
        $env:FREELANCER_APP_ROOT = $appRoot
        $started = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $appRoot 'server\main.mjs') + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'server.stdout.log') -RedirectStandardError (Join-Path $state 'server.stderr.log') -PassThru
        $startedExecutablePath = [IO.Path]::GetFullPath($node)
        $startedStartTicks = Get-ProcessStartTicks ([int]$started.Id)
        if (-not $startedStartTicks) { throw 'Freelancer startup process identity could not be verified.' }
        # Native OpenCode can need up to 75 seconds to finish a cold plugin
        # initialization before main publishes the HTTP endpoint. Keep a small
        # margin for process launch and bounded cleanup.
        $deadline = (Get-Date).AddSeconds($startupDeadlineSeconds)
        do {
            Start-Sleep -Milliseconds 400
            $running = Get-RunningInfo
            if ($running) { break }
            if ($started.HasExited) { throw "Freelancer could not start. See $state\server.stderr.log" }
        } while ((Get-Date) -lt $deadline)
        if (-not $running) { throw "Freelancer startup timed out. See $state\server.stderr.log" }
    }
    $startupComplete = $true
    $url = [string]$running.Url
    $lanUrl = [string]$running.LanUrl
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
    if ($lanUrl) { Write-Output ("LAN: " + $lanUrl) }
} catch {
    $failureMessage = $_.Exception.Message
    if ($started -and -not $startupComplete) {
        try { Stop-OwnedStartupProcess }
        catch { $failureMessage += " Startup cleanup is uncertain: $($_.Exception.Message)" }
    }
    if ($NoBrowser) { throw $failureMessage }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($failureMessage, 'Freelancer', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
