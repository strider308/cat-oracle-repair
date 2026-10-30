[CmdletBinding()]
param(
    [string]$RepositoryPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][string]$ReceiptPath,
    [ValidateSet("luna", "terra", "sol")][string]$SelectedTier,
    [string[]]$AgentsUsed = @(),
    [switch]$HumanApprovalRequired,
    [string[]]$RemainingRisks = @()
)

$ErrorActionPreference = "Stop"
$RepositoryPath = [System.IO.Path]::GetFullPath($RepositoryPath)
$manifestPath = Join-Path $RepositoryPath ".codex\tri-tier-policy.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Missing project Tri-Tier manifest: $manifestPath"
}

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$commonPath = Join-Path $codexHome "hooks\tri-tier\TriTier.Common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) {
    throw "Global Tri-Tier common module not found: $commonPath"
}
. $commonPath

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$commands = @($manifest.validationCommands)
$runDirectory = Split-Path -Parent $ReceiptPath
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$evidenceRoot = Join-Path $RepositoryPath ".agent-runs\validation-runs"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$previousRunRefs = @(Get-ChildItem -LiteralPath $evidenceRoot -Directory | ForEach-Object { $_.Name } | Sort-Object)
$runId = [guid]::NewGuid().ToString("N")
$evidenceDirectory = Join-Path $evidenceRoot $runId
New-Item -ItemType Directory -Path $evidenceDirectory -ErrorAction Stop | Out-Null
$claimPath = Join-Path $evidenceDirectory "run.claim"
$claim = [System.IO.File]::Open($claimPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$claim.Dispose()

$sourceSha = (& git -C $RepositoryPath rev-parse HEAD 2>$null | Out-String).Trim()
$sourceTreeSha = (& git -C $RepositoryPath rev-parse "HEAD^{tree}" 2>$null | Out-String).Trim()
$sourceDiff = & git -C $RepositoryPath diff --binary HEAD 2>$null | Out-String
$sourceDiffSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($sourceDiff))).ToLowerInvariant()
$sourceDirty = -not [string]::IsNullOrWhiteSpace((& git -C $RepositoryPath status --porcelain=v1 --untracked-files=all 2>$null | Out-String))
$startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")

$results = @()
$logEvidence = @()
$allOutput = [System.Collections.Generic.List[string]]::new()
$allPassed = $true
$index = 0

Push-Location $RepositoryPath
try {
    foreach ($entry in $commands) {
        $index++
        $name = [string]$entry.name
        $command = [string]$entry.command
        $required = if ($null -eq $entry.required) { $true } else { [bool]$entry.required }

        if ([string]::IsNullOrWhiteSpace($command)) { continue }

        $safeName = ($name -replace '[^A-Za-z0-9._-]', '_')
        $logPath = Join-Path $evidenceDirectory ("validation-{0:D2}-{1}.log" -f $index, $safeName)
        $started = Get-Date

        Write-Host "Running [$name]: $command" -ForegroundColor Cyan

        $output = @()
        $exitCode = 0
        try {
            if ($env:OS -eq "Windows_NT") {
                $output = & $env:ComSpec /d /s /c $command 2>&1
            }
            else {
                $output = & /bin/sh -lc $command 2>&1
            }
            $exitCode = $LASTEXITCODE
        }
        catch {
            $output += $_.Exception.ToString()
            $exitCode = 1
        }

        $duration = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
        $logContent = @(
            "Command: $command"
            "Exit code: $exitCode"
            "Duration seconds: $duration"
            ""
            ($output | Out-String)
        ) -join [Environment]::NewLine
        $logBytes = [Text.UTF8Encoding]::new($false).GetBytes($logContent + [Environment]::NewLine)
        $logStream = [System.IO.File]::Open($logPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
        try { $logStream.Write($logBytes, 0, $logBytes.Length); $logStream.Flush($true) } finally { $logStream.Dispose() }
        $logSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($logBytes)).ToLowerInvariant()
        $logEvidence += [ordered]@{ path = $logPath; sha256 = $logSha256; exitCode = [int]$exitCode; required = $required }
        $allOutput.Add(($output | Out-String))

        $status = if ($exitCode -eq 0) { "pass" } else { "fail" }
        if ($required -and $exitCode -ne 0) { $allPassed = $false }

        $results += [ordered]@{
            name = $name
            status = $status
            command = $command
            exitCode = [int]$exitCode
            reason = if ($status -eq "fail") { "Command failed. See log." } else { $null }
            logPath = $logPath
            required = $required
            durationSeconds = $duration
        }
    }
}
finally {
    Pop-Location
}

