# CAT Sprint 9 — eligibility closure and judge-ready release

**Disposition: HUMAN REVIEW REQUIRED.** This is a local release handoff. Eligibility is not established. No inference POST, publication, deployment, upload, or Devpost submission occurred.

## Release identity and evidence

- Required source HEAD: `027d9aff1b103ec1eaa2ae03a552f8036e36ecbe` (tree `951beaa4d7542cdaf7976761d4851ddc223908b0`); branch `codex/cat-sprint7-competition-release`. The worktree was clean at intake; the Sprint 9 handoff itself is a local uncommitted documentation change.
- The static Console bundle was built from that HEAD at `.verification-runs/cat-console-static-30735008-b650-40f7-8f58-f4c0fc33a7f4`. Its manifest records 13 files and SHA-256/byte counts; manifest SHA-256 is `f8c5d2a173ff41afcc3f324ceeebba01f3c1998243c2451689c6af4673e62b7e`. Independent verification matched every listed file's bytes and SHA-256. Export reported `CAT_STATIC_CONSOLE=PASS`, source-bound P04 unavailable and omitted. The bundle is local and is not a public deployment.
- Required suite: the Sprint 9 project validator passed `npm run test` with 351 tests, 351 passed, 0 failed (290.72 seconds). Evidence is `.agent-runs/validation-runs/2367646db50f4ee6bd6eb1f02a6eecdf/run.json`; the run records HEAD/tree above, a dirty worktree due to this uncommitted handoff, and an empty tracked-diff hash. The active Tri-Tier receipt contains the same validation record.
- Sprint 8C recorded Docker permission failures for `cat:oracle` and `cat:sealed`; they did not produce fresh oracle/sealed results. P03 stays `HISTORICAL_INCOMPLETE`, the public oracle stays `WEAK`, P04 remains omitted from the public Console, and Candidate F was not executed.
- Model-list GET availability is not model inference. Recorded inference POST count is zero; sponsor feedback and endorsement are absent.

## Sponsor path and exact authorization still required

The existing implementation correctly fails closed before the provider POST. No authenticated owner signer, out-of-repository protected signing key, independently administered consume-once ledger, or verified Nebius account key custody is available in this checkout. A local JSON approval or `.consumed` marker cannot meet the trust or anti-rollback requirements. Do not weaken the guard.

**Preferred path if the owner already controls suitable infrastructure:** use an independently administered trusted executor. Its owner-controlled signer must sign one canonical, request-specific authorization; its public-key fingerprint must be anchored outside repository-controlled state. The executor must verify exact approved source commit/tree and implementation file hashes, canonical request bytes/hash, model, endpoint, account reference, operation ID, limits, expiry, and one-use authorization. Before network I/O, a separately controlled ledger must atomically reserve the authorization and reject concurrent/replayed use after local deletion, rollback, crash, or ambiguous response. Keep the Nebius key in the executor's secret store. Burn the authorization on any ambiguous attempt; do not retry. The local guard at `src/runtime/inference-authorization.ts` unconditionally throws `INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE`; Token Factory POST calls reach that authorization check before fetch in `src/runtime/nebius.ts`. Sol independently reran the focused forged/absent approval checks: 2 passed, 0 failed, with zero fetch attempts. Do not change these guards to make the demo appear live.

No such executor is provisioned or verified here. Running the application on Nebius AI Cloud with an NVIDIA open-source model is also only a candidate: it does not itself establish request-specific owner approval, protect a Nebius API key, or provide an independent atomic replay ledger. It would still need an externally controlled authorization/ledger boundary, and no actual cloud operation or eligibility approval is recorded. The checkout has no trusted-executor/deployment/ledger implementation, its `origin` is a local filesystem path, and the current branch has no matching remote-tracking revision to establish external source authority. The smaller credible plan is therefore to defer the call until the owner identifies and operates existing independently controlled signer/ledger infrastructure; do not build a new service in this sprint.

### One-request experiment packet

