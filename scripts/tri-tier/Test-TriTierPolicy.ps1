[CmdletBinding()]
param(
    [string]$RepositoryPath = (Get-Location).Path,
    [switch]$Ci
)

$ErrorActionPreference = "Stop"
$RepositoryPath = [System.IO.Path]::GetFullPath($RepositoryPath)
$errors = @()
$warnings = @()

$manifestPath = Join-Path $RepositoryPath ".codex\tri-tier-policy.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    $errors += "Missing $manifestPath"
}
else {
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.policyVersion -ne "1.0.0") {
            $warnings += "Unexpected policy version: $($manifest.policyVersion)"
        }
        if (-not [bool]$manifest.adopted) {
            $errors += "Project manifest is not marked adopted."
        }
        if (@($manifest.validationCommands).Count -eq 0) {
            $warnings += "No executable project validation commands are defined."
        }
    }
    catch {
        $errors += "Manifest is invalid JSON: $($_.Exception.Message)"
    }
}

$activeAgentsFile = if (Test-Path (Join-Path $RepositoryPath "AGENTS.override.md")) {
    Join-Path $RepositoryPath "AGENTS.override.md"
} else {
    Join-Path $RepositoryPath "AGENTS.md"
}
if (-not (Test-Path -LiteralPath $activeAgentsFile)) {
    $errors += "Missing active repository instruction file: $activeAgentsFile"
}
else {
    $agentsText = Get-Content -LiteralPath $activeAgentsFile -Raw -Encoding UTF8
    if ($agentsText -notmatch 'BEGIN TRI-TIER EXECUTION POLICY') {
        $errors += "Active repository instruction file lacks the managed Tri-Tier block: $activeAgentsFile"
    }
}

$gitignorePath = Join-Path $RepositoryPath ".gitignore"
if (-not (Test-Path -LiteralPath $gitignorePath)) {
    $errors += "Missing .gitignore"
}
else {
    $gitignore = Get-Content -LiteralPath $gitignorePath -Raw -Encoding UTF8
    if ($gitignore -notmatch '(?m)^\s*\.agent-runs/\s*$') {
        $errors += ".gitignore does not ignore .agent-runs/"
    }
}

foreach ($required in @(
    ".codex\schemas\tri-tier-run-receipt.schema.json",
    "scripts\tri-tier\Invoke-TriTierProjectValidation.ps1",
    "scripts\tri-tier\Test-TriTierPolicy.ps1"
)) {
    $path = Join-Path $RepositoryPath $required
    if (-not (Test-Path -LiteralPath $path)) {
        $errors += "Missing required Tri-Tier file: $required"
    }
}

foreach ($warning in $warnings) {
    Write-Warning $warning
}
if ($errors.Count -gt 0) {
    foreach ($errorMessage in $errors) {
        Write-Error $errorMessage
    }
    exit 1
}

Write-Host "Tri-Tier project policy verification passed: $RepositoryPath" -ForegroundColor Green
