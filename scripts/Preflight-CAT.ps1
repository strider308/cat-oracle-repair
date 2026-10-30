$ErrorActionPreference = 'Continue'

Write-Host 'Counterfactual Acceptance Testing — Environment Preflight' -ForegroundColor Cyan
Write-Host ''

$checks = @(
  @{ Name = 'Node';        Exe = 'node';   Args = @('--version') },
  @{ Name = 'npm';         Exe = 'npm';    Args = @('--version') },
  @{ Name = 'Git';         Exe = 'git';    Args = @('--version') },
  @{ Name = 'GitHub CLI';  Exe = 'gh';     Args = @('--version') },
  @{ Name = 'Docker';      Exe = 'docker'; Args = @('--version') },
  @{ Name = 'Python';      Exe = 'python'; Args = @('--version') },
  @{ Name = 'FFmpeg';      Exe = 'ffmpeg'; Args = @('-version') }
)

$failed = 0

foreach ($check in $checks) {
  Write-Host ("[{0}] " -f $check.Name) -NoNewline -ForegroundColor Yellow

  try {
    # Invoke the native executable directly and capture its exit code immediately.
    # Do not use Invoke-Expression here: $LASTEXITCODE can otherwise remain stale
    # from a prior native-command failure in the caller's PowerShell session.
    $output = & $check.Exe @($check.Args) 2>&1
    $exitCode = $LASTEXITCODE
    $firstLine = $output | Select-Object -First 1

    if ($exitCode -eq 0) {
      Write-Host $firstLine -ForegroundColor Green
    } else {
      Write-Host "FAILED (exit $exitCode): $firstLine" -ForegroundColor Red
      $failed++
    }
  } catch {
    Write-Host "NOT AVAILABLE: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
  }
}

Write-Host ''
Write-Host '[GitHub auth]' -ForegroundColor Yellow
try {
  $authOutput = & gh auth status 2>&1
  $authExitCode = $LASTEXITCODE
  $authOutput | ForEach-Object { Write-Host $_ }
  if ($authExitCode -ne 0) {
    Write-Host "GitHub auth FAILED (exit $authExitCode)" -ForegroundColor Red
    $failed++
  }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  $failed++
}

Write-Host ''
Write-Host '[Docker daemon]' -ForegroundColor Yellow
try {
  $dockerOutput = & docker info --format '{{.ServerVersion}}' 2>&1
  $dockerExitCode = $LASTEXITCODE
  if ($dockerExitCode -eq 0) {
    Write-Host $dockerOutput -ForegroundColor Green
  } else {
    Write-Host "FAILED (exit $dockerExitCode): $dockerOutput" -ForegroundColor Red
    $failed++
  }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  $failed++
}

Write-Host ''
if ($failed -eq 0) {
  Write-Host 'PREFLIGHT STATUS: PASS' -ForegroundColor Green
  exit 0
}

Write-Host "PREFLIGHT STATUS: FAIL ($failed check(s) need attention)" -ForegroundColor Red
exit 1
