$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$root=Join-Path $env:TEMP ('toolkit-outcome-' + [guid]::NewGuid().ToString('N'))
function Check($c,[string]$s){if(-not $c){throw $s};Write-Output "PASS: $s"}
function Save([string]$p,$o){[IO.File]::WriteAllText($p,($o|ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))}
try {
 New-Item -ItemType Directory -Path (Join-Path $root 'routing'),(Join-Path $root '.state\delegation') -Force|Out-Null
 $history=Join-Path $root '.state\task-history.json'
 Save $history @{generated=$true;entries=@()}
 $roster=Join-Path $root 'routing\model-roster.json';Save $roster @{generated_at='2020-01-01T00:00:00Z';eligible_models=@()}
 $before=(Get-FileHash $roster).Hash
 $id='a'*64
 Save (Join-Path $root ('.state\delegation\'+$id+'.json')) @{
   task_id=$id;parent_model='opencode/free-parent';role='worker';status='completed';attempts=@(@{
     status='completed';selected_model='opencode-go/b';observed_model='opencode-go/b';surface='opencode-go';elapsed_ms=1000;
     usage=@{input=30;output=20;cache_read=10;cache_write=0;provider_dollars=.01}
   })
 }
 $script=Join-Path $repo 'scripts\record-task-outcome.ps1'
 $prior=(Get-FileHash -LiteralPath $history).Hash;$rejected=$false
 try { & $script -ToolkitRoot $root -TaskId $id -Repo fixture -TaskType bounded_feature | Out-Null } catch { $rejected=$true }
 Check ($rejected -and (Get-FileHash -LiteralPath $history).Hash -eq $prior) 'missing validation flags cannot silently become a failed outcome'
 $rejected=$false
 try { & $script -ToolkitRoot $root -TaskId $id -TaskType bounded_feature -ActualModel 'opencode-go/b' -Success true -TestsPassed true | Out-Null } catch { $rejected=$true }
 Check ($rejected -and (Get-FileHash -LiteralPath $history).Hash -eq $prior) 'unknown recorder parameters are rejected before mutation'
 $params=@{ToolkitRoot=$root;Repo='fixture';TaskType='bounded_feature';Model='opencode-go/b';Access='opencode-go';Success=$true;TestsPassed=$true;Attempts=1;Escalated=$false;ElapsedBand='short';TaskId=$id}
 & $script @params|Out-Null
 & $script @params|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check (@($h.entries).Count -eq 1) 'duplicate outcome is an upsert'
 Check ($h.entries[0].consumption.source -eq 'session_messages' -and $h.entries[0].consumption.input_tokens -eq 30) 'receipt provides structured per-child consumption'
 Check ((Get-FileHash $roster).Hash -eq $before) 'recording never advances availability discovery'
 & $script -ToolkitRoot $root -TaskId $id -MarkReviewDefect|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check ($h.entries[0].review_found_defects -eq $true) 'review finding attaches to original attempt'
 & $script @params|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check ($h.entries[0].review_found_defects -eq $true) 'later recording cannot erase the review defect'
 $params.Success=$false;$params.TestsPassed=$false
 & $script @params|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check (@($h.entries).Count-eq 1-and-not$h.entries[0].success-and@($h.entries[0].revisions).Count-eq 1) 'correction replaces one observation and retains previous validation'
 & $script -ToolkitRoot $root -TaskId $id -MarkReviewDefect -ReviewTaskId 'review-observation'|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check ($h.entries[0].review_task_id-eq'review-observation') 'review observation explicitly links to implementation'
 $params.Escalated=$true
 & $script @params|Out-Null
 $h=Get-Content $history -Raw|ConvertFrom-Json
 Check ($h.entries[0].escalated -and -not $h.entries[0].fallback_used) 'first-attempt paid escalation is distinct from a retry'
 $params.Model='opencode-go/wrong';$rejected=$false
 try { & $script @params|Out-Null } catch { $rejected=$true }
 Check $rejected 'wrong-model outcome rejected'
 $prior=(Get-FileHash $history).Hash
 $params.TaskId='b'*64;$params.Model='opencode/free';$params.Success=$true;$params.Role='review'
 foreach($status in @('no_qualified_route','paid_permission_declined')) {
   Save (Join-Path $root ('.state\delegation\'+$params.TaskId+'.json')) @{task_id=$params.TaskId;role='review';status=$status;attempts=@()}
   $rejected=$false
   try { & $script @params|Out-Null } catch { $rejected=$true }
   Check ($rejected-and(Get-FileHash $history).Hash-eq$prior) "unexecuted $status review cannot be recorded as success"
 }
 $params.TaskId='c'*64;$params.Model='';$params.Success=$false;$params.TestsPassed=$false;$params.Operational=$true
 Save (Join-Path $root ('.state\delegation\'+$params.TaskId+'.json')) @{task_id=$params.TaskId;role='worker';status='failed';attempts=@(@{status='failed';failure='timeout';selected_model='opencode/free';observed_model='opencode/free';surface='opencode-free';usage=@{input=25;output=2}})}
 & $script @params|Out-Null
 & $script @params|Out-Null
 $operational=@((Get-Content $history -Raw|ConvertFrom-Json).entries|Where-Object {$_.task_id-eq$params.TaskId})
 Check ($operational.Count-eq 1-and$operational[0].observation_kind-eq'operational'-and$operational[0].failure_kind-eq'timeout'-and-not$operational[0].success) 'timeout usage is recorded once as operational, never capability success'
 # New receipts attribute named agents and use workflow mode, not persona name.
 $params.TaskId='d'*64;$params.Model='opencode/free';$params.Success=$true;$params.TestsPassed=$true;$params.Remove('Operational');$params.Remove('Role')
 Save (Join-Path $root ('.state\delegation\'+$params.TaskId+'.json')) @{task_id=$params.TaskId;agent=@{id='accessibility';name='Accessibility specialist'};workflow=@{id='review';mode='review'};status='completed';attempts=@(@{status='completed';selected_model='opencode/free';dispatched_model='opencode/free';observed_model='opencode/free';surface='opencode-free'})}
 & $script @params|Out-Null
 $named=@((Get-Content $history -Raw|ConvertFrom-Json).entries|Where-Object {$_.task_id-eq$params.TaskId})[0]
 Check ($named.agent_id-eq'accessibility'-and$named.agent_name-eq'Accessibility specialist'-and$named.workflow_id-eq'review'-and$named.observation_kind-eq'review') 'named custom agent retains attribution and read-only review classification'
 Check (-not($named.PSObject.Properties.Name-contains'role')) 'new outcomes do not create a generic role'
 Set-Content -LiteralPath $history -Value '{broken';$corrupt=(Get-FileHash $history).Hash;$rejected=$false
 try { & $script @params|Out-Null } catch { $rejected=$true }
 Check ($rejected -and (Get-FileHash $history).Hash -eq $corrupt) 'malformed history preserved unchanged'
} finally {Remove-Item -LiteralPath $root -Recurse -Force}
