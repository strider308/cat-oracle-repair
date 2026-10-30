# CAT DP05A: Historical Single-Case Protocol Record

**Current benchmark status: REDESIGN IN PROGRESS — RESULTS NOT STARTED.**

The originally proposed historical comparison was abandoned before baseline execution because the exact historical candidate bytes could not be recovered and therefore could not be supplied identically to every baseline. No baseline was executed. The DP05A protocol below is retained as a historical record only; it is superseded and was never frozen for competitive execution.

The replacement is a one-case controlled challenge for a newly generated, byte-reproducible candidate. Historical CAT evidence remains a product demonstration and is not the replacement benchmark's B4 result. The historical candidate bytes and patch/result bytes were not recovered, and the old case is not a direct baseline input.

## CAT input compatibility preflight

Static inspection found that `npm run cat:hero` calls `runP03Hero()` and loads the fixed `fixtures/hero/node-cache-ttl-zero-001/manifest.json`; it evaluates built-in P03 cases and is not the external DP05B entrypoint. The frozen `scripts/cat-subject.ts` entrypoint accepts the controlled candidate bundle and validates it with `verifyControlledCandidate` before evaluating it. That CLI proceeds directly from verification into execution, so it must not be used for a non-executing readiness check. The verifier may be invoked directly from the exact frozen worktree to confirm source/runtime bindings and reproducible builds without running the candidate. No CAT semantic evaluation of a new candidate was run.

**Preflight result: `CONTROLLED_SUBJECT_ADAPTER_AVAILABLE`.** `npm run cat:hero` remains built-in P03 only; external DP05B evaluation requires the controlled `scripts/cat-subject.ts` path and all of its frozen controls. This documents interface availability, not authorization to evaluate.

## Question and scope

For the canonical `node-cache-ttl-zero-001` case, which evaluation approaches identify the material behavioral contradiction before acceptance? This is one case, not evidence of general superiority over any baseline.

The historical CAT product evidence is `fixtures/public-evidence/node-cache-ttl-zero-001.rejected.json` (SHA256 `dd9539a1663d29b01abfc0edf5f8bddf202b7830d05730a1db946e259269ce6a`), with decision `REJECTED`. It records candidate and patch hashes, but the candidate hash algorithm/scope and the source and patch bytes are unavailable. At the owner's direction, B1's historical proposed packet uses the checked-in `survivor-S1` fixture as a surrogate review target. Its file SHA256 differs from the recorded historical candidate hash; because the recorded algorithm and scope are unspecified, identity cannot be established. This packet cannot support a direct same-candidate comparison with a future B4. The historical B0 and B2 proposals likewise cannot be compared honestly to that CAT evidence.

## Proposed DP05A lanes (never executed)

| Lane | Procedure | Frozen outcome limits |
| --- | --- | --- |
| `B0_EXISTING_CI` | The proposed input was the existing node-cache 3.2.1 build and eight-test Expresso suite. Add no tests. | `NOT_AVAILABLE_FOR_CAT_CANDIDATE` because the historical candidate bytes are unavailable. |
| `B1_INDEPENDENT_AGENT_REVIEW` | Prepare the manifest-listed surrogate packet and fixed neutral instructions. Do not execute the reviewer during DP05A. | The packet is not the CAT candidate; no direct B1-to-B4 comparison is valid. |
| `B2_GENERATED_TESTS` | Use only `benchmark/packets/b2-generated-tests/` and its fixed instructions. Freeze a limit of five tests, a 300-second generation budget, and no network. Do not generate or run tests during DP05A. | `NOT_AVAILABLE_FOR_CAT_CANDIDATE` until the candidate bytes and identity are recovered. |
| `B3_MUTATION_PROPERTY` | No applicable mutation/property-testing mechanism is present in the frozen repository or declared dependencies. | `NOT_AVAILABLE_IN_FROZEN_REPOSITORY`; do not substitute a bespoke mutation loop or add a dependency. |
| `B4_CAT` | The old proposal referred to the existing immutable rejected public evidence and its verified repository contract. | Historical product evidence only; it is not a new baseline execution or a future DP05B result. |

No baseline lane has been executed in DP05A. B1's packet is a review input, not a reviewer result.

## Information boundary

`benchmark/protocol/information-boundary-v1.json` is the machine-readable boundary. B0-B3 cannot see CAT verdicts, CAT witness, CAT public evidence, hidden/sealed contents, expected benchmark outcome, or another lane's results. B4 alone may read the specified public rejected fixture. Hidden and sealed challenge contents are not included in any packet. A result claiming forbidden access is invalid.

