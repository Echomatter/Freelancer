<# Quota telemetry refresh. Writes only runtime .state/quota-state.json.
Preserves last-known-good observations separately from failed refresh attempts.
Telemetry authentication failure does not establish execution failure.
Windows PowerShell 5.1. Never logs credential material. #>
param(
    [string]$ToolkitRoot = '',
    [string]$BlockSurface = '',
    [string]$BlockReason = '',
    [string]$BlockResetAt = '',
    [int]$BlockRecheckMinutes = 15,
    [string]$AuthPath = ''
)
$ErrorActionPreference = 'Stop'
if ($ToolkitRoot -eq '') { $ToolkitRoot = Split-Path -Parent $PSScriptRoot }
$StatePath = Join-Path $ToolkitRoot '.state\quota-state.json'
$stateDir = Split-Path -Parent $StatePath
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$lock = $null
try { $lock = New-Object System.IO.FileStream(($StatePath + '.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose) }
catch { Write-Output 'Quota refresh already active; using existing observations.'; return }
try {
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $tmp = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [System.IO.File]::WriteAllText($tmp, $Text, $enc)
        if (Test-Path -LiteralPath $Path) { [System.IO.File]::Replace($tmp, $Path, [NullString]::Value) }
        else { [System.IO.File]::Move($tmp, $Path) }
    } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
}
function Now-UtcIso() { return (Get-Date).ToUniversalTime().ToString('o') }
$prior = $null
try {
    if (Test-Path -LiteralPath $StatePath) { $prior = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json }
} catch { throw 'Quota state is malformed; original preserved. Repair it rather than discarding known execution failures.' }
function Get-PriorSurface([string]$name) {
    if ($prior -and $prior.surfaces) {
        foreach ($p in @($prior.surfaces.PSObject.Properties)) { if ($p.Name -eq $name) { return $p.Value } }
    }
    return $null
}
function Get-PriorExecution([string]$name) {
    $s = Get-PriorSurface $name
    if ($s -and $s.execution) { return $s.execution }
    return $null
}
# Record confirmed execution failures before any unrelated network request.
if ($BlockSurface) {
    if ($BlockSurface -notin @('opencode-go','openai-oauth','github-copilot-oauth','opencode-free')) { throw 'Unknown execution surface.' }
    if (-not $prior) { $prior = [pscustomobject]@{ generated=$true; generated_at=(Now-UtcIso); surfaces=[pscustomobject]@{} } }
    if (-not $prior.surfaces) { $prior | Add-Member -NotePropertyName surfaces -NotePropertyValue ([pscustomobject]@{}) -Force }
    $s = Get-PriorSurface $BlockSurface
    if (-not $s) { $s = [pscustomobject]@{}; $prior.surfaces | Add-Member -NotePropertyName $BlockSurface -NotePropertyValue $s -Force }
    $s | Add-Member -NotePropertyName execution -NotePropertyValue ([ordered]@{
        blocked=$true; reason=$BlockReason; reset_at=$BlockResetAt;
        recorded_at=(Now-UtcIso); recheck_at=(Get-Date).ToUniversalTime().AddMinutes($BlockRecheckMinutes).ToString('o')
    }) -Force
    Write-Utf8NoBom $StatePath ($prior | ConvertTo-Json -Depth 10)
    Write-Output "Recorded execution block: $BlockSurface"
    return
}
if (-not $AuthPath) {
    $dataRoot = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:USERPROFILE '.local\share' }
    $AuthPath = Join-Path $dataRoot 'opencode\auth.json'
}
$auth = $null
try {
    if (Test-Path -LiteralPath $authPath) { $auth = Get-Content -LiteralPath $authPath -Raw -Encoding UTF8 | ConvertFrom-Json }
} catch { $auth = $null }
function Invoke-QuotaGet([string]$Url, [hashtable]$Headers, [int]$TimeoutSec = 3) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        return @{ ok = $true; status = [int]$resp.StatusCode; body = [string]$resp.Content }
    } catch {
        $code = 0; $body = ''
        try {
            if ($_.Exception.Response) {
                $code = [int]$_.Exception.Response.StatusCode.value__
                $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $sr.ReadToEnd(); $sr.Close()
            }
        } catch {}
        return @{ ok = $false; status = $code; body = $body }
    }
}
$now = Now-UtcIso
$surfaces = [ordered]@{}

