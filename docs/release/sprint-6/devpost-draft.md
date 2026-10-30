# Devpost submission draft — Sprint 6, owner review required

## Your tests passed. Would the wrong product have passed too?

AI coding agents can produce patches that leave an existing suite green while violating behavior a user approved. Counterfactual Acceptance Testing (CAT) asks whether acceptance evidence separates the approved behavior from plausible alternatives.

In CAT's node-cache zero-TTL case, the approved behavior preserves the value without expiry. The historical ordinary suite passed a known-wrong patch. Oracle V1 did not observe `expiresAt`, so a finite-expiry survivor passed V1. Oracle V2 added that observation and rejected the survivor. The Console also shows known-good, known-wrong and equivalent controls. These are hash-bound historical records; the archived P03 receipt is incomplete because its exact `controller-runner` artifact is missing. The public oracle remains WEAK. CAT does not prove a patch or product correct.

## What this build demonstrates

- An offline, hash-bound Test Discrimination Summary as the Console's default page.
- Source artifacts and a static manifest that let a reviewer verify displayed evidence bytes.
- A recorded rejected candidate and an authority preflight that stopped before candidate execution.
- A controlled evaluator with network-denial and sealed-evidence tests.
- Optional repair integration that accepts only `nvidia/nemotron-3-super-120b-a12b`, sends a strict JSON schema with a 12,000-token output limit, restricts edits to one path, and refuses oversized repair packages.

On October 28, 2026, two read-only Nebius Token Factory model-list GET requests confirmed that exact model in the account-visible list. CAT issued **zero Sprint 6 inference POSTs**. An older public-evidence derivative attributes a historical inference, but its original receipt is classified `MALFORMED_RECOVERED_DERIVATIVE`; this submission does not count it as independently verified sponsor usage. The model listing does not substitute for meaningful inference usage; sponsor eligibility/completeness remains at risk. Current metadata supports a theoretical one-request usage estimate below $0.10, but no account/provider hard spend stop was independently confirmed. The paid request remains unapproved.

## Engineering work and challenge

Pre-hackathon work includes the research, product boundary, approved behavior and counterfactual design, benchmark protocol, historical node-cache case, DP05B freeze, schemas and initial scaffolding. Hackathon-period work includes evaluator and receipt implementation, controlled replay tooling, optional Nebius integration, the offline Test Discrimination Summary, static Console packaging, platform-boundary diagnostics and submission preparation. See `docs/release/sprint-4/existing-work-vs-hackathon-work.md` for the detailed chronology.

The restricted validation runner could not access the local Console loopback server or Docker Desktop's named pipe. CAT left its HTTP and Docker tests intact. The authorized native Windows project validator passed 344/344 on the recorded Sprint 6 release SHA. The diagnostic report keeps the restricted failure and native pass as separate results.

## Limitations and next work

- The old P03 receipt remains `HISTORICAL_INCOMPLETE`; no exact runner artifact was recovered.
- A fresh local strict P04 sealed-control run passed, but its card remains omitted from the static Console: the committed public-source binding points to a different unavailable receipt, and the generated private annex stays local.
- The public oracle is WEAK and evaluation is case-bounded.
- Candidate F was not evaluated; its dependency-closure successor remains a proposal.
- No inference POST, public source release, deployment, video upload or Devpost submission occurred.
- Root license, copyright authority, third-party notices and author-metadata publication need owner review.

## Judge's guided tour

Show V1 passing and V2 rejecting the finite-expiry survivor, compare the known-good/wrong/equivalent controls, then show the archived receipt limitation and source hashes. The full tour and fresh-checkout commands are in `docs/release/sprint-6/judge-tour.md`.

## Sponsor feedback

No sponsor feedback has been recorded for this submission. Do not add a quote or imply endorsement.

## Publication fields

- Public GitHub URL: `[OWNER TO APPROVE AND INSERT]`
- Hosted Console URL: `[OWNER TO APPROVE AND INSERT]`
- YouTube URL: `[OWNER TO APPROVE AND INSERT]`
- Devpost submission URL: `[OWNER TO SUBMIT AND INSERT]`

Draft only. Publication, hosting, video and submission remain owner-controlled.
