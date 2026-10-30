# CAT Sprint 5 — Recovery, product work, and release evidence

**State: HUMAN REVIEW REQUIRED.** Sprint 5 work is local and unpublished. This report separates verified source behavior, recorded historical controls, fresh validation, and owner decisions.

## Recovery identity

- Working directory: `[local-repository-path redacted]`.
- Required release base: `32208efa9ec2a034431629af94bfd15f49870db5`.
- The active checkout began at that exact complete commit with a clean tree and remains distinct from the prior dirty checkout. Read-only verification found `<LOCAL_REPOSITORY_PATH>` still at `cec8054ba8690172a7b53267cc985a4445b7860b`, with 9 modified tracked files and 175 untracked paths; this work did not write to that checkout.
- DP05B freeze authority remains `5069680ff093695a227bf410eb3de88d99dce9e7`; the 21-file source and runtime identities remain `80424bd379df4a836680d5ca420289c7e080a24377e61947a393f01c08d0a8c1` and `fc594a965abb22c1542d7b887a8490244454d0c9ba51e16babeaeabf456e7621`.
- The historical release clone at `[owner-local-user-path redacted]\Documents\Codex\work\cat-s2-release` is at the required complete commit and branch `build/cat-sprint-2-authority-closure-20261027`; read-only status showed five pre-existing untracked paths, including the Sprint 3 replay report and Sprint 4B report/evidence summary. No changes were made there and no older public branch was substituted.
- The Sprint 3 replay report records 21/21 artifact byte equivalence, a 337/337 suite result, and no Candidate-F execution. The Sprint 4B evidence summary records the exact `32208efa9ec2a034431629af94bfd15f49870db5` source and 339/339 required-validator result. These are historical claims from the release clone, not fresh Sprint 5 validations. The current P03 receipt verifier still reports `HISTORICAL_INCOMPLETE` because `controller-runner` is missing from the receipt.

## Product outcome

The Console opens on the Test Discrimination Summary. Its first question is: **“Your tests passed. Would the wrong product have passed too?”** The report shows the approved zero-TTL behavior, the field omitted by V1, the field observed by V2, and four hash-bound historical controls:

| Control | Existing suite record | Oracle V1 | Oracle V2 | Evidence status |
|---|---:|---:|---:|---|
| Known wrong | PASS (8 tests) | FAIL | FAIL | Recorded historical artifact |
| Known good | Not recorded | PASS | PASS | Recorded historical artifact |
| Finite-expiry survivor | Not recorded | PASS | FAIL | Recorded historical artifact |
| Equivalent control | Not recorded | PASS | PASS | Recorded historical artifact |

The critical example is the finite-expiry survivor: it passes the original V1 oracle because V1 does not observe `expiresAt`, then V2 detects the wrong finite expiry. The other controls show the expected rejection, a compatible good behavior, and an equivalent behavior. These are historical, hash-bound outcomes; they are not fresh executions in Sprint 5.

The archived P03 summary reports 8/8 suite tests passing and recorded V1/V2 controls. Its receipt verifier returns `HISTORICAL_INCOMPLETE` because `controller-runner` is missing. The historical final oracle calibration is recorded as `CALIBRATED`; the current public oracle status remains `WEAK`. Do not use the archived calibration as a current or general effectiveness claim.

The static Console package includes a manifest, fixed shell assets, two public case projections, the summary, and six hash-bound public source artifacts. P04 stays omitted because strict source verification is unavailable. Browser rendering does not execute candidate code or contact a model.

## Validation evidence

- Historical Sprint 4B result: `339 passed / 0 failed / 0 skipped` at the exact source `32208efa9ec2a034431629af94bfd15f49870db5`, as recorded in the Sprint 4B authorized-evaluation report in the historical release clone. This remains historical evidence only and does not validate Sprint 5 changes.
- Sprint 5 exact-SHA required project validator (`npm run test`): `344 passed / 0 failed / 0 skipped` on commit `fa05fe0344d942f302fa023e752a69bc68c04d83`. This is before this report-only closeout edit; the validator will be rerun on the final committed SHA and the machine evidence will bind that SHA.
- Focused Console/evidence/dependency/provider checks passed before commit; these are development checks, not a substitute for the exact-SHA project validator.
- P03 public/sealed replay, external replay restoration, browser visual acceptance, hosted-header verification, and current provider model discovery are not implied by a unit-suite pass.

