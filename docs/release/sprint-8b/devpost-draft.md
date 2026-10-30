# Devpost draft — Counterfactual Acceptance Testing

**Draft only. Do not submit until the owner confirms eligibility, approves all links and disclosures, and accepts the remaining evidence gaps.**

## Title

Counterfactual Acceptance Testing: Would the Wrong Product Pass?

## Short pitch

AI-generated code can pass its tests and still violate approved behavior. CAT checks whether the acceptance standard itself can distinguish that wrong behavior from the intended product.

## Description

CAT starts from an approved behavior and asks which observation distinguishes it from a consequential wrong behavior. In the fresh H0-2 tenant-export run, the ordinary suite passes a cross-tenant bypass. CAT generates and executes `response === "DENY"`; the known-good and equivalent controls remain accepted while the survivor is rejected. The demonstration uses a bounded Node child-process runner, not Docker-sealed isolation.

CAT also has a second fresh process-controlled fixture for duplicate-operation idempotency; that contract is explicitly a synthetic draft. The node-cache zero-TTL result is separate historical evidence: V1 missed a finite-expiry survivor, and the bounded recorded V2 observation checked `expiresAt = 0`; no fresh node-cache replay is claimed.

The Evidence Console presents recorded, hash-bound evidence. CAT can report unresolved or unsupported outcomes; it does not prove general correctness. The public oracle remains weak and the demonstration is case-bounded.

## What is implemented

- A deterministic, constrained workflow that proposes and executes a missing observation against positive and negative controls. This differs from mutation scoring by explaining the behavioral observation that rejects a survivor, and from AI code review because deterministic CAT checks decide the bounded result.
- An offline Test Discrimination Summary and fixed public records.
- Source-bound static Console packaging and strict evidence projection.
- Optional structured Nebius repair proposals behind external one-use authorization. This release performed zero inference POSTs; model-list discovery is not live inference.

## Safety and limitations

Models may propose changes; constrained deterministic logic produces the final acceptance state. P03 remains `HISTORICAL_INCOMPLETE`; P04 is omitted from the public Console; Candidate F was not executed; the public oracle is `WEAK`. No public deployment, live sponsor inference, sponsor feedback, endorsement, or publication is claimed. Root license and copyright authority still require owner review.

## Evidence links (fill after owner approval)

- Source snapshot: `[OWNER-APPROVED PROVENANCE-LINKED SOURCE URL]`
- Hosted Console: `[OWNER-APPROVED HOSTED URL]`
- Walkthrough video: `[OWNER-APPROVED VIDEO URL]`
- Sponsor feedback: none recorded; do not imply endorsement.

## Walkthrough

Use the 2:45 [judge walkthrough](judge-walkthrough.md). Capture only the local recorded-evidence Console and preserve the limitations above in narration and captions.

## Significant-update disclosure

The work builds on pre-hackathon research, requirements, counterfactual design, benchmark protocol, historical node-cache examples, DP05B freeze authority, schemas and scaffolding. Hackathon-period work includes evaluator and receipt implementation, controlled replay tools, optional provider integration, Console packaging, validation and submission preparation. Confirm dates and final wording against the competition rules before submission.
