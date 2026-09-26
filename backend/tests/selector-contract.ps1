<# Deterministic offline selector contracts; never uses live credentials/history. #>
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Root = Join-Path $env:TEMP ('toolkit-selector-' + [guid]::NewGuid().ToString('N'))
$failed = 0
function Check($condition,[string]$name) { if ($condition) { Write-Output "PASS: $name" } else { $script:failed++; Write-Output "FAIL: $name" } }
function Json([string]$rel,$obj) {
    $p = Join-Path $Root $rel; New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force | Out-Null
    [IO.File]::WriteAllText($p,(ConvertTo-Json -InputObject $obj -Depth 15),(New-Object Text.UTF8Encoding($false)))
}
function Run-Selection($extra=@{}) {
    $args2=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $RepoRoot 'scripts\select-model.ps1'),'-ToolkitRoot',$Root)
    if (-not $extra.ContainsKey('WorkMode')) { $args2 += @('-WorkMode','build') }
    # Append separately: PS 5.1's array/comma precedence must not join a flag and value.
    foreach ($k in $extra.Keys) { $args2 += ('-' + [string]$k); $args2 += [string]$extra[$k] }
    $raw = & powershell.exe @args2
    if ($LASTEXITCODE -ne 0) { throw 'Selector failed' }
    return (($raw -join "`n") | ConvertFrom-Json)
}
function State($used=20,$status='ok',$age=0) {
    $windows=[ordered]@{}
    foreach ($w in @('rolling','weekly','monthly')) { $windows[$w]=@{ used_percent=$used; status=$status; resets_at=(Get-Date).ToUniversalTime().AddHours(2).ToString('o') } }
    return @{ generated_at=(Get-Date).ToUniversalTime().ToString('o'); surfaces=@{
        'opencode-go'=@{ telemetry=@{status='ok';as_of=(Get-Date).ToUniversalTime().AddMinutes(-$age).ToString('o');source='fixture'};windows=$windows }
    }}
}
try {
    New-Item -ItemType Directory -Path (Join-Path $Root 'routing') -Force | Out-Null
    $caps=@{}
    foreach($c in @('coding','routine_coding','tool_use','speed','research','repo_understanding','architecture','debugging','long_horizon_engineering','deep_reasoning','agentic_work','terminal_agent_work','code_review')) { $caps[$c]=@{rating='strong';confidence='high';evidence=@('fixture')} }
    $models=@{}; $aliases=@{}
    foreach($id in @('opencode-go/cheap','opencode-go/expensive','openai/other','opencode/free')) {
        $models[$id]=@{ provider=$id; capabilities=$caps; context=@{input_tokens=128000}; research_status='researched_current'; benchmarks=@() }
        $aliases[$id]=$id
    }
    $models['opencode-go/unknown']=@{provider='unknown';capabilities=@{};research_status='identity_only';benchmarks=@()}
    $aliases['opencode-go/unknown']='opencode-go/unknown'
    $roster=@{eligible_models=@(@{id='opencode-go/cheap';surface='opencode-go'},@{id='opencode-go/expensive';surface='opencode-go'},@{id='opencode-go/unknown';surface='opencode-go'})}
    Json 'routing\policy.json' @{allowed_surfaces=@('opencode-go','opencode-free','openai-oauth','github-copilot-oauth');allow_overage=$false}
    Json 'routing\model-roster.json' $roster
    Json 'routing\model-evidence.json' @{schema_version=2;advisor_readiness='READY';evidence_as_of=(Get-Date).ToUniversalTime().ToString('yyyy-MM-dd');models=$models;alias_index=$aliases;sources=@{fixture=@{}}}
    Json 'routing\task-history.json' @{entries=@()}
    Json 'routing\state.json' @{}
    Json 'routing\go-pricing.json' @{window_shares=@{rolling=.2;weekly=.5;monthly=1};models=@{
        'opencode-go/cheap'=@{input=.1;output=.2;cache_read=.002;monthly_limit=60}
        'opencode-go/expensive'=@{input=2;output=6;cache_read=.4;monthly_limit=15}
    }}
    $a=Run-Selection
    Check ($a.selected_model -eq 'opencode-go/cheap') 'omitted estimates use a workload prior and distinguish same-pool models'
    Check ($a.adequacy -in @('adequate','strong')) 'selected candidate clears real quality floor'
    Check (@($a.filtered_out | Where-Object {$_.id -eq 'opencode-go/unknown'}).Count -eq 1) 'unknown capability does not qualify'
    Check ($a.consumption_estimate.monthly_fraction -gt 0) 'static economics remains useful without telemetry'
    Check ($a.execution_surface -eq 'delegate') 'explicit role selects child execution, not a parent model switch'
    $chosen=Run-Selection @{SelectedModel='opencode-go/expensive'}
    Check ($chosen.selected_model-eq'opencode-go/expensive'-and$chosen.choices.lower_cost[0].id-eq'opencode-go/cheap'-and$chosen.fallback_model-ne$chosen.selected_model) 'user choice binds a qualified route and exposes a genuinely lower-cost alternative'
    $unqualified=Run-Selection @{SelectedModel='opencode-go/unknown'}
    Check ($null-eq$unqualified.selected_model-and$unqualified.choice_unavailable) 'user choice cannot bypass missing capability evidence'
    Json '.state\quota-state.json' (State 90)
    $b=Run-Selection
    Check ($b.consumption_estimate.window_pressure -gt 0) 'scarcity changes predicted task pressure'
    Check ($b.selected_model) '90 percent use is not an exhausted pool'
    Json '.state\quota-state.json' (State 102 'rate-limited')
    $c=Run-Selection
    Check ($null -eq $c.selected_model) 'exhausted shared Go pool excludes every affected model'
    Json '.state\quota-state.json' (State 20)
    $d=Run-Selection @{ExcludedModels='opencode-go/cheap'}
    Check ($d.selected_model -eq 'opencode-go/expensive') 'failed model can be excluded without excluding a healthy same-pool model'
    $e=Run-Selection @{NeedsLargeContextTokens='200000'}
    Check ($null -eq $e.selected_model) 'known insufficient context filters candidates'
    $f=Run-Selection @{NeedsModelDiversity='true';ExcludeModel='opencode-go/cheap'}
    Check ($f.selected_model -eq 'opencode-go/expensive') 'explicit model independence honored'
    $g=Run-Selection @{CurrentModel='opencode-go/expensive'}
    Check ($g.selected_model -eq 'opencode-go/cheap' -and $g.surface -eq 'opencode-go') 'child selection not overridden by stale stay-put metadata'
    $roster.eligible_models=@(@{id='opencode-go/cheap';surface='opencode-go'})
    Json 'routing\model-roster.json' $roster
    $h=Run-Selection
    Check ($h.selected_model -and $null -eq $h.fallback_model -and @($h.phases).Count -eq 1) 'one candidate has no fabricated fallback/reviewer'
    $q=State 20
    $q.surfaces['opencode-go'].execution=@{blocked=$true;reason='quota_exhaustion';reset_at='';recheck_at=(Get-Date).AddMinutes(-2).ToString('o');recheck_count=99}
    Json '.state\quota-state.json' $q
    $i=Run-Selection
    Check ($null -eq $i.selected_model) 'unknown-reset failure count never restores normal eligibility'
    Json '.state\quota-state.json' (State 20)
    Json '.state\delegation\blocks\example.json' @{scope='model';key='opencode-go/cheap';reason='auth';recorded_at=(Get-Date).ToString('o')}
    $j=Run-Selection
    Check ($null -eq $j.selected_model) 'durable execution-side health excludes a failed route'
    Remove-Item -LiteralPath (Join-Path $Root '.state\delegation\blocks\example.json')
    $roster.eligible_models += @{id='openai/other';surface='openai-oauth'}
    Json 'routing\model-roster.json' $roster
    $q=State 20
    $q.surfaces['openai-oauth']=@{telemetry=@{status='ok';as_of=(Get-Date).ToUniversalTime().ToString('o')};allowed=$false;limit_reached=$true;windows=@{primary=@{used_percent=100}}}
    Json '.state\quota-state.json' $q
    $k=Run-Selection
    Check (@($k.filtered_out | Where-Object {$_.id -eq 'openai/other' -and $_.reason -match 'exhausted'}).Count -eq 1) 'confirmed relevant ChatGPT exhaustion is a hard exclusion'
    # A stale observation with unknown numeric shape must not become a fresh balance
    # merely because the Go observation is recent.
    $q.surfaces['openai-oauth']=@{telemetry=@{status='ok';as_of=(Get-Date).ToUniversalTime().AddDays(-1).ToString('o')};windows=@{primary=@{used_percent=20}}}
    Json '.state\quota-state.json' $q
    $l=Run-Selection
    Check (@($l.ranking | Where-Object {$_.id -eq 'openai/other'}).Count -eq 1) 'one successful provider does not make unrelated stale data fresh'
    $roster.eligible_models=@(@{id='opencode/free';surface='opencode-free'},@{id='openai/other';surface='openai-oauth'})
    Json 'routing\model-roster.json' $roster
    $free=Run-Selection @{TaskType='simple_edit'}
    Check ($free.selected_model -eq 'opencode/free') 'adequate free wins ordinary work over subscription route'
    $savedContext=$models['opencode/free'].context
    $models['opencode/free'].context=@{}
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $unknownContext=Run-Selection @{NeedsLargeContextTokens='32000'}
    Check ($unknownContext.selected_model -eq 'openai/other') 'unknown required context cannot qualify'
    $models['opencode/free'].context=$savedContext
    $freeCaps=@{};foreach($key in $caps.Keys){$freeCaps[$key]=$caps[$key]}
    $freeCaps['terminal_agent_work']=@{rating='unknown';confidence='low'}
    $models['opencode/free'].capabilities=$freeCaps
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $unknownTerminal=Run-Selection @{NeedsTerminal='true'}
    Check ($unknownTerminal.selected_model -eq 'openai/other') 'other strong capabilities cannot hide unknown required terminal support'
    $roster.eligible_models=@(@{id='openai/other';surface='openai-oauth'})
    Json 'routing\model-roster.json' $roster
    $compound=Run-Selection @{TaskType='code_review,debugging';NeedsWrites='true'}
    Check ($compound.selected_model -eq 'openai/other' -and $null -eq $compound.fallback_model) 'singleton compound review and repair stays honest'
    $noDiversity=Run-Selection @{NeedsModelDiversity='true';ExcludeModel='openai/other'}
    Check ($null -eq $noDiversity.selected_model) 'unavailable independent model returns no route'
    $stayRaw=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'scripts\select-model.ps1') -ToolkitRoot $Root -CurrentModel 'openai/other'
    $stay=($stayRaw-join"`n")|ConvertFrom-Json
    Check ($stay.stay_put-and$stay.selected_model-eq'openai/other'-and$stay.surface-eq'openai-oauth'-and$stay.access-eq'ChatGPT OAuth'-and$stay.phases[0].model-eq$stay.selected_model) 'stay-put phases access and surface describe the final model'
    $models['github-copilot/example']=@{provider='copilot';capabilities=$caps;context=@{input_tokens=128000};benchmarks=@()}
    $aliases['github-copilot/example']='github-copilot/example'
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $roster.eligible_models=@(@{id='github-copilot/example';surface='github-copilot-oauth'})
    Json 'routing\model-roster.json' $roster
    $q=State 20
    $q.surfaces['github-copilot-oauth']=@{telemetry=@{status='ok';as_of=(Get-Date).ToUniversalTime().ToString('o')};buckets=@{premium_interactions=@{percent_remaining=0;overage_permitted=$true}}}
    Json '.state\quota-state.json' $q
    $copilot=Run-Selection
    Check ($null-eq$copilot.selected_model) 'Copilot exhaustion blocks even when provider offers unapproved overage'
    $goodCaps=@{};foreach($key in $caps.Keys){$goodCaps[$key]=@{rating='good';confidence='high';evidence=@('fixture')}}
    $models['opencode/free'].capabilities=$goodCaps
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $roster.eligible_models=@(@{id='opencode/free';surface='opencode-free'},@{id='openai/other';surface='openai-oauth'})
    Json 'routing\model-roster.json' $roster
    # This contract targets the prefer-free policy; the app default is balanced.
    $ordinary=Run-Selection @{TaskType='simple_edit';CostPreference='prefer-free'}
    $consequential=Run-Selection @{TaskType='architecture';CostPreference='prefer-free'}
    Check ($ordinary.selected_model-eq'opencode/free'-and$consequential.selected_model-eq'openai/other'-and($consequential.reason_codes-join' ')-match'capability advantage') 'stronger subscription wins only when a consequential task warrants the measured advantage'
    $hardFree=Run-Selection @{TaskType='architecture';FreeOnly='true';CostPreference='prefer-free'}
    Check ($hardFree.selected_model-eq'opencode/free'-and$hardFree.free_only-and@($hardFree.ranking|Where-Object {$_.id-ne'opencode/free'}).Count-eq 0) 'FreeOnly survives consequential escalation and filters all subscription candidates'
    $roster.eligible_models=@(@{id='opencode-go/cheap';surface='opencode-go'},@{id='github-copilot/example';surface='github-copilot-oauth'})
    Json 'routing\model-roster.json' $roster
    Json '.state\quota-state.json' (State 20)
    $noneFree=Run-Selection @{FreeOnly='true'}
    Check ($null-ne$noneFree-and$null-eq$noneFree.selected_model-and$noneFree.free_only-and@($noneFree.filtered_out).Count-eq 2) 'healthy economic-class-zero subscriptions cannot satisfy FreeOnly; no route is structured'
    $falseFree=Run-Selection @{FreeOnly='false'}
    Check ($falseFree.selected_model-and-not$falseFree.free_only) 'PowerShell 5.1 CLI parses false as false'
    $invalidFreeRejected=$false
    try { & (Join-Path $RepoRoot 'scripts\select-model.ps1') -ToolkitRoot $Root -FreeOnly 'tru' | Out-Null } catch { $invalidFreeRejected=$true }
    Check $invalidFreeRejected 'invalid FreeOnly input fails closed instead of spending subscription quota'
    $reviewCaps=@{};foreach($key in $goodCaps.Keys){$reviewCaps[$key]=$goodCaps[$key]}
    $reviewCaps.Remove('code_review')
    $models['opencode/free'].capabilities=$reviewCaps
    $roster.eligible_models=@(@{id='opencode/free';surface='opencode-free'},@{id='openai/other';surface='openai-oauth'})
    Json 'routing\model-roster.json' $roster
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $bounded=Run-Selection @{WorkMode='review';TaskType='code review,token economics';FreeOnly='true';NeedsModelDiversity='true';CurrentModel='openai/other'}
    Check ($bounded.selected_model-eq'opencode/free'-and$bounded.review_basis-eq'bounded_coding_evidence') 'bounded independent review uses known coding evidence and normalizes natural task labels'
    $specialist=Run-Selection @{WorkMode='review';TaskType='code_review';ReviewMode='specialist';FreeOnly='true'}
    $consequenceReview=Run-Selection @{WorkMode='review';TaskType='code_review';HighConsequence='true';FreeOnly='true'}
    Check ($null-eq$specialist.selected_model-and$null-eq$consequenceReview.selected_model) 'specialist and consequential review still reject unknown review evidence'
    $orientationCaps=@{coding=@{rating='good';confidence='high';evidence=@('fixture')};tool_use=@{rating='strong';confidence='high';evidence=@('fixture')}}
    $models['opencode/free'].capabilities=$orientationCaps
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $orientation=Run-Selection @{WorkMode='explore';TaskType='repo_orientation';FreeOnly='true'}
    $investigation=Run-Selection @{WorkMode='explore';TaskType='repo_navigation,research';FreeOnly='true'}
    Check ($orientation.selected_model-eq'opencode/free'-and$null-eq$investigation.selected_model) 'routine local orientation qualifies from coding and tool use without fabricating deep research evidence'
    $models['opencode/free'].capabilities=$reviewCaps
    $reviewCaps['coding']=@{rating='unknown';confidence='low'}
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $unknownCoding=Run-Selection @{WorkMode='review';TaskType='code_review';FreeOnly='true'}
    Check ($null-eq$unknownCoding.selected_model) 'bounded review still rejects unknown coding evidence'
    $hostChoice=Run-Selection @{WorkMode='review';TaskType='code_review';FreeOnly='true';HostAssessment='true';SelectedModel='opencode/free'}
    Check ($hostChoice.selected_model-eq'opencode/free'-and$hostChoice.adequacy-eq'host_assessment_required'-and$hostChoice.candidates[0].capabilities.coding.rating-eq'unknown') 'host can assess a bounded evidence gap without converting unknown into proven adequacy'
    Check ($hostChoice.candidates[0].assessment_notes.Count-gt 0-and$null-ne$hostChoice.candidates[0].cost-and$null-ne$hostChoice.candidates[0].context) 'host receives uncertainty, capacity and cost evidence'
    $strictHost=Run-Selection @{WorkMode='review';TaskType='code_review';FreeOnly='true';HostAssessment='true';HighConsequence='true';SelectedModel='opencode/free'}
    Check ($null-eq$strictHost.selected_model) 'host reasoning cannot waive consequential evidence requirements'
    $reviewCaps['coding']=@{rating='good';confidence='medium';evidence=@('fixture')}
    $reviewCaps['tool_use']=@{rating='adequate';confidence='medium';evidence=@('fixture')}
    $models['opencode/free'].capabilities=$reviewCaps
    $models['opencode/free'].benchmarks=@(@{benchmark='Fixture coding test';value=50;harness='fixture only';comparability='not cross-harness'})
    $models['opencode/free'].cautions=@('Identity uncertain')
    $aliases['opencode/free-alias']='opencode/free'
    $roster.eligible_models+=@{id='opencode/free-alias';surface='opencode-free'}
    Json 'routing\model-roster.json' $roster
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $cards=Run-Selection @{WorkMode='review';TaskType='code_review';FreeOnly='true';HostAssessment='true'}
    Check ($cards.candidates[0].benchmarks[0].harness-eq'fixture only'-and$cards.candidates[0].cautions[0]-eq'Identity uncertain') 'host cards preserve benchmark caveats and identity uncertainty'
    $aliasesExcluded=Run-Selection @{WorkMode='review';TaskType='code_review';FreeOnly='true';HostAssessment='true';DiversityModels='opencode/free-alias';SelectedModel='opencode/free'}
    Check ($null-eq$aliasesExcluded.selected_model) 'prior reviewer exclusions apply across canonical aliases'
    $hardSpend=Run-Selection @{HostAssessment='true';FreeOnly='true';SelectedModel='openai/other'}
    Check ($null-eq$hardSpend.selected_model-and$hardSpend.choice_unavailable) 'explicit host choice cannot override free-only spending'
    $hardContext=Run-Selection @{HostAssessment='true';FreeOnly='true';NeedsLargeContextTokens='2000000';SelectedModel='opencode/free'}
    Check ($null-eq$hardContext.selected_model) 'explicit host choice cannot exceed context capacity'
    $reviewCaps['tool_use']=@{rating='weak';confidence='high';evidence=@('fixture')}
    Json 'routing\model-evidence.json' @{models=$models;alias_index=$aliases}
    $noTools=Run-Selection @{HostAssessment='true';FreeOnly='true';SelectedModel='opencode/free'}
    Check ($null-eq$noTools.selected_model) 'known unsupported tools remain a hard block even with host choice'
    $roster.eligible_models=@()
    Json 'routing\model-roster.json' $roster
    $m=Run-Selection
    Check ($null -eq $m.selected_model -and @($m.phases).Count -eq 0) 'empty inventory returns a valid no-route result'
} finally { Remove-Item -LiteralPath $Root -Recurse -Force }
if ($failed) { throw "$failed selector contracts failed" }
Write-Output 'Selector contracts passed (isolated fixtures; no live model calls).'