The B1 packet contains only its manifest-listed candidate artifact and public review context. It excludes CAT evidence and witness files. The protocol records its candidate artifact hash and the explicit mismatch with the CAT candidate hash. Do not treat the packet's candidate as the CAT candidate.

## Outcome criteria

- `DETECTED`: the lane independently identifies that `ttl(key, 0)` on an existing entry must preserve the entry without expiry, while the reviewed candidate can return success and remove it.
- `NOT_DETECTED`: the lane accepts the candidate, misses this behavior, gives only generic concerns, or does not identify the material contradiction.
- `INCONCLUSIVE`: the lane cannot complete for an operational reason and has no valid semantic determination.

Operational errors are never `NOT_DETECTED`. Reviewer uncertainty is not `DETECTED` unless the stated behavior is identified with enough specificity to distinguish it from generic suspicion.

The independent reviewer may propose findings and a structured decision, but its output does not bind `semanticOutcome`. A human adjudicator applies the frozen criterion to the preserved response for B1; the result records that adjudication and its evidence hash. B0 and B2 outcomes are derived from their deterministic test criteria. A B1 outcome therefore requires human judgment.

## Result records and comparison

`benchmark/schemas/single-case-result-v1.schema.json` defines the versioned result record. It distinguishes unavailable lanes from operationally inconclusive runs and CAT's binding to existing evidence. Canonical JSON sorts object keys recursively, preserves array order, uses UTF-8, and ends with one newline before SHA256. The result integrity hash is calculated over the canonical record with `integrity.resultSha256` omitted. Lane-specific fields may be absent when not applicable; fabricated measurements are not permitted.

The comparison columns are: `LANE`, `COMPLETED`, `SEMANTIC_OUTCOME`, `MATERIAL_DEFECT_IDENTIFIED`, `EXISTING_GREEN_CI_OVERRIDDEN`, `ADDITIONAL_TESTS_REQUIRED`, `HIDDEN_EVIDENCE_REQUIRED`, `HUMAN_JUDGMENT_REQUIRED`, `OPERATIONAL_FAILURE`, `TIME_SECONDS`, `ARTIFACT_COUNT`, `REPRODUCIBLE`, and `NOTES`. Do not combine them into a weighted winner score.

## Retry and anti-cherry-picking rules

One retry is allowed only after a documented operational failure. Preserve the failed attempt and its reason. A successfully completed semantic result is never rerun for selection. Do not substitute the case, change prompts, inputs, criteria, thresholds, or lane procedures after protocol freeze. Do not leak hidden evidence or select a favorable rerun.

## Provenance field note

`PublicEvidenceV1.inference.proven` remains unchanged for V1 compatibility. It means only that request/provider inference provenance was verified against recorded provider, model, request, and network evidence. It says nothing about candidate correctness, behavior, safety, or acceptance. Do not rename it or create V2 for this cleanup.

## Historical record


## DP05B controlled subject freeze (R2C)

Node v22's permission model was rejected as a malicious-code isolation boundary. This protocol does not add an external hostile-code sandbox and does not approve arbitrary external subjects. For DP05, the subject is a controlled deterministic specimen derived from the checked-in `node-cache` 4.0.0 source tree. Malicious-code isolation is not claimed.

The pre-candidate profile is [`controlled-subject-profile-v1.json`](../benchmark/protocol/controlled-subject-profile-v1.json), with schema [`controlled-subject-profile-v1.schema.json`](../benchmark/schemas/controlled-subject-profile-v1.schema.json). It explicitly sets `maliciousCodeIsolationClaim: false`. The only mutation is specified in [`controlled-mutation-spec-v1.json`](../benchmark/protocol/controlled-mutation-spec-v1.json): change the existing TTL zero comparison from `>= 0` to `> 0` in `_src/lib/node_cache.coffee`, with exactly one text match and no alternative or fallback. This means `TTL_ZERO_DELETES_EXISTING_ENTRY`: the zero-TTL branch reaches `del()`, updates deletion-related cache statistics, and emits the existing `del` event. Those are expected consequences of the frozen deletion behavior, not expiration. The approved behavior preserves the existing value without expiry; the controlled specimen deletes it. The spec has no expected decision, lane result, winner, or score.