## Sprint 5 closeout status

| Required field | Result |
|---|---|
| `WORKSPACE` | `[local-repository-path redacted]` |
| `STARTING_SHA` | `32208efa9ec2a034431629af94bfd15f49870db5` |
| `ENDING_SHA` | Recorded in the final machine evidence; the report cannot contain its own commit SHA |
| `SOURCE_TREE_STATUS` | Clean at the validated commit; old dirty checkout and historical release clone were read-only |
| `COUNTERFACTUAL_REPORT_STATUS` | Complete locally; public oracle remains weak and P03 receipt remains `HISTORICAL_INCOMPLETE` |
| `TEST_DISCRIMINATION_STATUS` | Complete: known-wrong, known-good, finite-expiry survivor, and equivalent controls are hash-bound historical evidence; V1 misses the survivor and V2 detects it |
| `FULL_SUITE_RESULTS` | `npm run test`; final exact-SHA count is recorded in machine evidence |
| `ORACLE_AND_SEALED_STATUS` | Offline calibration and sealed-denial checks pass; calibration is case-bounded, public oracle remains weak |
| `PUBLIC_ORACLE_STATUS` | `WEAK` |
| `CANDIDATE_F_DEPENDENCY_SUCCESSOR` | Adversarially tested proposal only; historical freeze authority unchanged |
| `CANDIDATE_F_EXECUTIONS` | `0`; one-evaluation authorization unused |
| `NEMOTRON_MODEL_PREFLIGHT` | Exact model ID and request boundary prepared; fresh provider discovery still required |
| `SPEND_CAP_ENFORCEABILITY` | `$0.10` cap unverified and unenforceable in current integration |
| `PAID_INFERENCE_POST_COUNT` | `0` |
| `CONSOLE_READINESS` | Static package builds and verifies locally; P04 omitted; public hosting and responsive browser acceptance remain open |
| `SOURCE_ARCHIVE_STATUS` | Local source archive only; final SHA and archive hash recorded in machine evidence |
| `LICENSE_AND_HISTORY_STATUS` | Root license absent; six historical Gitleaks matches and author metadata require owner review; no history rewrite |
| `DEMO_ASSETS` | Demo script and shot list drafted; final capture not produced |
| `DEVPOST_READINESS` | Draft only; no submission or publication |
| `TRI_TIER_STATUS` | `HUMAN_REVIEW_REQUIRED`; implementation receipt and validation evidence recorded locally |
| `RELEASE_VERDICT` | Not ready for public release or submission |
| `HUMAN_DECISIONS_REQUIRED` | License/copyright; history/provenance disclosure; P03/P04 evidence requirement; provider cap and paid request; Candidate-F successor authority and evaluation; hosting/disclosure/video/Devpost approval |
| `NEXT_EXACT_ACTION` | Owner resolves those decisions; then regenerate reviewed public materials and revalidate the exact release commit before publishing |

## Nemotron readiness

The implementation now selects only `nvidia/nemotron-3-super-120b-a12b` when that exact model ID is returned by live discovery, and rejects request packages larger than 65,536 UTF-8 bytes before network I/O. The existing API boundary requires the approved Token Factory HTTPS host and the repair path disables DNS retries. No inference POST was issued.

The $0.10 ceiling remains **unenforceable and unverified**. A byte limit and `max_tokens` do not prove billed-token or account-spend limits. Readiness requires an independently verified provider/account hard cap of at most $0.10, exact endpoint/account confirmation, durable one-use authorization consumed before the POST, source/run/package binding, and a no-retry rule after ambiguous transport. Current model availability also needs a fresh read-only discovery. No such approval was exercised.

## Candidate-F dependency successor

