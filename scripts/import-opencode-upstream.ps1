param(
    [string]$UpstreamUrl = "https://github.com/anomalyco/opencode.git",
    [string]$UpstreamRef = "907b3bc518fa48e90e8ec24dd327d13eee71c36c",
    [string]$Prefix = "vendor/opencode",
    [switch]$AllowVersionSkew
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Read-JsonText {
    param([string]$Text, [string]$Label)
    try { return $Text | ConvertFrom-Json }
    catch { throw "$Label is not valid JSON." }
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    throw "Run this script from inside the Freelancer repository."
}

Set-Location $repoRoot

$currentBranch = (& git branch --show-current).Trim()
if ($currentBranch -ne "fusion/opencode-runtime") {
    throw "Refusing to import OpenCode on '$currentBranch'. Switch to fusion/opencode-runtime first."
}

$dirty = & git status --porcelain
if ($dirty) {
    throw "Working tree must be clean before importing OpenCode."
}

if (Test-Path $Prefix) {
    throw "$Prefix already exists. Refusing to overwrite an existing OpenCode import."
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

& git cat-file -e "$UpstreamRef^{commit}"
if ($LASTEXITCODE -ne 0) {
    throw "Fetched object '$UpstreamRef' is not available as a commit."
}

$localPackage = Read-JsonText -Text (Get-Content -Raw package.json) -Label "Freelancer package.json"
$upstreamSpec = "${UpstreamRef}:packages/opencode/package.json"
$upstreamPackageText = (& git show $upstreamSpec)
if ($LASTEXITCODE -ne 0 -or -not $upstreamPackageText) {
    throw "Unable to read packages/opencode/package.json from pinned upstream revision."
}
$upstreamPackage = Read-JsonText -Text ($upstreamPackageText -join [Environment]::NewLine) -Label "OpenCode package.json"

$localPluginVersion = $localPackage.dependencies.'@opencode-ai/plugin'
$upstreamVersion = $upstreamPackage.version
if ($localPluginVersion -and $upstreamVersion -and $localPluginVersion -ne $upstreamVersion) {
    $message = "Freelancer currently depends on @opencode-ai/plugin $localPluginVersion, while pinned OpenCode is $upstreamVersion."
    if (-not $AllowVersionSkew) {
        throw "$message Resolve or explicitly review the version skew before import. Re-run with -AllowVersionSkew only after recording the compatibility decision."
    }
    Write-Warning "$message Import is continuing because -AllowVersionSkew was supplied."
}

Write-Host "Importing OpenCode into $Prefix as a squashed subtree ..."
Invoke-Git subtree add "--prefix=$Prefix" $UpstreamRef --squash

Write-Host ""
Write-Host "OpenCode imported successfully."
Write-Host "Pinned revision: $UpstreamRef"
Write-Host "Location: $Prefix"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Follow docs/FUSION_STAGING_CHECKLIST.md."
Write-Host "  2. Complete docs/OPENCODE_RUNTIME_PACKAGE_MAP.md before changing upstream code."
Write-Host "  3. Establish parity scenarios from docs/OPENCODE_RUNTIME_PARITY_HARNESS.md."
