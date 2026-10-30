[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TargetRepoRoot,
    [Parameter(Mandatory = $true)][string]$FreezeCommit
)

$ErrorActionPreference = 'Stop'
if ($FreezeCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'FREEZE_COMMIT_SHA_REQUIRED' }
$TargetRepoRoot = [System.IO.Path]::GetFullPath($TargetRepoRoot)
$gitCommand = Get-Command git.exe -ErrorAction Stop
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$gitPath = $gitCommand.Source
$nodePath = $nodeCommand.Source
$runnerRoot = Join-Path $env:TEMP ('cat-freeze-runner-' + [guid]::NewGuid().ToString('N'))
$hooksRoot = Join-Path $env:TEMP ('cat-freeze-hooks-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $hooksRoot | Out-Null
New-Item -ItemType File -Path (Join-Path $hooksRoot 'empty-gitconfig') | Out-Null

$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = Join-Path $hooksRoot 'empty-gitconfig'
$env:GIT_TERMINAL_PROMPT = '0'
$env:CAT_TRUSTED_GIT_PATH = $gitPath
$env:CAT_TRUSTED_NODE_PATH = $nodePath
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
$env:NODE_EXTRA_CA_CERTS = $null
$env:NODE_V8_COVERAGE = $null
$env:NODE_REPL_EXTERNAL_MODULE = $null
$env:NODE_COMPILE_CACHE = $null

try {
    & $gitPath -C $TargetRepoRoot cat-file -e "$FreezeCommit^{commit}"
    if ($LASTEXITCODE -ne 0) { throw 'FREEZE_COMMIT_NOT_FOUND' }
    & $gitPath -C $TargetRepoRoot -c "core.hooksPath=$hooksRoot" -c core.autocrlf=false -c core.eol=lf worktree add --quiet --detach $runnerRoot $FreezeCommit
    if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_RUNNER_MATERIALIZATION_FAILED' }

    $actual = (& $gitPath -C $runnerRoot rev-parse HEAD).Trim()
    if ($actual -cne $FreezeCommit) { throw 'TRUSTED_RUNNER_HEAD_MISMATCH' }
    $runnerStatus = (& $gitPath -C $runnerRoot status --porcelain=v1 --untracked-files=no) -join "`n"
    if ($runnerStatus) { throw 'TRUSTED_RUNNER_DIRTY' }
    $stagedDiff = (& $gitPath -C $runnerRoot diff --cached --name-only HEAD --) -join "`n"
    if ($stagedDiff) { throw 'TRUSTED_RUNNER_STAGED_DIRTY' }

    $closurePath = Join-Path $runnerRoot 'benchmark\protocol\freeze-executable-closure-v2.json'
    $closure = Get-Content -LiteralPath $closurePath -Raw | ConvertFrom-Json
    foreach ($row in $closure.rows) {
        $sourcePath = Join-Path $runnerRoot ($row.path -replace '/', '\')
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'TRUSTED_RUNNER_CLOSURE_FILE_MISSING' }
        $hashLines = & certutil.exe -hashfile $sourcePath SHA256
        $hash = [string]($hashLines | Where-Object { $_ -match '^[A-Fa-f0-9]{64}$' } | Select-Object -First 1)
        $hash = $hash.ToLowerInvariant()
        if ($hash -cne $row.commitBlobSha256) { throw 'TRUSTED_RUNNER_CLOSURE_HASH_MISMATCH' }
    }

    $entrypoint = Join-Path $runnerRoot 'scripts\cat-trusted-freeze-runner-v2.ts'
    & $nodePath --experimental-strip-types $entrypoint --mode preflight --target-repo-root $TargetRepoRoot --freeze-commit $FreezeCommit
    if ($LASTEXITCODE -ne 0) { throw "TRUSTED_RUNNER_FAILED:$LASTEXITCODE" }
}
finally {
    if (Test-Path -LiteralPath $runnerRoot) {
        & $gitPath -C $TargetRepoRoot -c "core.hooksPath=$hooksRoot" worktree remove --force $runnerRoot 2>$null
    }
    & $gitPath -C $TargetRepoRoot -c "core.hooksPath=$hooksRoot" worktree prune 2>$null
    Remove-Item -LiteralPath $hooksRoot -Recurse -Force -ErrorAction SilentlyContinue
}