`benchmark/protocol/candidate-f-dependency-closure-v2-proposal.json` records a proposal only. The testable checker derives the two runtime package roots from the exact lock metadata, inventories regular files with the existing `inventoryDependencyV1`, binds exact lock bytes, and requires exact sorted path/hash rows. It binds `lodash@4.18.1`, `clone@1.0.4`, nine visible lodash/clone specifiers, and builtin `events`. Adversarial tests cover lock mismatch, row order, unlisted files, changed bytes, package-version substitution, native add-ons, and symlinks where the platform permits.

The local generated dependency tree initially differed from the frozen inventory. It was backed up under `.verification-runs` and replaced with the exact 4,219-file tree from the read-only release clone; its `DependencyInventoryV1` hash now matches the frozen `a0923da0…` identity. The current receipt verifier still discovers loaded runtime paths through host `require.cache`; the proposal documents that as unsuitable future authority. No historical freeze, candidate hash, receipt, or one-evaluation authorization was changed or consumed. Candidate F was not evaluated.

## Submission and publication review

- Root `LICENSE` is absent. MIT is a prior recommendation only; the owner must select a license and confirm copyright authority before a license file is added.
- Git history contains author email metadata. No history rewrite or metadata-free export was performed. Owner must choose which provenance-preserving public history treatment is acceptable.
- The Git history scan found six `generic-api-key` matches in historical files: four synthetic test sentinels in `tests/core.test.ts` and two SHA-256 values in the archived P03 receipt. No live credential was identified. The exact final scan and locations are retained in the local machine evidence; rerun after any history or source change before publication.
- The existing draft attribution inventory is `docs/release/sprint-4/proposed-publication/THIRD-PARTY-NOTICES.md`. It records node-cache MIT notices and explicitly leaves repository-wide dependency, model, dataset and trademark review open.
- Devpost/demo materials are drafts. No public repository, host, YouTube video, or Devpost submission was published.
- Actual public-host headers, stable judge access, final screen capture, and owner-approved disclosures remain open.

## Severity-ranked open issues

| Severity | Issue | Current evidence | Next gate |
|---|---|---|---|
| P0 | No approved root license or public history treatment | Root `LICENSE` is absent; six historical Gitleaks matches and author metadata remain for owner review | Owner selects license and approves source/history disclosure |
| P0 | No verified $0.10 financial cap or one-use authorization | No hard provider/account cap is evidenced; no durable authorization is implemented; inference POST count is zero | Verify provider-enforced cap, account/endpoint and durable authorization, then separately approve one request |
| P0 | Historical P03 receipt is incomplete and current P04 is omitted | `controller-runner` is missing; strict current P04 verification is unavailable | Restore/verify the missing receipt artifact and decide whether P04 closure is a submission requirement |
| P0 | Public judge access and footage are not ready | Static package is local; no hosted-header check or final capture exists | Owner approves hosting and disclosures; capture the reviewed flow |
| P1 | Candidate-F dependency closure is not authoritative | The successor checker is adversarially tested as a proposal; frozen authority remains unchanged | Review exact lock/rows and separately approve an authority successor before any Candidate-F run |
| P1 | Public oracle remains weak | Historical V1/V2 discrimination controls are recorded; no current general calibration is claimed | Keep `PUBLIC_ORACLE_STATUS=WEAK`; obtain independent controls before stronger claims |

## Owner decisions required

1. Select the root license and confirm copyright/third-party notice authority.
2. Choose whether to publish existing author metadata or approve a provenance-linked metadata-free/squashed release archive.
3. Review the historical 21/21 replay claim, restore the missing `controller-runner` receipt evidence, and decide whether current P04 closure is required for submission.
4. If a paid Nemotron request is desired, verify a hard account/provider cap at or below $0.10, confirm exact account/model/endpoint, then separately approve a bound one-use request. No request is authorized by this report.
5. Separately authorize Candidate-F evaluation only after exact dependency rows and lock identity are recovered in the frozen authority environment.
6. Approve or decline public repository release, hosting, final Devpost wording, and video publication.

No submission, publication, deployment, paid inference, Candidate-F execution, or historical evidence rewriting occurred.
