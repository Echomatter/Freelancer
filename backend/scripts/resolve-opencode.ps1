<# Resolve the external host, excluding toolkit wrappers in any checkout/release. #>
$ErrorActionPreference='Stop'
$candidates = @(Get-Command opencode -All -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)
foreach ($candidate in $candidates) {
    $file = $candidate.Source
    if (-not $file) { continue }
    if ([IO.Path]::GetExtension($file) -in @('.cmd','.ps1','.bat')) {
        if ((Get-Content -LiteralPath $file -Raw) -match 'launch-opencode\.ps1') { continue }
    }
    return $file
}
throw 'External OpenCode executable not found on PATH. Install OpenCode or repair PATH; toolkit wrappers cannot launch themselves.'
