<# Deterministic evidence-aware model selector (no web calls, no new architecture).
Reads routing/policy.json, routing/model-roster.json, routing/model-evidence.json,
.state/task-history.json (with a portable seed fallback) and scores every eligible model for the given task.
Lane membership is used only as a deterministic tie-breaker, never as evidence.
Windows PowerShell 5.1 compatible. All file reads use UTF8 to preserve encoding.
#>
param(
    [string]$ToolkitRoot = '',
    [string]$ExcludedModels = '',
    [string]$SelectedModel = '',
    [string]$RuntimeModels = '',
    $HostAssessment = $false,
    [string]$DiversityModels = '',
    [string[]]$TaskType = @('bounded_feature'),
    $NeedsWrites = $false,
    $NeedsTerminal = $false,
    $NeedsWeb = $false,
    [int]$NeedsLargeContextTokens = 0,
    $NeedsDeepReasoning = $false,
    $NeedsModelDiversity = $false,
    $HighConsequence = $false,
    [string]$CurrentModel = '',
    [string]$ExcludeModel = '',
    [string]$LaneHint = '',
    [ValidateSet('', 'build', 'plan', 'explore', 'review')][string]$WorkMode = '',
    [string]$PreferredCostClass = '',
    [ValidateSet('', 'free-only', 'prefer-free', 'balanced', 'any', 'paid-only')][string]$CostPreference = '',
    $FreeOnly = $false,
    [ValidateSet('bounded','specialist')][string]$ReviewMode = 'bounded',
    [int]$ExpectedInputTokens = 0,
    [int]$ExpectedOutputTokens = 0,
    [int]$ExpectedCacheReadTokens = 0,
    [string]$QuotaStatePath = '',
    [double]$QuotaStalenessMinutes = 30
)
$ErrorActionPreference = 'Stop'
if (-not $ToolkitRoot) { $ToolkitRoot = Split-Path -Parent $PSScriptRoot }

function To-Bool($v) {
    if ($v -is [bool]) { return $v }
    if ($null -eq $v) { return $false }
    $s = "$v".Trim().ToLower()
    if ($s -in @('1','true','yes','$true','-true')) { return $true }
    return $false
}
$bNeedsWrites = To-Bool $NeedsWrites
$bNeedsTerminal = To-Bool $NeedsTerminal
$bNeedsWeb = To-Bool $NeedsWeb
$bNeedsDeep = To-Bool $NeedsDeepReasoning
$bNeedsDiversity = To-Bool $NeedsModelDiversity
$bHighConseq = To-Bool $HighConsequence
if ($null -ne $FreeOnly -and "$FreeOnly".Trim().ToLower() -notin @('','0','1','false','true','no','yes','$false','$true','-false','-true')) {
    throw 'FreeOnly must be true or false; an invalid spending constraint cannot be ignored.'
}
$bFreeOnly = To-Bool $FreeOnly
$bHostAssessment = To-Bool $HostAssessment
$modeNorm = ("$WorkMode").Trim().ToLower()
$prefCost = ("$PreferredCostClass").Trim().ToLower()
$costPreference = if ($CostPreference) { $CostPreference } elseif ($prefCost -eq 'free') { 'prefer-free' } else { 'balanced' }

# Normalize task types: accept comma-separated single string as well.
$tasks = @()
foreach ($t in @($TaskType)) {
    if ($null -eq $t) { continue }
    foreach ($part in ("$t".Split(','))) {
        $p = $part.Trim().ToLower() -replace '[\s-]+','_'
        if ($p -ne '') { $tasks += $p }
    }
}
if ($tasks.Count -eq 0) { $tasks = @('bounded_feature') }
$tasks = @($tasks | Sort-Object -Unique)

function Rating-Score([string]$r) {
    switch ($r) {
        'strong' { return 4.0 }
        'good' { return 3.0 }
        'adequate' { return 2.0 }
        'weak' { return 0.0 }
        default { return 0.0 }
    }
}
function Confidence-Mult($c) {
    if ($c -eq 'high') { return 1.0 }
    if ($c -eq 'medium') { return 0.8 }
    return 0.6
}
function Surface-Access([string]$surface) {
    switch ($surface) {
        'opencode-free' { return 'free' }
        'opencode-go' { return 'OpenCode Go subscription' }
        'openai-oauth' { return 'ChatGPT OAuth' }
        'github-copilot-oauth' { return 'Copilot OAuth' }
        default { return $surface }
    }
}

$policyPath = Join-Path $ToolkitRoot 'routing\policy.json'
$rosterPath = Join-Path $ToolkitRoot 'routing\model-roster.json'
$evidencePath = Join-Path $ToolkitRoot 'routing\model-evidence.json'
$historyPath = Join-Path $ToolkitRoot 'routing\task-history.json'
$localHistoryPath = Join-Path $ToolkitRoot '.state\task-history.json'
if (Test-Path -LiteralPath $localHistoryPath) { $historyPath = $localHistoryPath }

# These are authoritative selector inputs, not retired per-session role state.
$policy = Get-Content -LiteralPath $policyPath -Raw -Encoding UTF8 | ConvertFrom-Json
$roster = Get-Content -LiteralPath $rosterPath -Raw -Encoding UTF8 | ConvertFrom-Json
$ev = Get-Content -LiteralPath $evidencePath -Raw -Encoding UTF8 | ConvertFrom-Json

$historyEntries = @()
try {
    $h = Get-Content -LiteralPath $historyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($h.entries) { $historyEntries = @($h.entries) }
} catch { $historyEntries = @() }

