# CAT Sprint 6 — Final acceptance, sponsor eligibility and submission closure

**Release verdict: HUMAN REVIEW REQUIRED.** This is an owner-review package. No public push, deployment, upload, paid inference, Devpost submission, history rewrite or Candidate-F execution occurred.

## Release identity and validation

- Required starting SHA: `3bc98c7945ed629b35fa1c6606c4e98c9107615a`.
- Ending SHA and exact changed-file list: in `.verification-runs/cat-sprint-6-final-evidence.json` after the final commit.
- Native project validator passed the unmodified required `npm run test`: **344/344, 0 failed, 0 skipped**, on the unchanged starting SHA. Duration: 336.34 seconds. The final docs-only successor commit will be validated again.
- The prior restricted child run remains a distinct failure: 35 failing tests, local HTTP `fetch failed`, Docker named-pipe denial, exit 1 at 294.775 seconds, not a timeout. See [bounded validation diagnostic](sprint-6/bounded-validation-diagnostic.md).
- Historical Sprint 4B `339/339` at `32208efa9ec2a034431629af94bfd15f49870db5` remains historical only; it does not validate this source.

## Product acceptance

The Test Discrimination Summary remains the first Console view. Its central result is clear: historical ordinary tests passed a known-wrong patch; V1 misses the finite-expiry survivor; V2 detects it. Fresh local `npm run cat:oracle` and `npm run cat:sealed` controls passed on the final source: the V1 survivor failed V2, known-good/equivalent controls passed, and sealed S2 failed its holdout. Generated receipts and the private annex stay ignored locally. The historical P03 receipt remains incomplete; the static Console still omits P04 because its committed public-source binding targets an unavailable receipt. The public oracle stays `WEAK`; CAT does not claim correctness.

The static Console package is local and manifest-verified. Fresh strict P04 verification passes locally, but the static package still omits its accepted-control card because the committed public-source binding points to an unavailable receipt; the generated private annex remains local. CSS declares desktop, tablet and narrow-mobile breakpoints, keyboard focus and reduced-motion rules; source review and tests cover routes/headers. Actual desktop, tablet, 390 px and 320 px screenshot acceptance, keyboard visual pass, hosted-header checks and raw video are unavailable because local browser use is disabled in current Codex Work settings. No screenshots or video were fabricated.

## Sponsor model and financial status

Two read-only model-list GET requests on October 28, 2026 confirmed `nvidia/nemotron-3-super-120b-a12b` in the account-visible catalog. The verbose model record reported context length 262,144 and current prompt/completion prices of `$0.0000003`/`$0.0000009` per token. CAT issued **0 Sprint 6 inference POSTs**. An older public-evidence derivative attributes a historical inference, but its original receipt is marked malformed/recovered and is not counted as independently verified sponsor usage. A conservative metadata-based usage envelope (262,144 input plus 12,000 output tokens) estimates `$0.0894432`, before taxes or other account charges. The 65,536-byte package limit alone does not establish token cost.

No provider/account hard-spend stop of `$0.10` was independently verified. Official billing documentation describes balance debits and threshold-triggered automatic charging; it does not establish a per-request or account hard spend cap. Sponsor eligibility requiring meaningful model usage is therefore **not demonstrated**. Owner choices A/B/C are in the [one-request approval pack](sprint-6/nemotron-one-request-approval.md); none is selected here.

## P03 and Candidate F

- P03 remains `HISTORICAL_INCOMPLETE`; expected SHA `f29e04e2c5ab8daee8b487adaa2868f319d9a6ffc9c70d7484cce1aca6041e36` was absent from the three available Git-history versions of its expected source path, and the existing recovery inventory records no exact match. No substitute was copied. See [P03 evidence status](sprint-6/p03-evidence-status.md).
- Candidate F executions: `0`. The original one-evaluation authorization remains unused. DP05B freeze commit `5069680ff093695a227bf410eb3de88d99dce9e7`, source candidate SHA `80424bd379df4a836680d5ca420289c7e080a24377e61947a393f01c08d0a8c1`, and runtime candidate SHA `fc594a965abb22c1542d7b887a8490244454d0c9ba51e16babeaeabf456e7621` remain unchanged.
- The successor remains proposal-only. Exact 1,057-file package-root closure hash: `2ed00926190bce0bc8b335b3d5f33bb64ac3674c43c852162fcd922085ec7f8f`; full path/hash rows remain in ignored local evidence. See [Candidate-F authority decision](sprint-6/candidate-f-authority-decision.md).

## Source, license and publication status

The source archive and static bundle are local. The history scan reports six historical pattern matches; no live credential was identified. The license/provenance review records dependency metadata and two feasible publication approaches; neither is approved. See [license and provenance decision pack](sprint-6/license-provenance-decision.md).

Devpost copy and judge tour are prepared locally. No public GitHub URL, hosted Console URL, YouTube URL or submission URL exists. The [host/deploy checklist](sprint-6/host-deploy-checklist.md) contains remaining technical checks.

## Human decisions required

1. Confirm copyright authority and select a root license; resolve four fixture packages without declared license metadata and complete notices review.
2. Approve either history-preserving publication with author metadata or a provenance-linked source snapshot; review all six scanner findings.
3. Decide whether the incomplete historical P03 receipt is acceptable or identify a trusted backup source with the exact bytes; decide whether P04 closure is a submission requirement.
4. Choose A, B or C in the Nemotron pack. A paid inference POST requires separate approval bound to the then-current SHA, account, endpoint, model, package hash, constraints and one-use authorization.
5. Decide whether any Candidate-F successor may become authority; do not use the proposal for evaluation without separate authority.
6. Approve hosting, disclosures, screenshots/video, public source release and Devpost submission.

## Exact next actions

1. Resolve the six owner decisions above.
2. If a live model demonstration is required, recheck availability/prices, verify an acceptable billing bound, prepare one-use authorization, and obtain separate approval before one inference POST.
3. Enable an authorized browser route; run the viewports and capture real screenshots/raw video. Verify host headers only after an owner-approved deployment plan.
4. Publish only after source/license/attribution and sponsor-eligibility decisions are accepted. Do not promote historical evidence, public-oracle WEAK, or P03/P04 status without new evidence.
