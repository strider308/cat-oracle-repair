# Counterfactual Acceptance Testing (CAT)

**Your tests passed. Would the wrong product have passed too?**

CAT checks whether acceptance evidence distinguishes approved behavior from plausible alternatives. The first demonstration is a fresh process-controlled H0-2 tenant-export case: the ordinary suite passes while a cross-tenant bypass survives; CAT derives and executes an oracle repair, preserving known-good and equivalent implementations while rejecting the survivor. A second fresh fixture exercises duplicate-operation idempotency; its contract is explicitly a synthetic draft. Both show ordinary-suite and proposed-assertion outcomes for positive and negative controls.

The historical node-cache zero-TTL case is separate. Its archived ordinary suite accepted a finite-expiry survivor, V1 did not observe expiry, and the bounded solver proposes `expiresAt = 0`. That is recorded historical evidence, not a fresh node-cache replay. P03 remains incomplete because its controller-runner artifact is missing.

CAT is a case-bounded acceptance-evidence tool. The bounded solver itself does not execute code, prove general correctness, or approve a proposed specification. A separate local child-process runner executes only the two self-owned fixtures; that boundary is process control, not Docker isolation. Models may suggest candidates; constrained deterministic checks produce each recorded outcome. `UNRESOLVED`, `UNSUPPORTED`, and `NO_SOLUTION` are valid outcomes.

## Run the recorded Console locally

Requirements: Node.js 22 or newer. From the repository root in PowerShell:

```powershell
npm ci --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite
npm run cat:oracle:repair
npm run cat:console:check
npm run cat:console
```

The Console is local at `http://127.0.0.1:4173`. The project has no root runtime dependencies; the locked fixture suite has its own dependencies. Docker is needed for the isolated oracle and sealed-evaluator commands (`npm run cat:oracle` and `npm run cat:sealed`). A local Docker permission failure does not establish a pass or fail result for those checks.

The required full-suite run on source commit `25974c3f857f58110a64f9452f04076cecd9d217` reported 305 passed, 35 failed, and 3 skipped. The 35 failures group as 26 local HTTP fetch failures, 7 Docker API access failures, 1 Windows junction permission failure, and 1 P03 calibration cascade after Docker precheck failure. The skips are symlink/junction operations unavailable on this host. The failures are unresolved environment restrictions, not a passing run; see `REPRODUCTION.md` and the ignored local receipt/log. The earlier 351/351 result applies only to application commit `027d9aff1b103ec1eaa2ae03a552f8036e36ecbe`. The ZIP excludes `.git` and ignored local P03 durable-evidence state, so it cannot independently reproduce all history-bound results.

The recorded Console does not call a model. This release made zero inference POSTs. It does not demonstrate live NVIDIA/Nebius model work; provider authorization and exact cost approval remain separate gates. Do not set or include provider credentials to reproduce the Console.

The source includes an offline Nemotron Oracle Observation Proposal preparation command (`npm run cat:oracle:observation:prepare`). It sends the approved H0-2 clause, original acceptance cases and four fixture-supported scenario options, but no repair assertion, control roles, or candidate outcomes. Nemotron may select a scenario and propose `response = ALLOW` or `DENY`; CAT checks the proposal against the contract and independently re-executes the selected scenario against all four implementations. Local simulated responses cover successful, irrelevant, contradictory and overstrict proposals and are labeled as simulations. Preparation does not contact Nebius or provide a provider response. The local repair preflight also builds the versioned v2 node-cache request while preserving all 15 file path, role, and hash bindings and omitting only four allowlisted generated file contents.

## Recorded limits

- The public oracle is `WEAK`; results are case-bounded.
- P03 is `HISTORICAL_INCOMPLETE`; its historical controller-runner artifact is missing.
- P04 is omitted from the public Console because strict current source verification is unavailable.
- Candidate F was not executed.
- No live sponsor inference, sponsor feedback, endorsement, public deployment, or submission is claimed.
- No root software license has been granted. See `LICENSE-DECISION-REGISTER.md` and `THIRD-PARTY-NOTICES-DRAFT.md`; both require owner review.

The release snapshot excludes Git history, `.codex`, ignored validation/export directories, local environment files, build output, recordings, generated evidence, and private evaluator/holdout data. It preserves the tracked historical P03 artifacts required by current tests and labels their incomplete status accurately.