# Runtime quota observations are independently dated; a failed provider does not
# inherit another provider's freshness. Execution blocks remain separate.
if ($QuotaStatePath -eq '') { $QuotaStatePath = Join-Path $ToolkitRoot '.state\quota-state.json' }
$quotaState = $null
try { if (Test-Path -LiteralPath $QuotaStatePath) { $quotaState = Get-Content -LiteralPath $QuotaStatePath -Raw -Encoding UTF8 | ConvertFrom-Json } } catch {}
function Test-SurfaceFresh($s) {
    if (-not $s -or -not $s.telemetry -or $s.telemetry.status -ne 'ok' -or -not $s.telemetry.as_of) { return $false }
    try {
        $age = ((Get-Date).ToUniversalTime() - ([DateTime]$s.telemetry.as_of).ToUniversalTime()).TotalMinutes
        return ($age -ge 0 -and $age -le $QuotaStalenessMinutes)
    } catch { return $false }
}
$quotaFresh = $false
if ($quotaState -and $quotaState.surfaces) {
    foreach ($q in $quotaState.surfaces.PSObject.Properties) { if (Test-SurfaceFresh $q.Value) { $quotaFresh = $true } }
}
# Static public Go pricing reference (committed; NOT account data).
$goPricing = $null
try {
    $pricingPath = Join-Path $ToolkitRoot 'routing\go-pricing.json'
    if (Test-Path -LiteralPath $pricingPath) {
        $goPricing = Get-Content -LiteralPath $pricingPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
} catch { $goPricing = $null }
function Get-GoPrice([string]$ModelId) {
    if (-not $goPricing -or -not $goPricing.models) { return $null }
    foreach ($p in @($goPricing.models.PSObject.Properties)) {
        if ($p.Name -eq $ModelId) { return $p.Value }
    }
    return $null
}
# Static public Copilot rate reference (committed; NOT account data).
$copilotPricing = $null
try {
    $cpPricingPath = Join-Path $ToolkitRoot 'routing\copilot-pricing.json'
    if (Test-Path -LiteralPath $cpPricingPath) {
        $copilotPricing = Get-Content -LiteralPath $cpPricingPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
} catch { $copilotPricing = $null }
function Get-CopilotPrice([string]$ModelId) {
    if (-not $copilotPricing -or -not $copilotPricing.models) { return $null }
    foreach ($p in @($copilotPricing.models.PSObject.Properties)) {
        if ($p.Name -eq $ModelId) { return $p.Value }
    }
    return $null
}
function Get-QuotaSurface([string]$SurfaceName) {
    if (-not $quotaState -or -not $quotaState.surfaces) { return $null }
    foreach ($p in @($quotaState.surfaces.PSObject.Properties)) {
        if ($p.Name -eq $SurfaceName) { return $p.Value }
    }
    return $null
}
function Get-GoWindow([string]$WindowName) {
    $s = Get-QuotaSurface 'opencode-go'
    if (-not (Test-SurfaceFresh $s) -or -not $s.windows) { return $null }
    foreach ($p in @($s.windows.PSObject.Properties)) {
        if ($p.Name -eq $WindowName) { return $p.Value }
    }
    return $null
}
# Window capacity shares of the monthly limit (Go docs: 5h=20%, weekly=50%).
function Get-WindowShare([string]$WindowName) {
    if (-not $goPricing) { return $null }
    if ($WindowName -eq 'rolling') { return [double]$goPricing.window_shares.rolling }
    if ($WindowName -eq 'weekly') { return [double]$goPricing.window_shares.weekly }
    if ($WindowName -eq 'monthly') { return [double]$goPricing.window_shares.monthly }
    return $null
}

# Combined policy order for deterministic tie-breaking (deep + review + routine, unique).
$combinedPriority = @()
foreach ($listName in @('deep_priority','review_priority','routine_priority')) {
    $lst = @($policy.$listName)
    foreach ($id in $lst) {
        if ($id -and ($combinedPriority -notcontains $id)) { $combinedPriority += $id }
    }
}
function Priority-Index([string]$id) {
    $i = [Array]::IndexOf($combinedPriority, $id)
    if ($i -lt 0) { return 10000 }
    return $i
}

# Freshness from evidence_as_of (date string) vs UTC today. Never use roster.generated_at.
$freshness = 'UNPOPULATED'
$evidenceAgeDays = $null
$readiness = 'UNPOPULATED'
if ($ev.advisor_readiness) { $readiness = [string]$ev.advisor_readiness }
try {
    if ($ev.evidence_as_of -and ("$($ev.evidence_as_of)".Trim() -ne '')) {
        $asOf = [DateTime]"$($ev.evidence_as_of)"
        $today = (Get-Date).ToUniversalTime().Date
        $evidenceAgeDays = ($today - $asOf.Date).Days
        if ($evidenceAgeDays -le 1) { $freshness = 'current' }
        elseif ($evidenceAgeDays -le 3) { $freshness = 'partially stale' }
        elseif ($evidenceAgeDays -le 7) { $freshness = 'stale' }
        else { $freshness = 'very stale' }
    }
} catch { $freshness = 'UNPOPULATED' }

# Build capability weights for this task. long_context is a filter + small bonus,
# not a dominant averaged capability, so large-context models do not auto-win reviews.
# code_review weight dominates review tasks so review specialists beat long-context generalists.
$weights = @{}
function Add-W([string]$k, [double]$w) {
    if (-not $weights.ContainsKey($k)) { $weights[$k] = 0.0 }
    $weights[$k] = [double]$weights[$k] + $w
}
foreach ($t in $tasks) {
    switch ($t) {
        'code_review' { Add-W 'code_review' 5.0; Add-W 'coding' 1.0; Add-W 'repo_understanding' 0.5 }
        'independent_verification' { Add-W 'code_review' 3.0; Add-W 'architecture' 0.5; Add-W 'coding' 0.5 }
        'debugging' { Add-W 'debugging' 3.0; Add-W 'terminal_agent_work' 1.0; Add-W 'tool_use' 1.0 }
        'terminal_heavy' { Add-W 'terminal_agent_work' 3.0; Add-W 'tool_use' 1.0 }
        'architecture' { Add-W 'architecture' 3.0; Add-W 'long_horizon_engineering' 2.0; Add-W 'repo_understanding' 1.0; Add-W 'agentic_work' 1.0 }
        'large_refactor' { Add-W 'long_horizon_engineering' 2.0; Add-W 'architecture' 2.0; Add-W 'repo_understanding' 1.0; Add-W 'agentic_work' 1.0 }
        'repo_navigation' { Add-W 'repo_understanding' 2.0; Add-W 'repo_navigation' 2.0 }
        'repo_orientation' { Add-W 'coding' 2.0; Add-W 'tool_use' 2.0 }
        'long_context_reading' { Add-W 'long_context' 0.5; Add-W 'repo_understanding' 0.5 }
        'bounded_feature' { Add-W 'routine_coding' 2.0; Add-W 'coding' 2.0; Add-W 'tool_use' 1.0 }
        'simple_edit' { Add-W 'routine_coding' 2.0; Add-W 'coding' 2.0; Add-W 'tool_use' 1.0; Add-W 'speed' 1.0 }
        'test_generation' { Add-W 'coding' 2.0; Add-W 'routine_coding' 1.0; Add-W 'repo_understanding' 1.0 }
        'documentation' { Add-W 'coding' 1.0; Add-W 'routine_coding' 1.0; Add-W 'research' 1.0 }
        'research' { Add-W 'research' 3.0; Add-W 'tool_use' 1.0 }
        'ml' { Add-W 'deep_reasoning' 2.0; Add-W 'debugging' 1.0; Add-W 'long_horizon_engineering' 1.0 }
        'dsp' { Add-W 'deep_reasoning' 2.0; Add-W 'debugging' 1.0; Add-W 'long_horizon_engineering' 1.0 }
        'firmware' { Add-W 'deep_reasoning' 2.0; Add-W 'debugging' 1.0; Add-W 'long_horizon_engineering' 1.0 }
        'reverse_engineering' { Add-W 'deep_reasoning' 2.0; Add-W 'repo_understanding' 1.0; Add-W 'debugging' 1.0 }
        default { Add-W 'coding' 1.0; Add-W 'tool_use' 1.0 }
    }
}
if ($bNeedsTerminal) { Add-W 'terminal_agent_work' 2.0; Add-W 'tool_use' 1.0 }
if ($bNeedsDeep) { Add-W 'long_horizon_engineering' 2.0; Add-W 'deep_reasoning' 2.0; Add-W 'debugging' 1.0; Add-W 'architecture' 1.0; Add-W 'agentic_work' 1.0 }
if ($bNeedsWeb) { Add-W 'research' 1.0; Add-W 'tool_use' 1.0 }
if ($bHighConseq) { Add-W 'debugging' 1.0; Add-W 'architecture' 1.0 }
if ($NeedsLargeContextTokens -gt 0) { Add-W 'long_context' 0.5 }
# Assignment mode influences weights without replacing task types.
# Task/workflow semantics drive qualification; agent names never select a model.
# Review adds verification weights; Explore adds light retrieval weights.
if ($modeNorm -eq 'review') {
    if (($tasks -notcontains 'code_review') -and ($tasks -notcontains 'independent_verification')) {
        Add-W 'code_review' 3.0; Add-W 'coding' 0.5
    }
} elseif ($modeNorm -eq 'explore') {
    if ($tasks -notcontains 'repo_orientation') { Add-W 'research' 1.0; Add-W 'repo_understanding' 1.0 }
}

# Trivial-task detection: inexpensive default must win without research.
$nonTrivialTypes = @('architecture','large_refactor','debugging','terminal_heavy','ml','dsp','firmware','reverse_engineering','code_review','independent_verification','long_context_reading')
$isTrivial = $true
foreach ($t in $tasks) { if ($nonTrivialTypes -contains $t) { $isTrivial = $false; break } }
if ($bNeedsDeep -or $bNeedsTerminal -or ($NeedsLargeContextTokens -gt 0) -or $bHighConseq -or $bNeedsWrites) {
    # needs_writes alone does not make a simple edit non-trivial, but combined with
    # review/debugging/terminal/deep reasoning it does. Keep simple writes trivial.
    $hardTasks = @('architecture','large_refactor','debugging','terminal_heavy','code_review','independent_verification','ml','dsp','firmware','reverse_engineering','long_context_reading')
    $hasHard = $false
    foreach ($t in $tasks) { if ($hardTasks -contains $t) { $hasHard = $true; break } }
    if ($hasHard -or $bNeedsDeep -or $bNeedsTerminal -or ($NeedsLargeContextTokens -gt 0) -or $bHighConseq) { $isTrivial = $false }
}
$isConsequential = ($bNeedsDeep -or $bHighConseq -or ($NeedsLargeContextTokens -ge 200000) -or ($tasks -contains 'architecture') -or ($tasks -contains 'large_refactor') -or (($tasks -contains 'debugging') -and ($tasks -contains 'terminal_heavy')))

# A bounded second opinion requires coding evidence, not an unpopulated review
# benchmark field. Keep specialist and consequential review requirements strict.
# This is a task qualification policy, never invented code_review evidence.
$reviewBasis = $null
if ($modeNorm -eq 'review') {
    $reviewBasis = 'specialist_review_evidence'
    if ($ReviewMode -eq 'bounded' -and -not $isConsequential) {
        $weights.Remove('code_review')
        Add-W 'coding' 3.0
        $reviewBasis = 'bounded_coding_evidence'
    }
}

$goIdentity = $null
try { $goIdentity = Get-Content -LiteralPath (Join-Path $ToolkitRoot 'routing\go-identity-map.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
function Get-Canonical-Key($Evidence, [string]$RosterId) {
    if ($goIdentity -and $goIdentity.mappings) {
        foreach ($m in $goIdentity.mappings.PSObject.Properties) {
            if ($m.Name -eq $RosterId -and $m.Value.underlying -and $Evidence.models.PSObject.Properties.Name -contains $m.Value.underlying) {
                return [string]$m.Value.underlying
            }
        }
    }
    if (-not $Evidence.alias_index) { return $null }
    foreach ($p in @($Evidence.alias_index.PSObject.Properties)) {
        if ($p.Name -eq $RosterId) { return [string]$p.Value }
    }
    return $null
}
function Get-Canonical-Entry($Evidence, [string]$CanonKey) {
    if (-not $CanonKey) { return $null }
    foreach ($p in @($Evidence.models.PSObject.Properties)) {
        if ($p.Name -eq $CanonKey) { return $p.Value }
    }
    return $null
}
function Get-Capability($entry, [string]$key) {
    if (-not $entry -or -not $entry.capabilities) { return $null }
    foreach ($p in @($entry.capabilities.PSObject.Properties)) {
        if ($p.Name -eq $key) { return $p.Value }
    }
    # Completed research sometimes records a narrower/adjacent capability.
    # Expose a conservative inference with its provenance, not a missing slot
    # or an invented directly measured benchmark. Explicit unknown/weak wins.
    $supportingKeys = @()
    if ($key -eq 'tool_use') { $supportingKeys = @('terminal_agent_work','agentic_work') }
    if ($key -eq 'coding' -and -not $isConsequential -and $ReviewMode -ne 'specialist') { $supportingKeys = @('routine_coding') }
    foreach ($supportingKey in $supportingKeys) {
        $support = $entry.capabilities.$supportingKey
        if ($support.rating -in @('adequate','good','strong') -and $support.evidence) {
            $inferredConfidence = if ($support.confidence -eq 'high') { 'medium' } else { $support.confidence }
            return [pscustomobject]@{ rating='adequate'; confidence=$inferredConfidence; evidence=@($support.evidence)
                inferred_from=$supportingKey; note="Conservative task-fit inference from recorded $supportingKey evidence; not a separate measured $key benchmark." }
        }
    }
    $fallback = @{
        routine_coding = 'coding'
        agentic_work = 'long_horizon_engineering'
        repo_navigation = 'repo_understanding'
        deep_reasoning = 'long_horizon_engineering'
    }
    if ($fallback.ContainsKey($key)) {
        $alt = [string]$fallback[$key]
        foreach ($p in @($entry.capabilities.PSObject.Properties)) {
            if ($p.Name -eq $alt) { return $p.Value }
        }
    }
    return $null
}
function Get-ModelProvider($entry, [string]$id) {
    if ($entry -and $entry.provider) { return ([string]$entry.provider).Trim().ToLower() }
    if ($id -match '^([^/]+)/') { return $Matches[1].ToLower() }
    return ''
}
function Get-ExecutionSurface([string]$ModelId, [string]$Purpose) {
    if ($modeNorm) { return 'delegate' }
    if ($CurrentModel -and $ModelId -eq $CurrentModel) { return 'build' }
    return '/models switch'
}

$excludeCanonical = $null
$excludeProvider = ''
$diversityReferenceModel = $ExcludeModel
if ($bNeedsDiversity -and -not $diversityReferenceModel -and $CurrentModel) {
    $diversityReferenceModel = $CurrentModel
}
if ($diversityReferenceModel -ne '') {
    $excludeCanonical = Get-Canonical-Key $ev $diversityReferenceModel
    $excludeEntry = Get-Canonical-Entry $ev $excludeCanonical
    $excludeProvider = Get-ModelProvider $excludeEntry $diversityReferenceModel
}

$routeModels = @($roster.eligible_models)
# A current Freelancer request captures the native connected model inventory.
# The researched roster can lag behind it; add only captured, provider-qualified
# subscription/free routes. Evidence remains unknown until researched.
if ($RuntimeModels) {
    $runtimeIds = @($RuntimeModels.Split(',') | Where-Object { $_ -match '^[\w.-]+/[^\s,]+$' } | Sort-Object -Unique)
    $routeModels = @($routeModels | Where-Object { $runtimeIds -contains $_.id })
    $known = @($routeModels | ForEach-Object { $_.id })
    foreach ($id in $runtimeIds) {
        if ($known -contains $id) { continue }
        $provider = $id.Split('/')[0]
        $surface = switch ($provider) {
            'opencode' { 'opencode-free' }
            'opencode-go' { 'opencode-go' }
            'openai' { 'openai-oauth' }
            'github-copilot' { 'github-copilot-oauth' }
            default { '' }
        }
        if ($surface) {
            $routeModels += [pscustomobject]@{ id=$id; surface=$surface; economics='subscription-quota'; observed=[pscustomobject]@{} }
        }
    }
}
$scored = @()
$diversityIds = @($DiversityModels.Split(',') | Where-Object { $_ })
if ($bNeedsDiversity) { $diversityIds += @($CurrentModel, $ExcludeModel) | Where-Object { $_ } }
$diversityCanonicals = @($diversityIds | ForEach-Object { Get-Canonical-Key $ev $_ } | Where-Object { $_ })
$filtered = @()
$appliedBlocks = @()
$quotaNotes = @()
$quotaTelemetryOut = [ordered]@{}
foreach ($sn in @('opencode-go', 'openai-oauth', 'github-copilot-oauth', 'opencode-free')) {
    $qs = Get-QuotaSurface $sn
    if ($qs -and $qs.telemetry) {
        $quotaTelemetryOut[$sn] = [ordered]@{ status = [string]$qs.telemetry.status; source = [string]$qs.telemetry.source; as_of = [string]$qs.telemetry.as_of }
    } else {
        $quotaTelemetryOut[$sn] = [ordered]@{ status = 'unknown'; source = 'none'; as_of = '' }
    }
}

# Execution blocks require confirmed recovery or a known reset, never a failure-count threshold.
function Test-ExecutionBlock($exec) {
    if (-not $exec -or -not $exec.blocked) { return $null }
    $now = (Get-Date).ToUniversalTime()
    if ($exec.reset_at -and ("$($exec.reset_at)".Trim() -ne '')) {
        try {
            $reset = ([DateTime]"$($exec.reset_at)").ToUniversalTime()
            if ($reset -gt $now) {
                return [ordered]@{ active = $true; reason = [string]$exec.reason; reset_at = [string]$exec.reset_at; recheck_at = ''; kind = 'execution-block' }
            }
            return $null
        } catch {}
    }
    return [ordered]@{ active = $true; reason = [string]$exec.reason; reset_at = ''; recheck_at = ''; kind = 'execution-block-unknown-reset' }
}
$execBlockBySurface = @{}
foreach ($sn in @('opencode-go', 'openai-oauth', 'github-copilot-oauth', 'opencode-free')) {
    $qs = Get-QuotaSurface $sn
    if ($qs -and $qs.execution) {
        $b = Test-ExecutionBlock $qs.execution
        if ($b -and $b.active) {
            $execBlockBySurface[$sn] = $b
            $appliedBlocks += [ordered]@{ surface = $sn; reason = $b.reason; reset_at = $b.reset_at; recheck_at = $b.recheck_at; kind = $b.kind }
        } elseif ($b -and -not $b.active) {
            $quotaNotes += ("surface ${sn}: " + $b.reason)
        }
    }
}

# Telemetry-confirmed shared-pool exhaustion (fresh telemetry only).
$goBlockedWindow = $null
if (Test-SurfaceFresh (Get-QuotaSurface 'opencode-go')) {
    foreach ($w in @('rolling', 'weekly', 'monthly')) {
        $wu = Get-GoWindow $w
        if ($wu -and $wu.status -and ([string]$wu.status).ToLower() -in @('rate-limited','rate_limited','limit_reached','exhausted')) {
            $goBlockedWindow = [ordered]@{ window = $w; status = [string]$wu.status; resets_at = [string]$wu.resets_at }
            break
        }
    }
    if ($goBlockedWindow) {
        $appliedBlocks += [ordered]@{ surface = 'opencode-go'; reason = ("go window " + $goBlockedWindow.window + " status=" + $goBlockedWindow.status); reset_at = $goBlockedWindow.resets_at; recheck_at = ''; kind = 'pool-exhausted' }
    }
}
# Copilot agentic work uses the premium bucket. Provider overage permission alone
# never authorizes the toolkit to spend beyond included capacity.
$copilotPremium = $null
$copilotOverage = $false
if (Test-SurfaceFresh (Get-QuotaSurface 'github-copilot-oauth')) {
    $cs = Get-QuotaSurface 'github-copilot-oauth'
    if ($cs -and $cs.buckets -and $cs.buckets.premium_interactions -and $null -ne $cs.buckets.premium_interactions.percent_remaining) {
        $pb = $cs.buckets.premium_interactions
        $premRem = 100.0
        try { $premRem = [double]$pb.percent_remaining } catch {}
        $overPerm = $false
        try { $overPerm = ([bool]$pb.overage_permitted -and $policy.allow_overage -eq $true) } catch {}
        $entVal = 0.0
        try { if ($null -ne $pb.entitlement) { $entVal = [double]$pb.entitlement } } catch {}
        $copilotPremium = [ordered]@{ percent_remaining = $premRem; overage_permitted = $overPerm; reset_at = [string]$cs.reset_at; entitlement = $entVal }
        if ($premRem -le 0 -and -not $overPerm) {
            $appliedBlocks += [ordered]@{ surface = 'github-copilot-oauth'; reason = 'copilot AI-credit pool depleted (premium_interactions) with no permitted overage'; reset_at = [string]$cs.reset_at; recheck_at = ''; kind = 'pool-exhausted' }
        } elseif ($premRem -le 0 -and $overPerm) {
            $copilotOverage = $true
            $quotaNotes += 'copilot premium pool depleted but overage is permitted; allowed with overage flag'
        }
    }
}
# Only relevant ChatGPT windows govern coding availability, not unrelated
# account features. Explicit refusal is authoritative while the observation is fresh.
$openaiBlocked = $false
$os = Get-QuotaSurface 'openai-oauth'
if (Test-SurfaceFresh $os) {
    if ($os.limit_reached -eq $true -or ($null -ne $os.allowed -and $os.allowed -eq $false)) { $openaiBlocked = $true }
    if ($os.windows) {
        foreach ($w in $os.windows.PSObject.Properties) {
            if ($w.Name -in @('primary','secondary') -and $null -ne $w.Value.used_percent -and [double]$w.Value.used_percent -ge 100) { $openaiBlocked = $true }
        }
    }
}
# Execution-side health is durable and scoped. Its files contain no credentials.
$health = @()
$healthDir = Join-Path $ToolkitRoot '.state\delegation\blocks'
if (Test-Path -LiteralPath $healthDir) {
    foreach ($f in Get-ChildItem -LiteralPath $healthDir -File -Filter '*.json') {
        try { $health += (Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { throw 'Execution health state is malformed; repair it rather than bypass a known block.' }
    }
}
$excluded = @($ExcludedModels.Split(',') | Where-Object { $_ })
foreach ($rm in $routeModels) {
    $rid = [string]$rm.id
    $surface = [string]$rm.surface
    $assessmentNotes = @()
    $softEvidence = $bHostAssessment -and -not $isConsequential -and $ReviewMode -ne 'specialist'
    if ($bFreeOnly -and $surface -ne 'opencode-free') {
        $filtered += [pscustomobject]@{ id=$rid; reason='free_only: subscription surfaces excluded' }; continue
    }
    if ($costPreference -eq 'paid-only' -and $surface -eq 'opencode-free') {
        $filtered += [pscustomobject]@{ id=$rid; reason='subscription_only: free surface excluded' }; continue
    }
    if (@($policy.allowed_surfaces) -notcontains $surface -or $excluded -contains $rid) {
        $filtered += [pscustomobject]@{ id=$rid; reason='route excluded by policy or failed attempt' }; continue
    }
    if ($surface -eq 'openai-oauth' -and $openaiBlocked) {
        $filtered += [pscustomobject]@{ id=$rid; reason='ChatGPT coding pool exhausted' }; continue
    }
    $healthBlocked = $false
    foreach ($block in $health) {
        if (($block.scope -eq 'model' -and $block.key -eq $rid) -or ($block.scope -eq 'surface' -and $block.key -eq $surface)) {
            $expired = $false
            if ($block.reason -in @('throttle','provider') -and $block.retry_after) {
                try { $expired = ([DateTime]$block.retry_after).ToUniversalTime() -le (Get-Date).ToUniversalTime() } catch {}
            }
            # A new successful Go observation with all windows usable proves
            # recovery; old/stale/partial telemetry must not erase the block.
            if ($block.reason -eq 'quota' -and $surface -eq 'opencode-go') {
                $gs = Get-QuotaSurface 'opencode-go'
                if ((Test-SurfaceFresh $gs) -and ([DateTime]$gs.telemetry.as_of).ToUniversalTime() -gt ([DateTime]$block.recorded_at).ToUniversalTime()) {
                    $good = 0
                    foreach ($wn in @('rolling','weekly','monthly')) {
                        $gw = Get-GoWindow $wn
                        if ($gw -and $gw.status -eq 'ok' -and $null -ne $gw.used_percent -and [double]$gw.used_percent -lt 100) { $good++ }
                    }
                    if ($good -eq 3) { $expired = $true }
                }
            }
            if (-not $expired) { $healthBlocked = $true }
        }
    }
    if ($healthBlocked) { $filtered += [pscustomobject]@{ id=$rid; reason='confirmed execution health block' }; continue }
    if (($ExcludeModel -ne '' -and $rid -eq $ExcludeModel) -or $diversityIds -contains $rid) {
        $filtered += [pscustomobject]@{ id=$rid; reason='excluded (diversity)' }
        continue
    }
    # Availability first: a blocked surface or an exhausted shared pool never
    # scores. Missing or stale telemetry is unknown, never a block.
    if ($execBlockBySurface.ContainsKey($surface)) {
        $br = $execBlockBySurface[$surface]
        $filtered += [pscustomobject]@{ id=$rid; reason=("execution blocked (" + $br.kind + "): " + $br.reason) }
        continue
    }
    if ($surface -eq 'opencode-go' -and $goBlockedWindow) {
        $filtered += [pscustomobject]@{ id=$rid; reason=("go pool exhausted: window " + $goBlockedWindow.window + " status=" + $goBlockedWindow.status) }
        continue
    }
    if ($surface -eq 'github-copilot-oauth' -and $copilotPremium -and ($copilotPremium.percent_remaining -le 0) -and (-not $copilotPremium.overage_permitted)) {
        $filtered += [pscustomobject]@{ id=$rid; reason='copilot credit pool depleted (premium_interactions), no overage permitted' }
        continue
    }
    $canon = Get-Canonical-Key $ev $rid
    $entry = Get-Canonical-Entry $ev $canon
    if (-not $entry) {
        if (-not $softEvidence) {
            $filtered += [pscustomobject]@{ id=$rid; reason='no canonical evidence entry' }; continue
        }
        $assessmentNotes += 'No canonical evidence entry; capability is unverified.'
    }
    if (($bNeedsDiversity -and $excludeCanonical -and $canon -eq $excludeCanonical) -or ($canon -and $diversityCanonicals -contains $canon)) {
        $filtered += [pscustomobject]@{ id=$rid; reason='excluded: same canonical model as diversity reference' }
        continue
    }
    $provider = Get-ModelProvider $entry $rid
    $diversityAdj = 0.0
    if ($bNeedsDiversity -and $excludeProvider -ne '' -and $provider -eq $excludeProvider) {
        $diversityAdj = -0.5
    }
    # Required context must be known; a missing value is not unlimited context.
    if ($NeedsLargeContextTokens -gt 0 -and (-not $entry.context -or -not $entry.context.input_tokens)) {
        $filtered += [pscustomobject]@{ id=$rid; reason='Required context capability is unknown' }; continue
    }
    # Hard context filter: known insufficient context eliminates.
    if ($NeedsLargeContextTokens -gt 0 -and $entry.context -and $entry.context.input_tokens) {
        try {
            $ctxTokens = [int]$entry.context.input_tokens
            if ($ctxTokens -lt $NeedsLargeContextTokens) {
                $filtered += [pscustomobject]@{ id=$rid; reason=("context $ctxTokens < required $NeedsLargeContextTokens") }
                continue
            }
        } catch { $filtered += [pscustomobject]@{ id=$rid; reason='Required context capability is invalid' }; continue }
    }
    if ($bHostAssessment -or $bNeedsWrites -or $bNeedsTerminal -or $bNeedsWeb) {
        $toolCap = Get-Capability $entry 'tool_use'
        if ($toolCap.rating -eq 'weak' -or $rm.observed.tool_call -eq $false) {
            $filtered += [pscustomobject]@{ id=$rid; reason='Known unsupported or inadequate tool use' }; continue
        }
        if (-not $toolCap -or $toolCap.rating -notin @('adequate','good','strong')) {
            if (-not $softEvidence) {
                $filtered += [pscustomobject]@{ id=$rid; reason='Required tool-use evidence is missing or insufficient' }; continue
            }
            $assessmentNotes += 'Tool-use reliability is not separately measured; assess the recorded profile and validate the bounded result.'
        }
    }
    # A strong average cannot compensate for a missing required capability.
    $required = @($weights.Keys | Where-Object { [double]$weights[$_] -ge 2.0 })
    if ($bNeedsTerminal) { $required += 'terminal_agent_work' }
    if ($bNeedsDeep) { $required += 'deep_reasoning' }
    $missing = @($required | Sort-Object -Unique | Where-Object {
        $cap = Get-Capability $entry $_
        -not $cap -or $cap.rating -notin @('adequate','good','strong') -or
        ($isConsequential -and ($cap.confidence -notin @('medium','high') -or -not $cap.evidence))
    })
    if ($missing.Count) {
        $knownWeak = @($missing | Where-Object { (Get-Capability $entry $_).rating -eq 'weak' })
        if (-not $softEvidence -or $knownWeak.Count) {
            $filtered += [pscustomobject]@{ id=$rid; reason=('Required capability not proven: ' + ($missing -join ', ')) }; continue
        }
        $assessmentNotes += ('Not separately measured in the researched profile: ' + ($missing -join ', '))
    }
    # Weighted capability average.
    $sum = 0.0
    $wsum = 0.0
    $whyParts = @()
    foreach ($k in $weights.Keys) {
        $w = [double]$weights[$k]
        $cap = Get-Capability $entry $k
        $rating = 'unknown'
        $conf = 'low'
        $srcs = @()
        if ($cap -and $cap.rating) { $rating = [string]$cap.rating }
        if ($cap -and $cap.confidence) { $conf = [string]$cap.confidence }
        if ($cap -and $cap.evidence) { $srcs = @($cap.evidence) }
        if ($surface -eq 'opencode-go' -and $canon -notlike 'unresearched:*') {
            if ($conf -eq 'high') { $conf = 'medium' } elseif ($conf -eq 'medium') { $conf = 'low' }
        }
        $contrib = (Rating-Score $rating) * (Confidence-Mult $conf)
        $sum += $contrib * $w
        $wsum += $w
        if ($w -ge 2.0 -and $rating -ne 'unknown') {
            $whyParts += ("$k=$rating/$conf")
        }
    }
    $capAvg = 0.0
    if ($wsum -gt 0) { $capAvg = $sum / $wsum }
    # Capability qualification first: economics may decide among qualified
    # candidates but never promote an unqualified one. Harder tasks require
    # stronger evidence before a cheap candidate qualifies.
    $capFloor = 2.0
    if ($isConsequential) { $capFloor = 2.5 }
    if ($capAvg -lt $capFloor) {
        if (-not $softEvidence) {
            $filtered += [pscustomobject]@{ id=$rid; reason=("capability floor: cap_avg " + ([Math]::Round($capAvg,2)) + " < required " + $capFloor) }; continue
        }
        $assessmentNotes += 'Below the heuristic score floor; host must assess task fit and validation cost.'
    }
    # Conservative synonym fallback is implemented in Get-Capability. Explicit
    # evidence always wins; absent schema keys may borrow only the nearest
    # documented capability and never invent a stronger rating.

    # Benchmark bonus: only same-version Coding Agent Index v1.5 family.
    # Terminal-Bench 2.1 and other legacy versions are excluded from ranking.
    $benchBonus = 0.0
    $benchNotes = @()
    foreach ($b in @($entry.benchmarks)) {
        if (-not $b -or -not $b.benchmark) { continue }
        $bn = [string]$b.benchmark
        if ($bn -match '2\.1') { continue }
        try { $val = [double]$b.value } catch { continue }
        if ($bn -eq 'Coding Agent Index v1.5') { $benchBonus += ($val / 100.0) * 0.4; $benchNotes += ("index $val") }
        elseif ($bn -eq 'DeepSWE v1.1') {
            if ($tasks -contains 'debugging' -or $bNeedsDeep -or ($tasks -contains 'architecture')) { $benchBonus += ($val / 100.0) * 0.3; $benchNotes += ("deepswe $val") }
        }
        elseif ($bn -eq 'Terminal-Bench 4.0') {
            if ($tasks -contains 'terminal_heavy' -or ($tasks -contains 'debugging') -or $bNeedsTerminal) { $benchBonus += ($val / 100.0) * 0.4; $benchNotes += ("tb4 $val") }
        }
        elseif ($bn -eq 'SWE-Atlas-QnA') {
            if ($tasks -contains 'repo_navigation' -or ($tasks -contains 'long_context_reading')) { $benchBonus += ($val / 100.0) * 0.2; $benchNotes += ("atlas $val") }
        }
    }
    if ($benchBonus -gt 0.8) { $benchBonus = 0.8 }

    # Local history: n<3 anecdotal only; n>=3 may influence; n>=10 substantial.
    # Reward validated first-pass success and penalize repeated attempts,
    # escalation, and defects later found by independent review.
    $useSet = @()
    $overlap = @()
    $histN = 0
    $histRate = $null
    $histAdj = 0.0
    $histTestsRate = $null
    $histEscRate = $null
    $histReviewDefectRate = $null
    $histAvgAttempts = $null
    if ($historyEntries.Count -gt 0) {
        $rel = @($historyEntries | Where-Object { $_.model -eq $rid -and $_.synthetic -ne $true -and $_.observation_kind -ne 'operational' -and $_.failure_kind -notin @('quota','provider','binding','auth','timeout') })
        # Related retries/children are one user-task observation per agent/workflow/model,
        # not multiple fabricated first-pass successes. Old rows retain TaskId.
        $rel = @($rel | Group-Object { if ($_.user_task_id) { if ($_.agent_id) { "$($_.user_task_id)/$($_.agent_id)/$($_.workflow_id)" } else { "$($_.user_task_id)/$($_.role)" } } else { $_.task_id } } | ForEach-Object { $_.Group | Sort-Object timestamp -Descending | Select-Object -First 1 })
        # Prefer task-overlapping history when enough samples exist.
        $overlap = @($rel | Where-Object {
            $hit = $false
            foreach ($tt in @($_.task_type)) { if ($tasks -contains ([string]$tt).ToLower()) { $hit = $true; break } }
            $hit
        })
        $useSet = $rel
        if ($overlap.Count -ge 3) { $useSet = $overlap }
        $histN = $useSet.Count
        if ($histN -gt 0) {
            $succ = @($useSet | Where-Object { $_.success -eq $true }).Count
            $histRate = [double]$succ / [double]$histN
            $testsPass = @($useSet | Where-Object { $_.tests_passed -eq $true }).Count
            $escCount = @($useSet | Where-Object { $_.escalated -eq $true }).Count
            $reviewDefects = @($useSet | Where-Object { $_.review_found_defects -eq $true }).Count
            $attemptTotal = 0.0
            foreach ($he in $useSet) {
                try { $attemptTotal += [double]$he.attempts } catch { $attemptTotal += 1.0 }
            }
            $histTestsRate = [double]$testsPass / [double]$histN
            $histEscRate = [double]$escCount / [double]$histN
            $histReviewDefectRate = [double]$reviewDefects / [double]$histN
            $histAvgAttempts = $attemptTotal / [double]$histN
            if ($histN -ge 3) {
                if ($histRate -ge 0.75) { $histAdj += 0.4 }
                elseif ($histRate -ge 0.6) { $histAdj += 0.2 }
                elseif ($histRate -lt 0.4) { $histAdj -= 1.0 }
                elseif ($histRate -lt 0.6) { $histAdj -= 0.35 }

                if ($histTestsRate -ge 0.8 -and $histRate -ge 0.6) { $histAdj += 0.15 }
                elseif ($histTestsRate -lt 0.5) { $histAdj -= 0.2 }

                if ($histAvgAttempts -gt 2.0) { $histAdj -= 0.3 }
                elseif ($histAvgAttempts -le 1.25 -and $histRate -ge 0.75) { $histAdj += 0.1 }

                if ($histEscRate -ge 0.5) { $histAdj -= 0.3 }
                elseif ($histEscRate -eq 0 -and $histRate -ge 0.75) { $histAdj += 0.05 }
                if ($histReviewDefectRate -ge 0.5) { $histAdj -= 0.4 }
                elseif ($histReviewDefectRate -gt 0) { $histAdj -= 0.2 }
                if ($histN -ge 10) { $histAdj = $histAdj * 1.5 }
                if ($histAdj -gt 1.0) { $histAdj = 1.0 }
                if ($histAdj -lt -1.5) { $histAdj = -1.5 }
            }
        }
    }

    if ($overlap -and $overlap.Count -ge 3 -and $histRate -lt 0.4) {
        $filtered += [pscustomobject]@{ id=$rid; reason='validated outcomes are inadequate for this task class' }; continue
    }
    # Task-consumption estimate: explicit caller data, then measured same-task
    # history, then a documented conservative workload prior. No extra LLM call.
    $inputEst = $ExpectedInputTokens; $outputEst = $ExpectedOutputTokens; $cacheEst = $ExpectedCacheReadTokens
    $estimateSource = 'caller'
    if (($inputEst + $outputEst + $cacheEst) -eq 0) {
        $estimateSource = 'workload-prior'
        $inputEst = 12000; $outputEst = 2000; $cacheEst = 0
        if (-not $isTrivial) { $inputEst = 30000; $outputEst = 4000 }
        if ($isConsequential) { $inputEst = 60000; $outputEst = 8000 }
        $measured = @($useSet | Where-Object { $_.consumption -and $_.consumption.source -eq 'session_messages' -and $_.consumption.quality -eq 'measured' -and $_.success -eq $true })
        if ($measured.Count -ge 3) {
            $inputEst = [int](($measured | ForEach-Object { $_.consumption.input_tokens } | Measure-Object -Average).Average)
            $outputEst = [int](($measured | ForEach-Object { $_.consumption.output_tokens } | Measure-Object -Average).Average)
            $cacheEst = [int](($measured | ForEach-Object { $_.consumption.cache_read_tokens } | Measure-Object -Average).Average)
            $estimateSource = 'validated-local-history'
        }
    }
    $estCost = $null; $monthlyFrac = $null; $winPressure = $null
    $quotaEcon = 0.0; $econBase = 0.0; $economicClass = 2; $expense = [double]::PositiveInfinity
    $quotaDetail = 'No comparable normalized expense; unknown is not free.'
    $gp = $null
    if ($surface -eq 'opencode-free') {
        $economicClass = 0; $expense = 0.0; $estCost = 0.0
        $quotaDetail = 'Currently free eligible route; quota failures still exclude it.'
    } elseif ($surface -eq 'opencode-go') {
        $gp = Get-GoPrice $rid
        if ($gp -and $gp.monthly_limit -gt 0 -and $null -ne $gp.input -and $null -ne $gp.output -and $null -ne $gp.cache_read) {
            $estCost = ($inputEst * [double]$gp.input + $outputEst * [double]$gp.output + $cacheEst * [double]$gp.cache_read) / 1000000.0
            $monthlyFrac = $estCost / [double]$gp.monthly_limit
            $economicClass = 0; $expense = $monthlyFrac
            $maxP = 0.0
            foreach ($w in @('rolling','weekly','monthly')) {
                $wu = Get-GoWindow $w; $share = Get-WindowShare $w
                if ($wu -and $null -ne $wu.used_percent -and $share -gt 0) {
                    $remaining = [Math]::Max(0.01, (100.0 - [double]$wu.used_percent) / 100.0)
                    $pressure = ($monthlyFrac / $share) / $remaining
                    if ($pressure -gt $maxP) { $maxP = $pressure }
                }
            }
            $winPressure = $maxP
            $expense = $expense * (1.0 + $maxP)
            $quotaDetail = "Go monthly fraction=$monthlyFrac; max-window pressure=$maxP; estimate=$estimateSource (not a cash charge)."
        }
    } elseif ($surface -eq 'github-copilot-oauth') {
        $cp = Get-CopilotPrice $rid
        if ($cp) {
            $estCost = ($inputEst * [double]$cp.input + $outputEst * [double]$cp.output + $cacheEst * [double]$cp.cache_read) / 1000000.0
            if ($copilotPremium -and $copilotPremium.entitlement -gt 0) {
                $monthlyFrac = $estCost / (0.01 * [double]$copilotPremium.entitlement)
                $economicClass = 0
                $winPressure = $monthlyFrac / [Math]::Max(0.0001, [double]$copilotPremium.percent_remaining / 100.0)
                $expense = $monthlyFrac * (1.0 + $winPressure)
                $quotaDetail = "Copilot fraction=$monthlyFrac; pressure=$winPressure; estimate=$estimateSource."
            }
        }
    }
    # Unknown OpenAI quota mapping is NOT inferred from API prices. The existing
    # table is only a relative proxy when no normalized candidate is available.
    if ($surface -eq 'openai-oauth') {
        try {
            $ap = Get-Content -LiteralPath (Join-Path $ToolkitRoot 'routing\openai-pricing.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $entryPrice = $ap.models.PSObject.Properties | Where-Object { $_.Name -eq $rid } | Select-Object -First 1
            if ($entryPrice) {
                $price = $entryPrice.Value
                $estCost = ($inputEst * [double]$price.input + $outputEst * [double]$price.output + $cacheEst * [double]$price.cache_read) / 1000000.0
                $quotaDetail = "API-rate proxy only; ChatGPT quota mapping unmeasured; estimate=$estimateSource."
            }
        } catch {}
    }
    if ($economicClass -eq 2 -and $null -ne $estCost) { $economicClass = 1; $expense = $estCost }
    # Account for repeated validated failures/retries without converting a
    # provider outage into a model-capability penalty. Quality gates still hold.
    if ($histN -ge 3 -and $null -ne $histRate -and $expense -lt [double]::PositiveInfinity) {
        $expense = $expense / [Math]::Max(0.25, $histRate)
    }
    if ($expense -lt [double]::PositiveInfinity) { $quotaEcon = -$expense }
    $econAdj = $quotaEcon

    $total = $capAvg + $benchBonus + $histAdj + $econAdj + $diversityAdj
    $scored += [pscustomobject]@{
        id = $rid
        assessment_notes = @($assessmentNotes)
        canonical = $canon
        surface = $surface
        access = (Surface-Access $surface)
        cap_avg = [Math]::Round($capAvg, 3)
        bench_bonus = [Math]::Round($benchBonus, 3)
        hist_n = $histN
        hist_rate = $histRate
        hist_adj = [Math]::Round($histAdj, 3)
        hist_tests_rate = $histTestsRate
        hist_escalation_rate = $histEscRate
        hist_review_defect_rate = $histReviewDefectRate
        hist_avg_attempts = $histAvgAttempts
        econ_adj = $econAdj
        economic_class = $economicClass
        expense = $expense
        estimate_source = $estimateSource
        econ_base = $econBase
        quota_econ = [Math]::Round($quotaEcon, 3)
        quota_detail = $quotaDetail
        est_cost_dollars = $estCost
        monthly_fraction = $monthlyFrac
        window_pressure = $winPressure
        diversity_adj = $diversityAdj
        total = [Math]::Round($total, 3)
        priority = (Priority-Index $rid)
        why_caps = ($whyParts -join '; ')
        bench_notes = ($benchNotes -join '; ')
    }
}

if ($scored.Count -eq 0) {
    # Zero candidates is an ordinary no-route result, not a fabricated reviewer.
    $emptyResult = [ordered]@{
        recommended = $null
        top_scored = $null
        access = $null
        why = @('no eligible models survived hard filters')
        execution_surface = $null
        action = $null
        phases = @()
        fallback = $null
        current_lane = $LaneHint
        evidence_freshness = $freshness
        evidence_age_days = $evidenceAgeDays
        evidence_readiness = $readiness
        needs_research = ($isConsequential -and $readiness -ne 'READY')
        research_reason = 'no eligible model; evidence or inventory may be insufficient'
        is_trivial = $isTrivial
        is_consequential = $isConsequential
        stay_put = $false
        filtered_out = @($filtered | ForEach-Object { [ordered]@{ id=$_.id; reason=$_.reason } })
        top_scores = @()
        ranking = @()
        quota_state = [ordered]@{
            fresh = $quotaFresh
            telemetry = $quotaTelemetryOut
            blocks = @($appliedBlocks)
            notes = @($quotaNotes)
            overage = $copilotOverage
        }
        consumption_estimate = [ordered]@{
            provider_cost_proxy_dollars = $null
            monthly_fraction = $null
            window_pressure = $null
            quota_detail = 'no eligible model'
            note = 'Provider price proxy and normalized capacity are distinct; neither is a literal cash saving.'
        }
        selected_model = $null
        free_only = $bFreeOnly
        review_basis = $reviewBasis
        surface = $null
        work_mode = $modeNorm
        adequacy = 'unknown'
        reason_codes = @('no eligible models survived hard filters')
        fallback_model = $null
    }
    $emptyResult | ConvertTo-Json -Depth 6
    return
}
$ranked = if ($costPreference -in @('any', 'paid-only')) {
    @($scored | Sort-Object -Property @{Expression='cap_avg';Descending=$true}, @{Expression='total';Descending=$true}, @{Expression='economic_class';Descending=$false}, @{Expression='expense';Descending=$false}, @{Expression='priority';Descending=$false}, @{Expression='id';Descending=$false})
} elseif ($costPreference -eq 'balanced') {
    @($scored | Sort-Object -Property @{Expression='total';Descending=$true}, @{Expression='economic_class';Descending=$false}, @{Expression='expense';Descending=$false}, @{Expression='priority';Descending=$false}, @{Expression='id';Descending=$false})
} else {
    @($scored | Sort-Object -Property @{Expression='economic_class';Descending=$false}, @{Expression='expense';Descending=$false}, @{Expression='total';Descending=$true}, @{Expression='priority';Descending=$false}, @{Expression='id';Descending=$false})
}

$top = $ranked[0]
$economicReason = if ($costPreference -eq 'paid-only') { 'subscription-only: compare qualified paid routes by task fit' }
    elseif ($costPreference -eq 'any') { 'capability-first: compare qualified task fit before capacity cost' }
    elseif ($costPreference -eq 'balanced') { 'balanced: compare qualified task fit and capacity cost together' }
    elseif ($top.surface -eq 'opencode-free') { 'free-first: an adequate free route wins ordinary bounded work' }
    else { 'escalation: no adequately proven free route survives task requirements and availability checks' }
# Difficult work may justify a documented capability advantage after qualification.
$free = @($ranked | Where-Object { $_.surface -eq 'opencode-free' })
$stronger = @($ranked | Where-Object { $_.surface -ne 'opencode-free' -and $_.cap_avg -ge ($top.cap_avg + 0.75) } | Sort-Object cap_avg -Descending)
if ($isConsequential -and $free.Count -and $top.surface -eq 'opencode-free' -and $stronger.Count -and $costPreference -eq 'prefer-free') {
    $top = $stronger[0]
    $economicReason = 'escalation: consequential task; proven task capability advantage of at least 0.75 over the qualified free route'
    $ranked = @($top) + @($ranked | Where-Object { $_.id -ne $top.id })
}
# A recorded user choice may pick only a still-qualified candidate. It never
# bypasses evidence, free-only, provider, quota, diversity or context filters.
$selectionUnavailable = $false
if ($SelectedModel) {
    $chosen = @($ranked | Where-Object { $_.id -eq $SelectedModel })
    if ($chosen.Count -ne 1) {
        $selectionUnavailable = $true
        $economicReason = 'The chosen model is no longer eligible; request a fresh choice before execution.'
    } else {
        $top = $chosen[0]
        $economicReason = 'explicitly selected alternative; original task and spending constraints preserved'
    }
}
# One bounded child selection. Compound requests are coordinated by customized
# Build, not by silently changing the required assignment or inventing a reviewer.
$fallback = $null
if ($ranked.Count -gt 1) { $fallback = @($ranked | Where-Object { $_.id -ne $top.id })[0] }
$isReviewTask = ($modeNorm -eq 'review' -or $tasks -contains 'code_review' -or $tasks -contains 'independent_verification')
$execSurface = Get-ExecutionSurface $top.id 'implementation'
$phases = @([ordered]@{ phase=1; name=$modeNorm; surface=$execSurface; model=$top.id })
$diagnosisModel = $null
$stayPut = (-not $selectionUnavailable -and $top.id -eq $CurrentModel -and -not $modeNorm)
$currentScore = $null
# Research gating.
function Test-CandidateEvidenceGap($candidate) {
    if (-not $candidate) { return $false }
    $ce = Get-Canonical-Entry $ev (Get-Canonical-Key $ev $candidate.id)
    if (-not $ce) { return $true }
    $status = ''
    if ($ce.research_status) { $status = ([string]$ce.research_status).ToLower() }
    if ($status -in @('identity_only','partially_researched','stale_variant','unresearched')) { return $true }
    foreach ($k in $weights.Keys) {
        if ([double]$weights[$k] -lt 2.0) { continue }
        $cap = Get-Capability $ce $k
        if (-not $cap -or -not $cap.rating -or ([string]$cap.rating).ToLower() -eq 'unknown') { return $true }
    }
    return $false
}
$needsResearch = $false
$researchReason = 'cache sufficient'
if ($readiness -eq 'UNPOPULATED' -and $isConsequential) { $needsResearch = $true; $researchReason = 'UNPOPULATED evidence + consequential task' }
elseif ($readiness -eq 'UNPOPULATED' -and $isTrivial) { $needsResearch = $false; $researchReason = 'UNPOPULATED but trivial: inexpensive default' }
elseif ($isConsequential -and (Test-CandidateEvidenceGap $ranked[0])) {
    $needsResearch = $true; $researchReason = 'top candidate lacks current task-relevant evidence'
}
elseif ($isConsequential -and $ranked.Count -gt 1 -and (Test-CandidateEvidenceGap $ranked[1]) -and (($ranked[0].total - $ranked[1].total) -lt 0.75)) {
    $needsResearch = $true; $researchReason = 'close runner-up lacks current task-relevant evidence'
}
elseif (($freshness -eq 'stale' -or $freshness -eq 'very stale' -or $freshness -eq 'partially stale') -and ($ranked.Count -gt 1) -and (($ranked[0].total - $ranked[1].total) -lt 0.5) -and $isConsequential) {
    $needsResearch = $true; $researchReason = 'stale evidence + close candidates + consequential task'
}

$finalRecommended = if ($selectionUnavailable) { $null } else { $top.id }
$finalAction = $execSurface
if ($stayPut) {
    $finalRecommended = $CurrentModel
    $finalAction = 'stay'
    $execSurface = 'build'
    $phases = @([ordered]@{ phase=1; name='implementation'; surface='build'; model=$CurrentModel })
}

# Explain the final selected candidate, not an earlier winner or static lane.
$why = @()
$why += $economicReason
if ($bFreeOnly) { $why += 'free_only: only opencode-free routes may execute; no subscription fallback' }
if ($reviewBasis -eq 'bounded_coding_evidence') {
    if ($top.assessment_notes.Count) { $why += 'bounded second opinion needs host assessment; this exact model has incomplete capability evidence' }
    else { $why += 'bounded second opinion qualified by coding evidence; specialist review capability is not established' }
}
$why += ("task: " + ($tasks -join ' + ') + " | writes=$bNeedsWrites terminal=$bNeedsTerminal large_ctx=$NeedsLargeContextTokens deep=$bNeedsDeep diversity=$bNeedsDiversity consequence=$bHighConseq")
if ($top.why_caps -ne '') { $why += ("capabilities: " + $top.why_caps) }
if ($top.bench_notes -ne '') { $why += ("benchmarks (same-version only, harness-noted): " + $top.bench_notes) }
else { $why += ("benchmarks: no same-version benchmark bonus applied") }
if ($top.hist_n -ge 3) {
    $why += ("local history: n=$($top.hist_n) success=$([Math]::Round([double]$top.hist_rate,2)) tests=$([Math]::Round([double]$top.hist_tests_rate,2)) escalation=$([Math]::Round([double]$top.hist_escalation_rate,2)) review_defects=$([Math]::Round([double]$top.hist_review_defect_rate,2)) avg_attempts=$([Math]::Round([double]$top.hist_avg_attempts,2)) adj=$($top.hist_adj)")
}
else { $why += ("local history: n=$($top.hist_n) anecdotal only (needs n>=3)") }
$why += "economics: qualify first; compare normalized capacity estimates, use explicit price proxies only when quota mapping is unknown"
if ($top.quota_detail -and ([string]$top.quota_detail).Trim() -ne '') { $why += ("quota: " + [string]$top.quota_detail) }
if ($appliedBlocks.Count -gt 0) {
    $why += ("availability: " + (($appliedBlocks | ForEach-Object { ($_.surface + " " + $_.kind + " (" + $_.reason + ")") }) -join '; '))
} elseif (-not $quotaFresh) {
    $why += "availability: quota telemetry unknown or stale; no route blocked on telemetry"
}
if ($bNeedsWrites -and $isReviewTask) { $why += "A read-only review cannot perform repairs; Build must assign the authorized repair separately." }

$adequacy = 'unknown'
try {
    $topCap = [double]$top.cap_avg
    if ($topCap -le 0) { $adequacy = 'unknown' }
    elseif ($topCap -ge 3.0) { $adequacy = 'strong' }
    elseif ($topCap -ge 2.0) { $adequacy = 'adequate' }
    else { $adequacy = 'weak' }
} catch { $adequacy = 'unknown' }
if ($bHostAssessment -and $top.assessment_notes.Count) { $adequacy = 'host_assessment_required' }

# Evidence cards support the host's judgment. Scores remain advisory; never
# replace capability notes, benchmark harness caveats, costs or uncertainty.
$candidateCards = @()
if ($bHostAssessment) {
    foreach ($candidate in $ranked) {
        $ce = Get-Canonical-Entry $ev $candidate.canonical
        $caps = [ordered]@{}
        foreach ($key in @(@($weights.Keys) + 'tool_use' | Sort-Object -Unique)) {
            $cap = Get-Capability $ce $key
            $caps[$key] = if ($cap) { $cap } else { @{ rating='unknown'; confidence='unknown' } }
        }
        $candidateCards += [ordered]@{
            id=$candidate.id; canonical=$candidate.canonical; surface=$candidate.surface
            positioning=$ce.positioning; context=$ce.context; capabilities=$caps
            benchmarks=@($ce.benchmarks)
            efficiency=$ce.efficiency; cautions=@($ce.cautions); research_gaps=@($ce.research_gaps)
            research_status=$ce.research_status; last_researched_at=$ce.last_researched_at
            routing_profile_status=if ($ce.positioning -and $ce.source_keys -and $ce.last_researched_at -and $ce.capabilities) { 'complete' } else { 'needs_research' }
            assessment_notes=@($candidate.assessment_notes); advisory_score=$candidate.cap_avg
            history=@{ sample_count=$candidate.hist_n; success_rate=$candidate.hist_rate; tests_rate=$candidate.hist_tests_rate; average_attempts=$candidate.hist_avg_attempts }
            cost=@{ provider_price_proxy_dollars=$candidate.est_cost_dollars; monthly_fraction=$candidate.monthly_fraction; window_pressure=$candidate.window_pressure; estimate_source=$candidate.estimate_source; note=$candidate.quota_detail }
        }
    }
}

$result = [ordered]@{
    candidates = @($candidateCards)
    free_only = $bFreeOnly
    review_basis = $reviewBasis
    recommended = $finalRecommended
    top_scored = $top.id
    access = (Surface-Access $top.surface)
    why = $why
    execution_surface = $execSurface
    action = $finalAction
    phases = $phases
    fallback = $null
    current_lane = $LaneHint
    evidence_freshness = $freshness
    evidence_age_days = $evidenceAgeDays
    evidence_readiness = $readiness
    needs_research = $needsResearch
    research_reason = $researchReason
    is_trivial = $isTrivial
    is_consequential = $isConsequential
    stay_put = $stayPut
    filtered_out = @($filtered | ForEach-Object { [ordered]@{ id=$_.id; reason=$_.reason } })
    top_scores = @($ranked | Select-Object -First 5 | ForEach-Object {
        [ordered]@{ id=$_.id; total=$_.total; cap_avg=$_.cap_avg; bench=$_.bench_bonus; hist_n=$_.hist_n; hist_adj=$_.hist_adj; econ=$_.econ_adj; quota=$_.quota_econ; diversity=$_.diversity_adj }
    })
    ranking = @($ranked | ForEach-Object {
        [ordered]@{ id=$_.id; total=$_.total; cap_avg=$_.cap_avg; econ=$_.econ_adj; quota=$_.quota_econ }
    })
    choices = [ordered]@{
        recommended = [ordered]@{ id=$top.id; surface=$top.surface; basis=$top.why_caps; cost_note=$top.quota_detail; assessment_notes=@($top.assessment_notes) }
        lower_cost = @($ranked | Where-Object { $_.id -ne $top.id -and $_.economic_class -eq $top.economic_class -and $_.expense -lt $top.expense } | Select-Object -First 1 | ForEach-Object {
            [ordered]@{ id=$_.id; surface=$_.surface; basis=$_.why_caps; cost_note=$_.quota_detail; assessment_notes=@($_.assessment_notes) }
        })
        free = @($ranked | Where-Object { $_.surface -eq 'opencode-free' } | Select-Object -First 1 | ForEach-Object {
            [ordered]@{ id=$_.id; surface=$_.surface; basis=$_.why_caps; cost_note=$_.quota_detail; assessment_notes=@($_.assessment_notes) }
        })
    }
    quota_state = [ordered]@{
        fresh = $quotaFresh
        telemetry = $quotaTelemetryOut
        blocks = @($appliedBlocks)
        notes = @($quotaNotes)
        overage = $copilotOverage
    }
    consumption_estimate = [ordered]@{
        provider_cost_proxy_dollars = $top.est_cost_dollars
        estimate_source = $top.estimate_source
        monthly_fraction = $top.monthly_fraction
        window_pressure = $top.window_pressure
        quota_detail = $top.quota_detail
        note = 'Provider price proxy and normalized capacity are distinct; neither is a literal cash saving.'
    }
    choice_unavailable = $selectionUnavailable
    selected_model = $finalRecommended
    surface = $top.surface
    work_mode = $modeNorm
    adequacy = $adequacy
    reason_codes = $why
}
if ($fallback) {
    $result.fallback = [ordered]@{ id=$fallback.id; access=$fallback.access; total=$fallback.total }
    $result['fallback_model'] = [string]$fallback.id
} else {
    $result['fallback_model'] = $null
}
if ($diagnosisModel) { $result['diagnosis_model'] = [ordered]@{ id=$diagnosisModel.id; access=$diagnosisModel.access; total=$diagnosisModel.total } }

$result | ConvertTo-Json -Depth 12
