# Devpost draft — Counterfactual Acceptance Testing

**Draft only. Do not submit until the owner confirms eligibility and approves the final links/disclosures.**

## Title

Counterfactual Acceptance Testing: Would the Wrong Product Pass?

## Short pitch

AI-generated code can pass its tests and still violate the behavior people approved. CAT independently tests whether the acceptance standard itself can distinguish that wrong behavior from the intended product.

## Description

CAT starts with an approved behavior and constructs plausible alternatives that should be rejected. In our node-cache zero-TTL case, the historical ordinary suite passed a known-wrong implementation. Oracle V1 did not observe `expiresAt`, so a finite-expiry survivor passed. Oracle V2 added that observation and rejected it. Known-good, known-wrong and equivalent controls show what the result does and does not mean.

The Console displays source-bound, recorded evidence. CAT reports evidence gaps and can abstain; it does not prove general correctness. The public oracle remains WEAK and the demonstrated case is bounded.

## What is implemented

- A deterministic, constrained acceptance workflow for testing whether approved behavior is distinguishable from plausible counterfactuals.
- An offline Test Discrimination Summary with known-good, known-wrong, finite-expiry survivor and equivalent controls.
- Hash-bound public sources and a static Console package.
- Optional structured Nebius/NVIDIA repair proposal integration. A fresh read-only model-list GET confirmed exact model availability on 2026-10-28, but this release performed **zero inference POSTs**. Do not count mock output as live sponsor usage.

## Technology and safety

Model output is only a proposal. Strict schema and one-path constraints bound proposed edits; independent CAT evaluation determines recorded acceptance. Private holdouts, secrets and privileged evaluator information are not included in public packages. The project treats unknown or insufficient evidence as unresolved rather than claiming proof.

## Limitations

P03 historical evidence remains incomplete. P04 is locally verified but omitted from the public Console because the current source binding does not support a safe public projection. Candidate F was not executed. No public deployment, live sponsor inference, sponsor feedback or endorsement is claimed. Root license, copyright authority, fixture notices and Git author-metadata publication remain owner review items.

## Judging evidence map

| Criterion | Evidence to link after owner approval | Current limitation |
|---|---|---|
| Technological implementation | Source archive, static Console, validation receipt, source/receipt manifest | No hosted verification yet; P03 incomplete; public oracle WEAK |
| Design | Real desktop/tablet/mobile screenshots and walkthrough video | Not captured while local browser access is disabled |
| Potential impact | Narrow example explaining why an acceptance oracle can miss a product defect | Case-bounded; no industry-wide impact metric claimed |
| Quality of idea | V1/V2 counterfactual distinction with controls | No generalized benchmark accuracy claim |

## Video outline (2:40–2:50)

0:00–0:20 why passing tests can mislead; 0:20–0:50 approved zero-TTL behavior; 0:50–1:20 V1 misses and V2 catches finite expiry; 1:20–1:40 known-good/wrong/equivalent controls; 1:40–2:05 honestly show the integration status (no live request unless separately approved); 2:05–2:30 source-bound evidence and abstention; 2:30–2:45 impact and limitations. Use only authentic application capture.

## Submission links (owner to fill)

- Source: `[APPROVED PUBLIC REPOSITORY URL]`
- Demo: `[APPROVED HOSTED CONSOLE URL]`
- Video: `[APPROVED YOUTUBE URL]`
- Submission: `[DEVPOST URL AFTER SUBMISSION]`
- Sponsor feedback: none recorded; do not imply endorsement.

## Significant-update disclosure

The entry builds on pre-hackathon research, requirements, behavior/counterfactual design, benchmark protocol, historical node-cache examples, DP05B freeze authority, schemas and scaffolding. Hackathon-period work includes evaluator and receipt implementation, controlled replay tooling, provider integration, Console packaging, validation and submission preparation. The final wording and dates require owner confirmation against the applicable rules.