- Purpose: one sanitized node-cache zero-TTL repair proposal; only `_src/lib/node_cache.coffee` may be patched.
- Provider endpoint: `https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions`.
- Model: `nvidia/nemotron-3-super-120b-a12b`; refresh account-visible availability and pricing immediately before any future review.
- Method/count: exactly one POST, no retry. Strict JSON schema; sanitized request package at most 65,536 UTF-8 bytes; 180,000 ms timeout; at most 12,000 output tokens and 1 MiB response.
- Financial strategy B is selected, but it grants no spending permission. The old metadata-derived estimate was about `$0.0894432` for a context-sized input plus 12,000 output tokens; it is not a provider-enforced ceiling, can double-count context/output, and is not current billing evidence. The owner must recheck prices/limits and explicitly accept residual billing risk for this exact request.
- Still unset: final clean source SHA/tree and independently verified source authority, implementation hashes, non-secret account reference, operation UUID and authorization ID, exact body/package bytes and SHA-256, issue time/expiry (maximum 30 minutes), signer identity/fingerprint, and ledger reservation.
- Before any POST: generate and independently review the exact sanitized body from the final source; bind every field above; obtain a fresh request-specific signature and out-of-repository key; test the independent atomic ledger's replay, concurrency, rollback, deletion, crash, and ambiguous-response behavior; reserve once; only then may one call occur. None of these prerequisites is satisfied by the current packet. CAT must deterministically evaluate the actual returned proposal and retain the provider response, verification, usage, and uncertainty. Do not invent a successful repair or count discovery as inference.

## Regression-count change

Sprint 8B reported 353 tests and Sprint 8C reported 351. At commit `924eae292e78f74f3a1ebde886cb3faad2722c10` (`Fail closed on unauthenticated inference approvals`), `tests/core.test.ts` changed from five local-marker/consumption tests to three tests asserting fail-closed behavior: two tests cover locally writable/unsigned approval and one verifies both inference POST paths reject a forged approval before fetch. The five older cases were: concurrent one-use admission, request drift/partial marker, expired authorization, crash after consumption, and replay after local marker deletion/rollback. They are not behaviorally preserved as a local authorization feature; the code intentionally blocks that feature until authenticated external approval and durable independent consumption exist. The declaration count in this file is lower by two, matching the reported total reduction. The previous 353-test raw log/source run is absent and cannot be independently reconstructed, so the exact historical suite result remains reported evidence rather than a reproducible run. The current required suite is run separately by this Sprint 9 validator.

## Real visual acceptance and recording

The earlier permitted-browser attempt was blocked before a page was established; no screenshot or recording exists. Use the following owner-run procedure in an explicitly approved browser. Do not retry a route that the browser safety check has prohibited.

1. From the approved clean checkout, record `git rev-parse HEAD`, run `npm run cat:console`, and open `http://127.0.0.1:4173` in the approved browser. Capture real screenshots at 1280×800 (desktop), 768×1024 (tablet), 390×844 and 320×800 (mobile). Include active URL, dimensions and source SHA in the capture log.
2. At every size, verify the first screen explains CAT; navigate the V1/V2 comparison and each evidence/source link; tab through controls and verify visible focus; inspect missing/stale evidence messaging; check long hashes and code blocks; verify no horizontal overflow; and confirm no private data appears. Record pass/fail and a screenshot for each viewport. Do not describe this checklist as passed until the owner completes it.
3. Capture the existing 2:45 judge walkthrough from `docs/release/sprint-8b/judge-walkthrough.md` or the source script `docs/release/sprint-4/demo-script-2m50.md`. Use authentic product footage, captions, and an edit manifest. Show only recorded evidence. State that no inference POST occurred, P03 is incomplete, public oracle is weak, P04 is omitted, and no sponsor feedback or endorsement exists. Keep source footage and edit artifacts local until separately approved for upload.

Current status: no screenshots, captions, footage, or rendered video have been produced in this pass.

## Approved-source release and hosting

- The 13-file allowlisted static package is technically built and its export validation passed at the path above. Independently re-hash every listed file before deployment. It omits P04 because strict source verification is unavailable and includes no private annex or inference service.
- The repository source snapshot is not yet approved for public release. The MIT text and public README are candidates only. Owner confirmation is still required for contributor copyright authority, holder/year, fixture license gaps (`colors@0.6.2`, `dateformat@1.0.2-1.2.3`, `expresso@0.9.2`, `inherits@1.0.2`), third-party notices, fixture data/model terms, trademarks, and Git author metadata. Do not create a root license or assert rights on this evidence alone; preserve history.
- Existing Cloudflare Pages Direct Upload instructions are in `docs/release/sprint-7/static-hosting.md`. No Cloudflare project or account was used. After owner rights/host approval, deploy only the exact verified static directory; record deployment ID/URL and check headers, CSP, MIME, routes, refresh, source/hash links, cache behavior, no private/API paths, and all viewport states. The current bundle is ready for that owner-controlled next step, not deployed.

