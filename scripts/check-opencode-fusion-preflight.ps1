param(
    [string]$UpstreamUrl = "https://github.com/anomalyco/opencode.git",
    [string]$UpstreamRef = "907b3bc518fa48e90e8ec24dd327d13eee71c36c",
    [string]$VendorPath = "vendor/opencode"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { Fail "Run this script from inside the Freelancer repository." }
$repoRoot = $repoRoot.Trim()
Set-Location $repoRoot

$branch = (& git branch --show-current).Trim()
if ($branch -ne "fusion/opencode-runtime") { Fail "Expected fusion/opencode-runtime, found '$branch'." }

if (& git status --porcelain) { Fail "Working tree is not clean." }
if (Test-Path $VendorPath) { Fail "$VendorPath already exists; preflight is for the initial import." }

$package = Get-Content -Raw package.json | ConvertFrom-Json
$localPlugin = $package.dependencies.'@opencode-ai/plugin'
if (-not $localPlugin) { Fail "Freelancer package.json has no @opencode-ai/plugin dependency to compare." }

$remoteName = "opencode-upstream"
$remote = (& git remote get-url $remoteName 2>$null)
if ($LASTEXITCODE -ne 0) {
    & git remote add $remoteName $UpstreamUrl
    if ($LASTEXITCODE -ne 0) { Fail "Could not add $remoteName remote." }
} elseif ($remote.Trim() -ne $UpstreamUrl) {
    Fail "Remote '$remoteName' points to '$($remote.Trim())', expected '$UpstreamUrl'."
}

Write-Host "Fetching pinned OpenCode commit..."
& git fetch $remoteName $UpstreamRef
if ($LASTEXITCODE -ne 0) { Fail "Could not fetch pinned OpenCode commit." }

$spec = "${UpstreamRef}:packages/opencode/package.json"
$upstreamText = (& git show $spec)
if ($LASTEXITCODE -ne 0 -or -not $upstreamText) { Fail "Could not inspect pinned OpenCode package metadata." }
$upstream = ($upstreamText -join [Environment]::NewLine) | ConvertFrom-Json

$bun = Get-Command bun -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Fusion staging preflight"
Write-Host "------------------------"
Write-Host "Branch:                 $branch"
Write-Host "Freelancer plugin:      $localPlugin"
Write-Host "Pinned OpenCode:        $($upstream.version)"
Write-Host "Pinned commit:          $UpstreamRef"
Write-Host "Vendor target:          $VendorPath"
Write-Host "Node available:         $([bool]$node)"
Write-Host "npm available:          $([bool]$npm)"
Write-Host "Bun available:          $([bool]$bun)"
if ($bun) { Write-Host "Bun version:            $(& bun --version)" }

$blocked = $false
if ($localPlugin -ne $upstream.version) {
    Write-Warning "Version skew is unresolved: Freelancer @opencode-ai/plugin $localPlugin vs OpenCode $($upstream.version)."
    $blocked = $true
}
if (-not $bun) {
    Write-Warning "Bun is not available; the vendored OpenCode workspace cannot yet be proven as a build island."
    $blocked = $true
}

if ($blocked) {
    Fail "Preflight found blocking staging conditions. Resolve them before importing."
}

Write-Host ""
Write-Host "Preflight passed. The branch is ready for the initial vendored source import."
