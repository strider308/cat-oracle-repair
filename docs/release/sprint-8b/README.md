# CAT Sprint 8B — implementation and submission preparation

**Status: HUMAN REVIEW REQUIRED.** This is a local candidate. No inference POST, public push, deployment, video upload, Devpost submission, license assertion, or historical evidence rewrite occurred.

## Implementation

- Both Token Factory inference POSTs pass through the shared one-use authorization gate in `src/runtime/nebius.ts`. It binds the committed source/tree, branch and matching remote head, runtime file hashes, purpose, operation ID, account reference, endpoint, model, exact request body and package hashes, byte count, expiry, timeout, token/response limits and Option B residual risk.
- The gate creates an exclusive consumption marker and flushes it before network I/O. A partial or existing marker is consumed. All POST retries are disabled centrally; a timeout or ambiguous response burns the authorization.
- Authorization records belong under ignored `.agent-runs/inference-authorizations/`. A proposal is pending until an owner fills the approval fields and confirms the exact operation. The helper does not create or approve a record.
- Local marker state is not deletion-resistant. The included adversarial test demonstrates replay after deletion or rollback. Independently administered append-only state is required before claiming that property.
- Historical P05 V1 and V5 verification remain unchanged. A separate V2 successor binding checks a clean tree, the chosen branch and remote URL/ref/head, closure hashes, and a matching owner approval object. It is not wired into the historical verifier and is not approved for execution.

## Release preparation

Reuse the Sprint 7 MIT candidate, publication README, static hosting handoff, eligibility checklist and Devpost draft. The source/license review remains open: copyright authority, fixture license gaps and upstream notices need owner review. The root `LICENSE` is still absent. No provenance-linked source snapshot or static package was published.

P03 remains `HISTORICAL_INCOMPLETE`, the public oracle remains `WEAK`, and P04 remains omitted. Candidate F was not run.

## Required owner decisions

1. Approve an exact source SHA/tree and remote authority for the V2 P05 successor.
2. Separately authorize one exact repair or smoke POST, with a non-secret account reference and explicit Option B risk acknowledgment. The prior strategic Option B selection alone is not request approval.
3. Confirm copyright authority, MIT grant, third-party notices and the provenance-linked publication plan.
4. Approve the hosting target, authentic recording process, eligibility disclosures and final Devpost links.

See the [P05 successor approval package](p05-successor-approval.md), [one-request approval proposal](one-request-financial-approval-proposal.md), [source and release readiness](publication-readiness.md), [judge walkthrough](judge-walkthrough.md), [Devpost draft](devpost-draft.md), and [viewport/video procedure](viewport-video-procedure.md).
