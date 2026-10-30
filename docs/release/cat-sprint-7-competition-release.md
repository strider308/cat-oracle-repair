# CAT Sprint 7 — Competition release candidate

**Status: HUMAN REVIEW REQUIRED.** This is a local release-candidate package. No inference POST, publication, deployment, YouTube upload, Devpost submission, Candidate-F execution, or historical evidence rewrite occurred.

## Source and validation

- Starting SHA: `ee4344a1a5922f1af993aa1d6a36bf05c3ea90da`.
- Work branch: `codex/cat-sprint7-competition-release`.
- Ending SHA and final validation evidence: recorded in `.verification-runs/cat-sprint-7-final-evidence.json` after the release commit and required project validator.
- Historical Sprint 6 native suite result: 344/344 passed on the Sprint 6 SHA only. It does not validate Sprint 7 changes.
- Prior restricted validation failure remains historical evidence and is not overwritten.
- This source change makes the repair provider enforce one network attempt even when a caller omits transport options. V5 receipt verification now accepts exactly one inference attempt. Focused repair suite: 36 passed, 1 platform skip, 0 failed.

## Counterfactual product claim

CAT asks: **“Your tests passed. Would the wrong product have passed too?”** In the node-cache zero-TTL example, approved behavior preserves a value without expiry. The historical ordinary suite passed a known-wrong patch. V1 did not observe expiry and let a finite-expiry survivor pass; V2 observes expiry and rejects it. Known-good, known-wrong, and equivalent controls help show the scope and limits of the distinction. These records are source-bound and case-bounded. The public oracle remains **WEAK**; CAT does not prove correctness.

The existing Test Discrimination Summary remains the Console entry point. No broad Console redesign was made. P04 remains omitted from public projection: the Sprint 6 baseline's strict local receipt had a private annex, while the committed public-source binding points to a different unavailable receipt. That receipt is historical to the Sprint 6 source and is not evidence for this changed source. The private annex and raw receipt are not included in this package.

## Sponsor workflow and controls

- One read-only current model discovery completed on 2026-10-28. The exact ID `nvidia/nemotron-3-super-120b-a12b` was account-visible; the standard response did not provide pricing or limits.
- Official model-list documentation describes model availability; it does not establish current per-model pricing. Official billing documentation describes real-time debits and threshold-triggered automatic charging; no provider-enforced `$0.10` hard stop was verified.
- Inference POST count: **0**. Live sponsor result: **NOT_EXECUTED**. Mock responses do not count as sponsor usage.
- Provider code now forces DNS retries off for repair inference, and receipt verification refuses evidence claiming two network attempts.
- Durable owner authorization is **not implemented or issued**. The historical P05 implementation binding still names its original remote branch and exact remote-head contract; this Sprint 7 successor does not satisfy it. That gate remains intact. No one-use approval file exists.
- Before any future POST, the owner must select A/B/C in the financial decision pack, approve the exact final source and package identities, account reference, endpoint, model, expiry and residual billing risk, and separately authorize the one request. No authorization is implied here.

## Evidence status and eligibility

| Area | Sprint 7 status |
|---|---|
| Counterfactual demo | Ready as a recorded local case; P03 remains `HISTORICAL_INCOMPLETE`; public oracle `WEAK` |
| P04 public card | Omitted; strict local P04 receipt is not a public-safe source-bound projection |
| Nemotron model | Current GET: exact ID available; pricing/limits not refreshed by this endpoint |
| Sponsor inference | `NOT_EXECUTED`; zero POSTs |
| Financial control | `$0.10` hard limit unverified; owner choice A/B/C required |
| Candidate F | Zero executions; original authorization unused; no changed authority adopted |
| Browser/visual acceptance | Blocked: Codex Work local browser access is disabled; no screenshot testing performed |
| Video | Not produced; no authentic screen capture available |
| Source publication | Local only; public repository and history option require owner/legal review |
| License | No root license applied; candidate and attribution review remain subject to owner decision |
| Static host | Local allowlisted package can be built and hash-checked; no host selected, deployed or externally verified |
| Devpost | Evidence-accurate draft prepared; eligibility not demonstrated until sponsor-use and submission criteria are confirmed |

## Submission blockers, by severity

### Critical — owner decision or new capability required

1. Sponsor eligibility may require meaningful inference; none was executed. Choose whether to defer, retain the hard cap, or accept bounded residual billing risk. No choice is selected.
2. No durable one-use owner authorization exists, and P05's branch/remote-head binding rejects the Sprint 7 branch. A code/source-binding review and separate request-specific approval are required before any paid request.
3. Copyright authority, root license choice, fixture-package license gaps, third-party notices and history publication option remain unresolved.
4. No actual visual/browser acceptance or authentic demo video exists because the approved local browser path is unavailable.

### High — evidence limitation

5. P03 historical receipt remains incomplete; do not relabel it.
6. P04 remains absent from the public static Console; do not package the ignored receipt/private annex.
7. Public oracle remains WEAK and case-bounded. Do not claim formal correctness, general superiority or a benchmark score.
8. No public host exists, so hosted headers, routes, links, cache behavior and responsive rendering are unverified.

### Medium — release operations

9. Review the six prior history scanner matches and author metadata before choosing full-history publication or a provenance-linked source snapshot.
10. Confirm sponsor-rule eligibility, significant-update disclosure, public links and final Devpost fields during the submission sprint.

## Friday handoff

Use [the Friday submission runbook](cat-friday-submission-runbook.md). Review the [Nemotron financial decision pack](sprint-7-nemotron-financial-decision.md), [Console visual acceptance report](sprint-7-console-visual-acceptance.md), [source/license review](sprint-7-source-license-review.md), [Cloudflare Pages handoff](sprint-7/static-hosting.md), [Devpost draft](sprint-7/devpost-draft.md), and [eligibility checklist](sprint-7/eligibility-checklist.md). At the noon freeze, stop elective engineering and validate the exact owner-approved source. Do not publish, deploy, upload, or submit until the required separate approvals arrive.

## Release verdict

**HUMAN REVIEW REQUIRED — local engineering package prepared, competition submission not yet eligible/complete on available evidence.**

Owner decisions required: financial option A/B/C; whether sponsor use is mandatory; source publication/history option; license and copyright authority; whether P03/P04 limitations are acceptable; host and recording approvals; eligibility and disclosure confirmation.

Next exact action: choose A/B/C and resolve public-source/license ownership; then either defer sponsor inference explicitly or prepare a fresh exact-source authorization packet. In parallel, enable an authorized browser capture path and approve the publication plan.