$goTelemetry = [ordered]@{ status = 'unavailable'; source = 'go-usage-api'; as_of = $now; note = '' }
$goWindows = $null
$goKeyPresent = ($auth -and $auth.'opencode-go' -and $auth.'opencode-go'.key)
if ($goKeyPresent) {
    $goHeaders = @{ Authorization = ("Bearer " + [string]$auth.'opencode-go'.key); 'User-Agent' = 'freelancer-refresh-quota' }
    $r = Invoke-QuotaGet 'https://opencode.ai/zen/go/v1/usage' $goHeaders
    if ($r.ok) {
        try {
            $u = ($r.body | ConvertFrom-Json).usage
            if (-not $u) { throw 'missing usage' }
            $goWindows = [ordered]@{}
            foreach ($w in @('rolling', 'weekly', 'monthly')) {
                $wu = $u.$w
                if (-not $wu -or $null -eq $wu.percent -or -not $wu.status -or -not $wu.resetsAt) { throw 'missing Go window fields' }
                if ([double]$wu.percent -lt 0 -or [double]::IsNaN([double]$wu.percent) -or [double]::IsInfinity([double]$wu.percent)) { throw 'invalid percentage' }
                $goWindows[$w] = [ordered]@{ status = [string]$wu.status; used_percent = [double]$wu.percent; resets_at = [string]$wu.resetsAt }
            }
            $goTelemetry.status = 'ok'
        } catch { $goTelemetry.status = 'unparseable'; $goTelemetry.note = 'response did not match expected shape' }
    } elseif ($r.status -eq 401) {
        $goTelemetry.status = 'auth-failed'
        $goTelemetry.note = 'usage endpoint rejected the stored key (telemetry only; execution availability unchanged)'
    } elseif ($r.status -eq 403 -and $r.body -match 'EntitlementError') {
        $goTelemetry.status = 'no-plan'
        $goTelemetry.note = 'server reports no active Go plan for this key'
    } else { $goTelemetry.status = 'unreachable'; $goTelemetry.note = ("http status " + $r.status) }
} else { $goTelemetry.status = 'no-credential'; $goTelemetry.note = 'no opencode-go key in auth.json' }
$surfaces['opencode-go'] = [ordered]@{ quota_type = 'subscription'; telemetry = $goTelemetry; windows = $goWindows; execution = (Get-PriorExecution 'opencode-go') }

$cpTelemetry = [ordered]@{ status = 'unavailable'; source = 'github-copilot-internal-api'; as_of = $now; note = '' }
$cpBuckets = $null; $cpReset = ''
$cpTokenPresent = ($auth -and $auth.'github-copilot' -and $auth.'github-copilot'.access)
if ($cpTokenPresent) {
    $cpHeaders = @{ Authorization = ("token " + [string]$auth.'github-copilot'.access); 'User-Agent' = 'freelancer-refresh-quota' }
    $r = Invoke-QuotaGet 'https://api.github.com/copilot_internal/user' $cpHeaders
    if ($r.ok) {
        try {
            $cu = ($r.body | ConvertFrom-Json)
            $cpReset = [string]$cu.quota_reset_date_utc
            if (-not $cu.quota_snapshots) { throw 'missing quota snapshots' }
            $cpBuckets = [ordered]@{}
            foreach ($b in @($cu.quota_snapshots.PSObject.Properties)) {
                $v = $b.Value
                if ($v.unlimited -ne $true -and $null -eq $v.percent_remaining) { throw 'missing remaining capacity' }
                $cpBuckets[$b.Name] = [ordered]@{
                    unlimited = [bool]$v.unlimited
                    percent_remaining = if ($null -eq $v.percent_remaining) { $null } else { [double]$v.percent_remaining }
                    quota_remaining = $v.quota_remaining
                    credits_used = $v.credits_used
                    entitlement = $v.entitlement
                    overage_permitted = [bool]$v.overage_permitted
                }
            }
            $cpTelemetry.status = 'ok'
        } catch { $cpTelemetry.status = 'unparseable'; $cpTelemetry.note = 'response did not match expected shape' }
    } elseif ($r.status -eq 401 -or $r.status -eq 403) {
        $cpTelemetry.status = 'auth-failed'; $cpTelemetry.note = 'token rejected for quota lookup (telemetry only)'
    } else { $cpTelemetry.status = 'unreachable'; $cpTelemetry.note = ("http status " + $r.status) }
} else { $cpTelemetry.status = 'no-credential'; $cpTelemetry.note = 'no github-copilot token in auth.json' }
$surfaces['github-copilot-oauth'] = [ordered]@{ quota_type = 'subscription'; telemetry = $cpTelemetry; buckets = $cpBuckets; reset_at = $cpReset; execution = (Get-PriorExecution 'github-copilot-oauth') }