$outputBytes = [Text.UTF8Encoding]::new($false).GetBytes(($allOutput -join [Environment]::NewLine))
$outputSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($outputBytes)).ToLowerInvariant()
$outputText = [Text.Encoding]::UTF8.GetString($outputBytes)
$summary = [ordered]@{
    tests = if ($outputText -match '(?m)^# tests\s+(\d+)\s*$') { [int]$Matches[1] } else { $null }
    passed = if ($outputText -match '(?m)^# pass\s+(\d+)\s*$') { [int]$Matches[1] } else { $null }
    failed = if ($outputText -match '(?m)^# fail\s+(\d+)\s*$') { [int]$Matches[1] } else { $null }
}
$completionDisposition = if ($allPassed) { "completed" } else { "blocked" }
$evidence = [ordered]@{
    runId = $runId
    startedAtUtc = $startedAtUtc
    completedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    sourceSha = $sourceSha
    sourceTreeSha = $sourceTreeSha
    sourceWorkingTreeDirty = $sourceDirty
    sourceDiffSha256 = $sourceDiffSha256
    exitCode = if ($allPassed) { 0 } else { 1 }
    requiredTestSummary = $summary
    outputSha256 = $outputSha256
    outputs = $logEvidence
    previousRunRefs = $previousRunRefs
    completionDisposition = $completionDisposition
}
$evidencePath = Join-Path $evidenceDirectory "run.json"
$evidenceBytes = [Text.UTF8Encoding]::new($false).GetBytes(($evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
$evidenceStream = [System.IO.File]::Open($evidencePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
try { $evidenceStream.Write($evidenceBytes, 0, $evidenceBytes.Length); $evidenceStream.Flush($true) } finally { $evidenceStream.Dispose() }
$evidenceSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($evidenceBytes)).ToLowerInvariant()

if ($results.Count -eq 0) {
    $results = @(
        [ordered]@{
            name = "project-validation"
            status = "not_applicable"
            command = $null
            exitCode = $null
            reason = "The project manifest defines no executable validation commands."
            logPath = $null
            required = $false
        }
    )
}

$receiptObject = Read-TriTierJsonFile -Path $ReceiptPath
if ($null -eq $receiptObject) {
    throw "Receipt not found or invalid: $ReceiptPath"
}
$receipt = ConvertTo-TriTierHashtable $receiptObject

Assert-TriTierSelectedTierImmutable `
    -Receipt $receipt `
    -RequestedTier $SelectedTier |
    Out-Null

$receipt.taskMode = "implementation"
$receipt.validations = $results
$receipt.validationRunId = $runId
$receipt.validationEvidencePath = $evidencePath
$receipt.validationEvidenceSha256 = $evidenceSha256
$receipt.acceptanceCriteriaMet = $allPassed
$receipt.completionStatus = if ($allPassed) { "completed" } else { "blocked" }
$receipt.humanApprovalRequired = [bool]$HumanApprovalRequired
$receipt.remainingRisks = @($RemainingRisks)

$allAgents = ConvertTo-TriTierAgentNameArray `
    -Value $receipt.agentsUsed `
    -RejectInvalid

if ($AgentsUsed.Count -gt 0) {
    $allAgents = ConvertTo-TriTierAgentNameArray `
        -Value (@($allAgents) + @($AgentsUsed)) `
        -RejectInvalid
}

$receipt.agentsUsed = $allAgents
$receipt.updatedAt = (Get-Date).ToUniversalTime().ToString("o")

Write-TriTierJsonFile -Path $ReceiptPath -Value $receipt

if (-not $allPassed) {
    Write-Error "One or more required project validations failed. Receipt: $ReceiptPath"
    exit 1
}

Write-Host "All required project validations passed. Evidence: $evidencePath" -ForegroundColor Green
