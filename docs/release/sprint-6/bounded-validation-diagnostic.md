# Sprint 6 bounded validation diagnostic

**Scope:** Explain the Sprint 5 restricted-run failure and record the authorized host run for Sprint 6. The two runs remain separate evidence.

## Runs

| Run | Boundary | Result | Evidence |
|---|---|---|---|
| Sprint 5 restricted runner | Project-bound child process with restricted local network and Docker access | `FAIL`, 35 failing tests, exit 1 after 294.775 s; not a timeout | `.agent-runs/01a180ee-83cd-7ec1-ac22-347e0b204dbd-01a180f3-5d87-7333-a34d-7e79edac7257/validation-4a96906d11a544bf8cc98ba12971aec1/01-test.stdout.log` |
| Sprint 6 native project validator | Approved native Windows host process, current `desktop-linux` Docker context | `PASS`, 344/344, 0 skipped, exit 0 in 336.34 s | `.agent-runs/validation-01-test.log`; result is in the active Sprint 6 receipt |

The restricted run used the same source SHA, `3bc98c7945ed629b35fa1c6606c4e98c9107615a`, that the Sprint 6 host validator tested. The restricted-run receipt belongs to the expired Sprint 5 turn and was not rewritten.

## Diagnostic matrix

| Candidate cause | Evidence | Finding |
|---|---|---|
| Source/product defect | Full native project validator passed the unmodified required `npm run test` command on the same SHA. Focused tests were not weakened. | No source defect is indicated by the observed failures. |
| Loopback access denied | Restricted-run `tests/evidence-console.test.ts` starts a server on `127.0.0.1` then receives `TypeError: fetch failed` across HTTP cases. The failure output contains no lower-level socket cause. The same suite passes natively. | Restricted-run local HTTP access was unavailable. Exact socket denial mechanism is not exposed by the test output. |
| Docker engine access denied | Restricted-run test 16 reports `permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`; real Docker tests 259–263 and calibrated evaluation test 265 fail. In the host shell, `docker context show` is `desktop-linux` and `docker info` reports Linux engine 29.8.0. | Docker Desktop is reachable from the host shell; the restricted validator child cannot access its named pipe. |
| Test timeout/resource failure | Restricted result records `timedOut=false`, `failureClass=NATIVE_CHILD_FAILURE`, exit 1 at 294.775 s. Native validation completes in 336.34 s. | Restricted run failed before its 300 s limit; it was not classified as a timeout. |
| Runner/descendant cleanup failure | Restricted result has `terminationAttempted=false`, `terminationConfirmed=true`, `descendantCleanupConfirmed=false`. No timeout or termination was attempted. | No orphan or failed termination is evidenced. The false descendant flag means cleanup was not confirmed; it does not establish a cleanup failure. |
| Unknown cause | Local `fetch` failures have no underlying `cause.code` in captured TAP output. | Exact local socket policy mechanism remains unknown. |

## Boundary comparison

- Host: Windows 10.0.26300, PowerShell 7.6.9, signed-in Windows user.
- Host `DOCKER_CONTEXT=desktop-linux`; `DOCKER_HOST`, proxy variables, and `NO_PROXY` were unset. `docker info` succeeded in the host shell.
- `docker context ls` showed the inactive `default` context at `npipe:////./pipe/docker_engine` unavailable and selected Docker Desktop `desktop-linux` active. The restricted test targeted the active `dockerDesktopLinuxEngine` pipe and was denied.
- The project-bound runner launched tests as a restricted child. Its result class was `NATIVE_CHILD_FAILURE`; TAP identifies the blocked Docker pipe and failed local HTTP fetches.
- The authorized native validator passed without source, test, manifest, sandbox or validation-command changes.

## Native permission-boundary correction

Run the repository validator from the approved Windows host context where the signed-in user can access the selected Docker Desktop `desktop-linux` context and local loopback sockets. Keep normal CAT candidate isolation (`--network=none`, read-only mounts, non-root UID, dropped capabilities). Do not pass the Docker socket into a candidate container or change project validation policy. If an organization requires the validator itself to run in a sandbox that denies loopback and the Docker named pipe, that sandbox needs an owner-approved per-job host-runner capability for these existing tests; do not weaken tests or sandbox isolation.