## Final Devpost copy — draft for owner review

**Title:** Counterfactual Acceptance Testing: Would the Wrong Product Pass?

**Pitch:** AI-generated code can pass tests and still violate approved behavior. CAT checks whether the acceptance standard can distinguish that plausible wrong behavior from the intended product.

**Description:** CAT starts with an approved behavior and asks whether existing acceptance evidence distinguishes it from consequential alternatives. In the recorded node-cache zero-TTL case, the historical ordinary suite accepted a finite-expiry survivor. Oracle V1 missed it because it did not observe expiry; V2 added that observation and rejected the survivor. The Console shows the recorded V1/V2 comparison and known-good, known-wrong, and equivalent controls. These results are case-bounded and hash-bound; they do not establish general correctness.

The product provides an offline Test Discrimination Summary, fixed recorded cases, and a source-bound static Console package. Models may propose changes, while constrained deterministic logic determines the acceptance outcome; `UNRESOLVED` and `UNSUPPORTED` remain valid. The recorded release made zero inference POSTs. Nebius model visibility was checked by read-only GET only. No sponsor feedback or endorsement is claimed.

**Limitations:** P03 is `HISTORICAL_INCOMPLETE`; the public oracle is `WEAK`; P04 is omitted from the public Console; Candidate F was not executed. No public deployment, source publication, video upload, or submission has occurred. The license/copyright and third-party notice review remains open. CAT does not claim `PROVEN`.

**Work disclosure:** Pre-hackathon work includes research, requirements, benchmark protocol, Behavioral IR/witness design, threat model, schemas/scaffolding, historical node-cache cases, DP05B freeze authority and controlled candidate artifact. Hackathon-period work in preserved history includes evaluator/replay/receipt implementation, provider integration and retry guard, regression stabilization, Console/static packaging, validation and submission preparation. The owner must verify the final dates and disclosure against official rules.

**Links:** Source, hosted Console, and video URLs are intentionally absent until rights review, capture, host approval, and publication authorization are complete. Sponsor feedback: none recorded.

## Friday runbook (all times IST, 2026-10-30)

**Before 12:00 PM freeze:** review this exact source SHA and validator evidence; resolve the test-count inventory; decide eligibility from official rules; complete browser/video capture; decide source rights/license/notices/history; refresh Nebius account model/pricing facts; and confirm whether the external signer/ledger already exists. Do not start another open-ended engineering program. If authorization infrastructure is absent, leave inference disabled and disclose the offline demo only if the rules permit it.

**At 12:00 PM:** freeze the candidate and record exact SHA/tree, source-cleanliness, bundle manifest and evidence. No elective code or evidence changes after freeze.

**After freeze through the 10:30 PM deadline:** revalidate the exact frozen source and bundle; if and only if separately approved, perform hosted route/header/hash and viewport checks; finalize captions/video and links; finish the eligibility checklist and disclosures; then obtain separate explicit approval before any provider POST, publication, deployment, upload, or Devpost submission. Record only actual actions and outcomes. If a prerequisite is missing, do not imply completion.

## Remaining blockers, ranked by eligibility and judging impact

1. **Eligibility-critical:** no request-specific owner authorization, external signer/key, independent consume-once ledger, exact request identity/body hash, protected provider key verification, or genuine sponsor inference/feedback. Do not POST.
2. **Judge experience:** no real viewport acceptance, screenshots, captions, authentic footage, or final video.
3. **Public demo:** static bundle is locally verified only; no approved host, hosted verification, or public URL.
4. **Source rights:** no owner-approved copyright/license, third-party notices, fixture-gap resolution, author-metadata publication choice, or approved source snapshot.
5. **Submission:** no official eligibility verdict, final approved evidence links, completed disclosure review, or submitted Devpost entry.
6. **Evidence limitations:** public oracle weak, P03 historical record incomplete, P04 omitted, Candidate F unexecuted, Docker oracle/sealed checks blocked; the 353-to-351 history delta needs exact inventory evidence.

## Regression inventory evidence

The parent and commit versions of `tests/core.test.ts` at `924eae2` were independently enumerated. Five prior authorization tests were removed and three fail-closed tests exist in the current version, for net −2 declarations. The earlier 353-count raw log was overwritten and is not available in Git; no claim is made that its execution can be reproduced. This source change is intentional security behavior, but it is not evidence that all other 8B cases were run in that historical execution.