The base source identity covers the complete seven-file tree. Its runtime identity is the two files `index.js` and `lib/node_cache.js`, emitted from the source tree by the pinned Grunt build and fixed banner normalization. Dependency identity separately binds the fixture lockfile and the sorted recursive inventory under `suite/node_modules`. The local Docker settings are identified as `LOCAL_CONTAINER_EXECUTION_BOUNDARY`; this is not a malicious-code sandbox or production isolation certification. Controlled invocation requires the future owner's full freeze commit SHA, the exact source delta, generation evidence, challenge manifest, and an independent source-to-runtime rebuild before P03 evaluation. Generic A2 evaluator calls remain usable only through the explicit infrastructure-test mode.

This section records the pre-generation state at the time of its original review: the pre-candidate freeze manifest was not frozen, the deterministic generator had not run on the real mutation, and no DP05B candidate or result existed then. The later DP05B generation authority is `5069680ff093695a227bf410eb3de88d99dce9e7`; the candidate artifact is committed at `cec8054ba8690172a7b53267cc985a4445b7860b`. No evaluation lane or competitive result has run.

The generator and controlled gate require a full `freezeCommitSha`, load canonical controls from that Git commit, and independently rebuild runtime from supplied source before acceptance. The revised [`controlled-profile-acceptance-matrix-v1.json`](../benchmark/protocol/controlled-profile-acceptance-matrix-v1.json) records evidence-backed requirements separately from sandbox claims. Arbitrary hostile loader escape, child-process escape, and worker escape remain out of scope. B0, B1, B2, and B4 must bind the same `SingleCaseProtocolV2` identity tuple. Candidate absence is asserted at the generation-authority commit; candidate presence and bindings are asserted at the artifact commit. Competitive results do not exist.

The generation-authority commit binds the protocol, profile, build, specification, schemas, and complete repository-owned executable module closure used by controlled generation and validation. The versioned closure hashes every statically reachable local module from the generator, gate, and P03 subject entrypoints; Node builtins and the fixture dependency tree remain governed separately. The artifact commit records the generated candidate; this authority does not authorize evaluation.

## DP05B freeze authority supersession (F2I)

The pre-candidate freeze commit `cd272debfde43ea3dfbdb39b16a47b97341e0218` is `INVALID_BEFORE_GENERATION`. Its worktree-derived executable closure identities did not equal the raw Git blob bytes for `src/core/receipt.ts` and `src/core/result.ts`. Generation was not started, no candidate was created, and no results were observed. The immutable record is [`freeze-authority-supersession-v1.json`](../benchmark/protocol/freeze-authority-supersession-v1.json); the V1 freeze documents remain preserved for historical audit.

Freeze Authority V2 is implemented and ready for owner audit, but it is not frozen. Git commit blobs define authority; [`cat-prepare-freeze-authority-v2.ts`](../scripts/cat-prepare-freeze-authority-v2.ts) models the future tree with a temporary Git index and private object directory. The loader discovers imports from committed blobs and permits exact bytes or CRLF-to-LF checkout normalization (`CRLF_TO_LF_V1`). Custom clean filters and `working-tree-encoding` are rejected. The committed `.gitattributes` blob is bound as an authority-support artifact.

The trusted launch path is `TrustedCommittedRunnerV1`: the host materializes a detached worktree from the exact full freeze commit SHA, verifies its `HEAD`, clean tracked state, and every executable-closure file hash before starting Node, then runs [`cat-trusted-freeze-runner-v2.ts`](../scripts/cat-trusted-freeze-runner-v2.ts) from that worktree. The runner passes the target repository root separately. The target worktree remains subject to V2 commit-authority, executable-closure, dependency, base-source, output-path, and worktree-equivalence checks. Preflight emits a `TrustedRunnerPreflightV1` JSON receipt and does not copy source, apply the mutation, build, create a challenge manifest, or run any evaluation lane. Generate mode repeats preflight in-process immediately before calling the existing generator; the receipt is audit evidence, not authorization.

## DP05B generation-contract supersession (G0R)

Freeze `75f8b6ad870c3f385f793d5c77a44b3301d1cc8e` remains `AUTHORITY_VALID`; its generator contract was incomplete before generation because it did not emit independently derived source roots and full-generation reproducibility evidence. The generator was not invoked, the real mutation was not executed, no candidate or results were created, and no evaluation lanes ran. The immutable record [`generation-contract-supersession-v1.json`](../benchmark/protocol/generation-contract-supersession-v1.json) records `SUPERSEDED_BEFORE_GENERATION` with `successorFreezeCommitSha: null`.

The successor requires `ControlledGenerationEvidenceV2` and two independent derivations from the frozen base. Each derivation retains the existing two-build byte check; the generator then compares source bytes, runtime bytes, change bindings, and canonical full-generation identities before atomically persisting one candidate bundle with the reproduction source/runtime tree. The verifier recomputes those claims and rebuilds from both persisted source trees. `ControlledGenerationEvidenceV1` remains historical only. This preparation preceded the candidate artifact; it does not authorize evaluation, freeze commit, or push.

