# Devpost submission — final copy draft

**Owner review required.** Fill source/demo/video links only after rights approval, real capture, and separate publication authorization. Compare eligibility claims with the official event rules.

## Title

Counterfactual Acceptance Testing: Would the Wrong Product Pass?

## Short pitch

AI-generated code can pass tests and still violate approved behavior. CAT checks whether acceptance evidence can distinguish that plausible wrong behavior from the intended product.

## Description

CAT starts from an approved behavior and asks what an acceptance oracle must observe to reject the wrong product without rejecting the right one. In the fresh H0-2 demonstration, the ordinary suite passes while a cross-tenant export bypass survives. CAT's deterministic repair workflow proposes and executes a distinguishing assertion; known-good and equivalent controls remain accepted while the survivor is rejected. Separately, the Nemotron proposal package supplies the approved contract, original suite and bounded scenario choices without control outcomes. A model can select a scenario and propose an expected response; CAT independently re-executes and scores it. The local test responses are simulations, not provider results. The execution matrix and source-bound receipt show the deterministic comparison. The local fixture runner uses bounded Node child processes, not Docker-sealed isolation.

The historical node-cache zero-TTL example is separate: its recorded ordinary suite accepted a finite-expiry survivor, V1 missed the `expiresAt` observation, and V2 added it. This is historical evidence, not a fresh replay. A second fresh process-controlled fixture covers duplicate-operation idempotency under an explicitly synthetic draft contract. All outcomes are case-bounded and do not establish general correctness.

CAT differs from mutation scoring by making the missing observation explicit and checking a proposed assertion against positive as well as negative controls. It is not an AI code review: model output can select a bounded scenario and propose an observation, while deterministic CAT comparisons decide these bounded outcomes. `UNRESOLVED` and `UNSUPPORTED` remain valid results.

## Technical implementation

CAT binds recorded evidence to source and contract artifacts, compares the V1/V2 oracle observations, and presents the resulting case records in a static Console. Candidate execution and sealed evaluation use constrained local runners when the required Docker environment is available. Optional Nebius repair integration can propose a patch, but the deterministic CAT path remains the judge. Current local authorization fails closed before any inference fetch.

## Limitations and exact sponsor use

The recorded release performed zero inference POSTs. A read-only model-list GET showed the target model ID in one account-visible listing; that is not inference, sponsor endorsement, or proof of which account owns a credential. Public Token Factory pricing lists this model at $0.30 per million input tokens and $0.90 per million output tokens; account-specific billing, taxes, and a hard charge ceiling have not been verified. No sponsor feedback is recorded.

P03 is `HISTORICAL_INCOMPLETE`; the public oracle is `WEAK`; P04 is omitted from the public Console; Candidate F was not executed. Docker permission failures prevented fresh `cat:oracle` and `cat:sealed` results in the prior validation environment. No public source publication, hosted demo, video upload, or submission is claimed. CAT does not claim `PROVEN`.

## Work disclosure

See `WORK-DISCLOSURE.md`. The project builds on pre-hackathon research, requirements, case material, benchmark protocol, and scaffolding; preserved history also records hackathon-period implementation and release work. The owner must verify chronology and eligibility wording against official rules.

## Reproduction

See `README-public-candidate.md` and `REPRODUCTION.md`. Source, hosted Console, and video links remain blank until owner approval and actual publication. Sponsor feedback: none recorded.
