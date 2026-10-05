param(
    [string]$UpstreamUrl = "https://github.com/anomalyco/opencode.git",
    [string]$UpstreamRef = "907b3bc518fa48e90e8ec24dd327d13eee71c36c",
    [string]$Prefix = "runtime/opencode-upstream"
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    throw "Run this script from inside the Freelancer repository."
}

Set-Location $repoRoot

$currentBranch = (& git branch --show-current).Trim()
if ($currentBranch -ne "fusion/opencode-runtime") {
    Write-Warning "Current branch is '$currentBranch'. This importer is intended for fusion/opencode-runtime."
}

if (Test-Path $Prefix) {
    throw "$Prefix already exists. Refusing to overwrite an existing OpenCode import."
}

$dirty = & git status --porcelain
if ($dirty) {
    throw "Working tree must be clean before importing OpenCode."
}

$remoteName = "opencode-upstream"
$existingRemote = (& git remote get-url $remoteName 2>$null)
if ($LASTEXITCODE -ne 0) {
    Invoke-Git remote add $remoteName $UpstreamUrl
} elseif ($existingRemote.Trim() -ne $UpstreamUrl) {
    throw "Remote '$remoteName' already points to '$($existingRemote.Trim())', expected '$UpstreamUrl'."
}

Write-Host "Fetching pinned OpenCode revision $UpstreamRef ..."
Invoke-Git fetch $remoteName $UpstreamRef

Write-Host "Importing OpenCode into $Prefix as a squashed subtree ..."
Invoke-Git subtree add "--prefix=$Prefix" $remoteName $UpstreamRef --squash

Write-Host ""
Write-Host "OpenCode imported successfully."
Write-Host "Pinned revision: $UpstreamRef"
Write-Host "Location: $Prefix"
Write-Host ""
Write-Host "Next: follow docs/OPENCODE_RUNTIME_FUSION_PLAN.md and begin the runtime/presentation inventory before modifying upstream code."