The authority flow is:

```text
owner-approved freeze commit
  -> detached trusted runner worktree
  -> committed V2 verifier and generator code
  -> separately supplied target repository authority and worktree checks
  -> candidate generation (future generate mode only)
```

For an owner-auditable host invocation, use a PowerShell session and set the reviewed 40-hex SHA explicitly. The checked-in PowerShell launcher is a convenience wrapper when called from a mutable checkout; the equivalent host bootstrap below is the authoritative sequence and depends only on host PowerShell, Git, and Node:

```powershell
$repo = '<LOCAL_REPOSITORY_PATH>'
$freeze = '<40_HEX_FREEZE_SHA>'
$git = (Get-Command git.exe).Source
$node = (Get-Command node.exe).Source
$runner = Join-Path $env:TEMP ('cat-freeze-runner-' + [guid]::NewGuid().ToString('N'))
$hooks = Join-Path $env:TEMP ('cat-freeze-hooks-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $hooks | Out-Null
$emptyConfig = Join-Path $hooks 'empty-gitconfig'
New-Item -ItemType File $emptyConfig | Out-Null
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = $emptyConfig
$env:GIT_TERMINAL_PROMPT = '0'
$env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
$env:NODE_EXTRA_CA_CERTS = $null; $env:NODE_REPL_EXTERNAL_MODULE = $null
$env:NODE_V8_COVERAGE = $null; $env:NODE_COMPILE_CACHE = $null
try {
    & $git -C $repo cat-file -e "$freeze^{commit}"
    if ($LASTEXITCODE -ne 0) { throw 'FREEZE_COMMIT_NOT_FOUND' }
    & $git -C $repo -c "core.hooksPath=$hooks" -c core.autocrlf=false -c core.eol=lf worktree add --quiet --detach $runner $freeze
    if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_RUNNER_MATERIALIZATION_FAILED' }
    if ((& $git -C $runner rev-parse HEAD).Trim() -cne $freeze) { throw 'TRUSTED_RUNNER_HEAD_MISMATCH' }
    $runnerStatus = (& $git -C $runner status --porcelain=v1 --untracked-files=no) -join "`n"
    if ($runnerStatus) { throw 'TRUSTED_RUNNER_DIRTY' }
    $closure = Get-Content (Join-Path $runner 'benchmark\protocol\freeze-executable-closure-v2.json') -Raw | ConvertFrom-Json
    foreach ($row in $closure.rows) {
        $file = Join-Path $runner ($row.path -replace '/', '\\')
        $hashLines = & certutil.exe -hashfile $file SHA256
        $hash = [string]($hashLines | Where-Object { $_ -match '^[A-Fa-f0-9]{64}$' } | Select-Object -First 1)
        if ($hash.ToLowerInvariant() -cne $row.commitBlobSha256) { throw 'TRUSTED_RUNNER_CLOSURE_HASH_MISMATCH' }
    }
    $env:CAT_TRUSTED_GIT_PATH = $git
    $env:CAT_TRUSTED_NODE_PATH = $node
    & $node --experimental-strip-types (Join-Path $runner 'scripts\cat-trusted-freeze-runner-v2.ts') `
      --mode preflight --target-repo-root $repo --freeze-commit $freeze
    if ($LASTEXITCODE -ne 0) { throw 'TRUSTED_RUNNER_FAILED' }
}
finally {
    if (Test-Path $runner) { & $git -C $repo -c "core.hooksPath=$hooks" worktree remove --force $runner }
    & $git -C $repo -c "core.hooksPath=$hooks" worktree prune
    Remove-Item $hooks -Recurse -Force -ErrorAction SilentlyContinue
}
```

The builder checkout is not verifier execution authority. The host must use owner-reviewed Git and Node executables and a controlled environment; Git, Node, OS, and filesystem remain part of the trusted computing base. CAT does not claim protection against their compromise or against malicious candidate-code execution. It does not claim a cryptographically secure sandbox, tamper proofing, or formal verification. Temporary worktree registration is an allowed side effect and is removed on handled completion/failure; process termination or host failure can interrupt cleanup, so owners should inspect `git worktree list --porcelain` after abnormal termination. The generator still reads target base/dependency trees after checking their identities; do not run it in an environment with a concurrent hostile writer to those inputs.

The future owner freeze SHA remains unset until an owner-approved successor commit exists. No candidate generation or lane execution is implied by preflight.