$aiTelemetry = [ordered]@{ status = 'unavailable'; source = 'chatgpt-wham-usage'; as_of = $now; note = '' }
$aiWindows = $null; $aiAllowed = $null; $aiLimitReached = $null
$aiTokenPresent = ($auth -and $auth.openai -and $auth.openai.access)
if ($aiTokenPresent) {
    $aiHeaders = @{
        Authorization = ("Bearer " + [string]$auth.openai.access)
        'ChatGPT-Account-Id' = [string]$auth.openai.accountId
        Accept = 'application/json'; Origin = 'https://chatgpt.com'; Referer = 'https://chatgpt.com/'; 'User-Agent' = 'Mozilla/5.0'
    }
    $r = Invoke-QuotaGet 'https://chatgpt.com/backend-api/wham/usage' $aiHeaders
    if ($r.ok) {
        try {
            $wu = ($r.body | ConvertFrom-Json)
            if (-not $wu.rate_limit) { throw 'missing coding rate limit' }
            $aiAllowed = $wu.rate_limit.allowed
            $aiLimitReached = $wu.rate_limit.limit_reached
            $aiWindows = [ordered]@{ plan_type = [string]$wu.plan_type }
            if ($wu.rate_limit.primary_window) {
                $pw = $wu.rate_limit.primary_window
                if ($null -eq $pw.used_percent -or -not $pw.limit_window_seconds -or -not $pw.reset_at) { throw 'invalid primary window' }
                $aiWindows['primary'] = [ordered]@{ used_percent = [double]$pw.used_percent; window_seconds = [int]$pw.limit_window_seconds; reset_at_unix = [long]$pw.reset_at }
            }
            if ($wu.rate_limit.secondary_window) {
                $sw = $wu.rate_limit.secondary_window
                if ($null -eq $sw.used_percent -or -not $sw.limit_window_seconds -or -not $sw.reset_at) { throw 'invalid secondary window' }
                $aiWindows['secondary'] = [ordered]@{ used_percent = [double]$sw.used_percent; window_seconds = [int]$sw.limit_window_seconds; reset_at_unix = [long]$sw.reset_at }
            }
            $aiTelemetry.status = 'ok'
        } catch { $aiTelemetry.status = 'unparseable'; $aiTelemetry.note = 'response did not match expected shape' }
    } elseif ($r.status -eq 401 -or $r.status -eq 403) {
        $aiTelemetry.status = 'auth-failed'; $aiTelemetry.note = 'stored ChatGPT token rejected by usage surface (telemetry only)'
    } else { $aiTelemetry.status = 'unreachable'; $aiTelemetry.note = ("http status " + $r.status) }
} else { $aiTelemetry.status = 'no-credential'; $aiTelemetry.note = 'no openai token in auth.json' }
$surfaces['openai-oauth'] = [ordered]@{ quota_type = 'subscription'; telemetry = $aiTelemetry; windows = $aiWindows; allowed = $aiAllowed; limit_reached = $aiLimitReached; execution = (Get-PriorExecution 'openai-oauth') }
$surfaces['opencode-free'] = [ordered]@{
    quota_type = 'free-hosted'
    telemetry = [ordered]@{ status = 'not-applicable'; source = 'none'; as_of = $now; note = 'free tier exposes no quota surface; availability is not assumed' }
    execution = (Get-PriorExecution 'opencode-free')
}
# Failed refresh never changes a dated good observation into a fabricated balance.
foreach ($sn in @($surfaces.Keys)) {
    $current = $surfaces[$sn]; $old = Get-PriorSurface $sn
    if ($current.telemetry.status -ne 'ok' -and $old -and $old.telemetry.status -eq 'ok') {
        $failedStatus = $current.telemetry.status
        foreach ($field in @('windows','buckets','reset_at','allowed','limit_reached')) {
            if ($old.PSObject.Properties.Name -contains $field) { $current[$field] = $old.$field }
        }
        $current.telemetry = [ordered]@{
            status='ok'; source=[string]$old.telemetry.source; as_of=[string]$old.telemetry.as_of;
            cached=$true; last_attempt_at=$now; last_attempt_status=$failedStatus
        }
    }
}
$state = [ordered]@{ generated = $true; generated_at = $now; surfaces = $surfaces }
Write-Utf8NoBom $StatePath ($state | ConvertTo-Json -Depth 8)
Write-Output "Wrote quota state: $StatePath"
foreach ($sn in @($surfaces.Keys)) { Write-Output ("  surface=$sn telemetry=" + $surfaces[$sn].telemetry.status) }
} finally { if ($lock) { $lock.Dispose() } }
