# Record validated outcomes separately from execution completion. PowerShell 5.1.
[CmdletBinding()]
param(
    [string]$ToolkitRoot = '', [string]$Repo, [string[]]$TaskType,
    [string]$Model, [string]$Access, $Success, $TestsPassed, [int]$Attempts,
    $Escalated, [string]$ElapsedBand, [string]$TaskId = '',
    $ReviewFoundDefects = $false, [switch]$MarkReviewDefect,
    [string]$Role = '', [string]$DelegatedModel = '', [string]$ParentModel = '',
    [switch]$MeasureStart, [switch]$MeasureFinalize,
    $InputTokens = $null, $OutputTokens = $null, $CacheReadTokens = $null, $CostDollars = $null,
    [string]$ConsumptionQuality = '', [string]$ConsumptionReason = '',
    [string]$UserTaskId = '', [string]$ReviewTaskId = '', [switch]$Operational
)
$ErrorActionPreference = 'Stop'
if (-not $Operational -and -not $MeasureStart -and -not $MarkReviewDefect -and
    (-not $PSBoundParameters.ContainsKey('Success') -or -not $PSBoundParameters.ContainsKey('TestsPassed'))) {
    throw 'Pass explicit -Success and -TestsPassed values. A missing result must not become a recorded failure.'
}
function To-Bool($v) {
    if ($v -is [bool]) { return $v }
    return ("$v".Trim().ToLower() -in @('1','true','yes','$true'))
}
$Success=To-Bool $Success; $TestsPassed=To-Bool $TestsPassed
$Escalated=To-Bool $Escalated; $ReviewFoundDefects=To-Bool $ReviewFoundDefects
$TaskTypeNorm=@()
foreach($t in @($TaskType)) {
    foreach($part in ("$t".Split(','))) { if($part.Trim()){ $TaskTypeNorm += $part.Trim().ToLower() } }
}
if (-not $TaskTypeNorm.Count -and -not $MarkReviewDefect) { throw '-TaskType is required.' }
if (-not $ToolkitRoot) { $ToolkitRoot=Split-Path -Parent $PSScriptRoot }
$HistoryPath=Join-Path $ToolkitRoot '.state\task-history.json'
$LegacyHistoryPath=Join-Path $ToolkitRoot 'routing\task-history.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $HistoryPath) -Force|Out-Null
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    $tmp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        [IO.File]::WriteAllText($tmp,$Text,(New-Object Text.UTF8Encoding($false)))
        if(Test-Path -LiteralPath $Path){[IO.File]::Replace($tmp,$Path,[NullString]::Value)}else{[IO.File]::Move($tmp,$Path)}
    } finally {if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force}}
}
function Parse-TokenNumber([string]$s) {
    $t=("$s".Trim() -replace ',','')
    if($t -match '^([\d\.]+)\s*([KMB])?$') {
        $v=[double]$Matches[1]
        switch($Matches[2]){'K'{return $v*1000.0};'M'{return $v*1000000.0};'B'{return $v*1000000000.0}}
        return $v
    }
    return 0.0
}
# Legacy all-session CLI snapshots are estimates only. Actual delegate execution
# records structured child-specific counters and is preferred below.
function Get-StatsSnapshot() {
    $snap=[ordered]@{captured_at=(Get-Date).ToUniversalTime().ToString('o');parse_ok=$false;models=[ordered]@{}}
    try {
        $oc = $null; try { $oc = [pscustomobject]@{ Source = (& (Join-Path $PSScriptRoot 'resolve-opencode.ps1')) } } catch { Write-Verbose $_ }
        if(-not $oc){return $snap}
        $prevEnc=[Console]::OutputEncoding
        try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{}
        try{$raw=& $oc.Source stats --models 2>$null|ForEach-Object{$_.ToString()}}
        finally{try{[Console]::OutputEncoding=$prevEnc}catch{}}
        $cur=''
        foreach($line in $raw){
            $t="$line".Trim()
            if($t -match '^[^A-Za-z0-9$]*([A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)\b'){
                $cur=$Matches[1]
                if(-not $snap.models.$cur){$snap.models[$cur]=[ordered]@{messages=0;input=0;output=0;cache_read=0;cost=0}}
            }elseif($cur -and $t -match '^[^A-Za-z0-9$]*?(Messages|Input Tokens|Output Tokens|Cache Read|Cache Write|Cost)\s+(.+?)\s*$'){
                $k=$Matches[1];$v=($Matches[2] -replace '[^0-9A-Za-z$%.,]+$','').Trim()
                if($k -eq 'Messages'){$snap.models[$cur].messages=[int](Parse-TokenNumber $v)}
                elseif($k -eq 'Input Tokens'){$snap.models[$cur].input=Parse-TokenNumber $v}
                elseif($k -eq 'Output Tokens'){$snap.models[$cur].output=Parse-TokenNumber $v}
                elseif($k -eq 'Cache Read'){$snap.models[$cur].cache_read=Parse-TokenNumber $v}
                elseif($k -eq 'Cost'){$snap.models[$cur].cost=Parse-TokenNumber ($v -replace '^\$','')}
            }
        }
        $snap.parse_ok=($snap.models.Count -gt 0)
    }catch{}
    return $snap
}
function Get-MeasurePath([string]$id){
    $safe=$id -replace '[^A-Za-z0-9_\-]','_'
    if(-not $safe){throw '-TaskId is required for measurement.'}
    return Join-Path $ToolkitRoot ('.state\measurements\'+$safe+'.json')
}
function To-DoubleOrNull($v){
    if($null -eq $v -or -not "$v".Trim()){return $null}
    try{$d=[double]"$v";if([double]::IsNaN($d)-or[double]::IsInfinity($d)-or$d-lt 0){throw 'invalid'};return $d}catch{return $null}
}
$historyLock=$null
try{$historyLock=New-Object System.IO.FileStream(($HistoryPath+'.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None,4096,[IO.FileOptions]::DeleteOnClose)}
catch{throw 'Outcome history is busy; retry this same TaskId without duplicating work.'}
try {
    $historyData=$null
    $historyReadPath=if(Test-Path -LiteralPath $HistoryPath){$HistoryPath}else{$LegacyHistoryPath}
    if(Test-Path -LiteralPath $historyReadPath){
        try{$historyData=Get-Content -LiteralPath $historyReadPath -Raw -Encoding UTF8|ConvertFrom-Json}
        catch{throw "History is malformed; preserved unchanged: $HistoryPath"}
    }
    if(-not $historyData){$historyData=[pscustomobject]@{generated=$true;generated_at='';entries=@()}}
    if(-not $historyData.PSObject.Properties['generated_at']){$historyData|Add-Member generated_at ''}
    if(-not $historyData.PSObject.Properties['entries']){$historyData|Add-Member entries @()}
    $now=(Get-Date).ToUniversalTime().ToString('o')
    $existing=@($historyData.entries)
    if($MeasureStart){
        if(-not $TaskId){$TaskId=[guid]::NewGuid().ToString()}
        $mp=Get-MeasurePath $TaskId
        New-Item -ItemType Directory -Path (Split-Path -Parent $mp) -Force|Out-Null
        $snap=Get-StatsSnapshot
        Write-Utf8NoBom $mp ([ordered]@{task_id=$TaskId;baseline_at=$snap.captured_at;parse_ok=$snap.parse_ok;models=$snap.models}|ConvertTo-Json -Depth 6)
        Write-Output "Measurement baseline (all-session estimate only): $TaskId"
        return
    }
    if($MarkReviewDefect){
        if(-not $TaskId){throw '-MarkReviewDefect requires -TaskId.'}
        $found=$false
        foreach($e in $existing){
            if($e.task_id -eq $TaskId){
                $e|Add-Member -NotePropertyName review_found_defects -NotePropertyValue $true -Force
                $e|Add-Member -NotePropertyName reviewed_at -NotePropertyValue $now -Force
                if ($ReviewTaskId) { $e|Add-Member -NotePropertyName review_task_id -NotePropertyValue $ReviewTaskId -Force }
                $found=$true;break
            }
        }
        if(-not $found){throw "TaskId not found: $TaskId"}
    }else{
        if(-not $TaskId){$TaskId=[guid]::NewGuid().ToString()}
        $cIn=To-DoubleOrNull $InputTokens;$cOut=To-DoubleOrNull $OutputTokens
        $cCache=To-DoubleOrNull $CacheReadTokens;$cCost=To-DoubleOrNull $CostDollars
        $cQuality=$ConsumptionQuality.Trim().ToLower();$cReason=$ConsumptionReason
        if(-not $cQuality -and ($null-ne$cIn-or$null-ne$cOut-or$null-ne$cCost)){$cQuality='estimated'}
        if($MeasureFinalize){
            $mp=Get-MeasurePath $TaskId
            if(-not(Test-Path -LiteralPath $mp)){throw 'No measurement baseline; run MeasureStart before the task.'}
            $base=Get-Content -LiteralPath $mp -Raw -Encoding UTF8|ConvertFrom-Json
            $after=Get-StatsSnapshot
            $after=$after|ConvertTo-Json -Depth 8|ConvertFrom-Json
            $b=$base.models.PSObject.Properties|Where-Object{$_.Name -eq $Model}|Select-Object -First 1
            $a=$after.models.PSObject.Properties|Where-Object{$_.Name -eq $Model}|Select-Object -First 1
            $cQuality='estimated';$cReason='All-session rounded counters; same-model concurrency cannot be excluded.'
            if(-not$base.parse_ok-or-not$after.parse_ok-or-not$a){
                $cQuality='unmeasurable';$cReason='stats-unavailable';$cIn=$null;$cOut=$null;$cCache=$null;$cCost=$null
            }else{
                $before=if($b){$b.Value}else{@{input=0;output=0;cache_read=0;cost=0}}
                $cIn=[double]$a.Value.input-[double]$before.input
                $cOut=[double]$a.Value.output-[double]$before.output
                $cCache=[double]$a.Value.cache_read-[double]$before.cache_read
                $cCost=[double]$a.Value.cost-[double]$before.cost
                if($cIn-lt 0-or$cOut-lt 0-or$cCache-lt 0-or$cCost-lt 0){
                    $cQuality='unmeasurable';$cReason='counter-reset-or-delayed-reporting';$cIn=$null;$cOut=$null;$cCache=$null;$cCost=$null
                }
            }
            Remove-Item -LiteralPath $mp -Force
        }
        $entry=[ordered]@{task_id=$TaskId;timestamp=$now;repo=$Repo;task_type=$TaskTypeNorm;model=$Model;access=$Access;
            success=$Success;tests_passed=$TestsPassed;attempts=$Attempts;escalated=$Escalated;
            review_found_defects=$ReviewFoundDefects;elapsed_band=$ElapsedBand;role=$Role;delegated_model=$DelegatedModel;parent_model=$ParentModel}
        $entry.user_task_id = if ($UserTaskId) { $UserTaskId } else { $TaskId }
        $entry.observation_kind = if ($Role -eq 'review') { 'review' } elseif ($Role -eq 'researcher') { 'research' } else { 'implementation' }
        if($null-ne$cIn-or$null-ne$cOut-or$null-ne$cCost-or$cQuality-eq'unmeasurable'){
            $entry.consumption=[ordered]@{input_tokens=$cIn;output_tokens=$cOut;cache_read_tokens=$cCache;cost_dollars=$cCost;quality=$cQuality;reason=$cReason}
        }
        $receiptPath=$null
        if($TaskId -match '^[a-f0-9]{64}$'){$receiptPath=Join-Path $ToolkitRoot ('.state\delegation\'+$TaskId+'.json')}
        if($receiptPath -and(Test-Path -LiteralPath $receiptPath)){
            $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json
            $attempt=@($receipt.attempts|Select-Object -Last 1)[0]
            $operationalReceipt = $Operational -and $receipt.status -in @('failed','stop_unverified') -and $attempt.status -eq 'failed'
            if($Operational -and (-not $operationalReceipt -or $Success -or $TestsPassed)){throw 'Operational recording requires a failed execution and cannot claim task success or passed tests.'}
            if(-not $operationalReceipt -and ($receipt.status-ne'completed'-or$attempt.status-ne'completed'-or$attempt.observed_model-ne$attempt.selected_model)){throw 'Do not assign capability success to an unverified or failed execution receipt.'}
            if($Model-and$Model-ne$attempt.observed_model){throw 'Recorded model differs from actual execution model.'}
            $entry.model=$attempt.observed_model;$entry.access=$attempt.surface
            if($receipt.agent.id){
                $entry.Remove('role')
                $entry.agent_id=$receipt.agent.id;$entry.agent_name=$receipt.agent.name
                $entry.workflow_id=$receipt.workflow.id;$entry.work_mode=$receipt.workflow.mode
            }else{$entry.role=$receipt.role} # Historical receipt compatibility only.
            $entry.parent_model=$receipt.parent_model;$entry.attempts=@($receipt.attempts).Count
            $entry.fallback_used=(@($receipt.attempts).Count-gt 1)
            $entry.escalated=($Escalated -or @($attempt.selection_reasons|Where-Object{$_ -like 'escalation:*'}).Count-gt 0)
            $entry.execution_source='runtime_receipt';$entry.elapsed_ms=$attempt.elapsed_ms
            $entry.user_task_id=if($receipt.user_task_id){$receipt.user_task_id}else{$receipt.parent_session}
            $entry.parent_session=$receipt.parent_session;$entry.child_session=$attempt.child_session
            $entry.selected_model=$attempt.selected_model;$entry.dispatched_model=$attempt.dispatched_model;$entry.observed_model=$attempt.observed_model
            $entry.execution_attempts=@($receipt.attempts)
            $entry.observation_kind=if($receipt.workflow.mode-eq'review'-or(-not$receipt.workflow-and$receipt.role-eq'review')){'review'}elseif($receipt.workflow.mode-in@('plan','explore')-or(-not$receipt.workflow-and$receipt.role-eq'researcher')){'research'}else{'implementation'}
            if($operationalReceipt){
                $entry.observation_kind='operational';$entry.failure_kind=$attempt.failure
                $entry.model=$attempt.selected_model;$entry.success=$false;$entry.tests_passed=$false
            }
            if($attempt.usage){
                $entry.consumption=[ordered]@{
                    input_tokens=$attempt.usage.input;output_tokens=$attempt.usage.output;reasoning_tokens=$attempt.usage.reasoning;cache_read_tokens=$attempt.usage.cache_read;cache_write_tokens=$attempt.usage.cache_write;
                    cost_dollars=$attempt.usage.provider_dollars;quality='measured';source='session_messages';
                    reason='Structured child counters; provider dollars are not subscription quota or a cash charge.'}
            }
        }
        if($Operational -and -not $operationalReceipt){throw 'Operational recording requires an actual failed runtime receipt.'}
        $priorEntry=@($existing|Where-Object{$_.task_id-eq$TaskId}|Select-Object -Last 1)
        if($priorEntry.Count-and$priorEntry[0].review_found_defects){$entry.review_found_defects=$true}
        if($priorEntry.Count-and$priorEntry[0].review_task_id){$entry.review_task_id=$priorEntry[0].review_task_id}
        if($priorEntry.Count){
            $prior=$priorEntry[0]
            $entry.revisions=@($prior.revisions|Where-Object{$null-ne$_})
            if($prior.success-ne$entry.success-or$prior.tests_passed-ne$entry.tests_passed-or$prior.attempts-ne$entry.attempts-or$prior.escalated-ne$entry.escalated-or$prior.observation_kind-ne$entry.observation_kind){
                $entry.revisions+=@{corrected_at=$now;previous_success=$prior.success;previous_tests_passed=$prior.tests_passed;previous_attempts=$prior.attempts;previous_escalated=$prior.escalated;previous_observation_kind=$prior.observation_kind}
            }
        }
        $existing=@($existing|Where-Object{$_.task_id-ne$TaskId})
        $existing+=$entry
    }
    if($existing.Count-gt 5000){$existing=@($existing|Sort-Object timestamp -Descending|Select-Object -First 5000|Sort-Object timestamp)}
    $historyData.entries=@($existing);$historyData.generated_at=$now
    Write-Utf8NoBom $HistoryPath ($historyData|ConvertTo-Json -Depth 8)
    # The selector reads this history directly. Never forge roster discovery freshness.
    Write-Output "Recorded task outcome: $TaskId (entries=$($existing.Count))"
}finally{if($historyLock){$historyLock.Dispose()}}
