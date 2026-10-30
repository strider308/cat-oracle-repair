# Product Spec — Frozen for M0

## Initial user

Engineer reviewing an AI-authored material business-rule change in an existing TypeScript service.

## V1 supported change classes

- authorization;
- account state;
- role permissions;
- tenant boundaries;
- subscription / entitlement rules;
- refund eligibility;
- API contract behavior;
- positive and negative behavior;
- stateful REST/API business rules.

## Core object

Given approved interpretation `H0`, plausible alternatives `H1..Hn`, and acceptance evidence `T`:

1. find a concrete witness `w` where `H0(w) != Hi(w)`;
2. determine whether `T` distinguishes the two outcomes;
3. if not, report `Hi` as a survivor and emit `EVIDENCE_GAP`.

## Candidate-level states

- `AMBIGUOUS`
- `EVIDENCE_GAP`
- `COUNTEREXAMPLE_FOUND`
- `CONSISTENT`
- `UNRESOLVED`
- `UNSUPPORTED`

`CONSISTENT` means only:

> Candidate behavior is consistent with the approved interpretation over the evaluated distinguishing cases.

## Explicit non-goals

No arbitrary UI verification, broad performance testing, distributed/eventual-consistency verification, subjective quality judgment, autonomous merge, generic SAST/DAST, universal formal verification, or enterprise requirements management during the hackathon.
