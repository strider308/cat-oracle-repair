# Devpost draft — pending owner review

## Your tests passed. Would the wrong patch have passed too?

AI coding agents can produce a patch that keeps the existing test suite green while violating intended behavior. CAT, Counterfactual Acceptance Testing, checks whether acceptance evidence can tell an approved behavior from plausible alternatives.

CAT starts from an approved behavior, derives counterfactual challenges, and checks whether public tests and calibrated oracles distinguish the outcomes. When authority or evidence is insufficient, CAT can abstain instead of presenting a confident pass. Its result is bounded to evaluated cases; CAT does not prove software correct.

### What is implemented

This release candidate includes an offline node-cache zero-TTL case, recorded Evidence Console, public evidence schemas, controlled candidate-generation/replay evidence, and constrained local execution path. The public record demonstrates a historical AI patch whose existing suite passed while behavioral checking rejected it. A separate authority preflight demonstrates a stop before candidate execution.

### Nebius and NVIDIA

The optional repair adapter targets Nebius Token Factory and NVIDIA Nemotron. Historical public evidence attributes a prior candidate to Nebius/Nemotron. No live repair request was made in this release, and current model-list discovery failed at DNS. No current inference-quality claim is made.

### Architecture and differentiation

CAT separates human-approved intent, alternative interpretations, distinguishing witnesses, public oracle calibration, isolated candidate execution, and receipts with public/private evidence boundaries. This makes acceptance evidence itself testable while retaining abstention and provenance.

### Results and challenges

Sprint 3 recorded an independent 21/21-byte replay match for the controlled artifact and 337 passing regression tests. Sprint 4 changed the Console and static packaging after that baseline, so these figures do not validate the successor until its full suite passes. Public oracle remains WEAK; Candidate F is NOT EVALUATED; P04 accepted control is omitted because its sealed evidence closure is incomplete.

A major engineering challenge is distinguishing a sanitized historical projection from currently verified evidence. CAT fails closed by omitting P04 when strict evidence is unavailable. Future work includes stronger independent oracle evidence, restored sealed-evidence closure, budget-enforced inference, hosted judge access, and broader held-out evaluation.

**Publication status:** draft only. License, history/author metadata, public repository, hosted demo and submission require owner approval. Do not submit until successor validation numbers and disclosures are reviewed.
