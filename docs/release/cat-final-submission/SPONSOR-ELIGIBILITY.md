# Sponsor eligibility memorandum — owner action required

**Sponsor eligibility is NOT ESTABLISHED.** This memo does not interpret competition rules. Neither a model-list GET nor an offline demo establishes meaningful sponsor inference.

## Current route and authorization boundary

The production inference guard remains fail-closed. `src/runtime/inference-authorization.ts` throws `INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE` before a POST unless the required external authenticated approval and independent one-use boundary exist. No local approval-file or command-line bypass was added.

An earlier read-only Token Factory model-list GET returned `nvidia/nemotron-3-super-120b-a12b`. A fresh GET on October 29, 2026, failed before HTTP with DNS `ENOTFOUND` for `api.tokenfactory.nebius.com`, so current account access is unverified. The local environment contains a credential variable, but its value was not read, emitted, or placed in evidence. Account identity and credential custody are not verified. No Nebius AI Cloud project or deployment is configured.

## Prepared observation-proposal request

This operation is distinct from the full historical source-repair workflow. It asks Nemotron to select one of four bounded H0-2 fixture scenarios and propose an expected `response = ALLOW|DENY`. The request contains the approved clause and original suite, but no repair assertion, control roles or outcomes. CAT validates the response against H0-2 and reruns the selected scenario against four source-bound implementations. Local successful, irrelevant, contradictory and overstrict examples are `SIMULATED_TEST_FIXTURE_NOT_PROVIDER`, not a real model contribution.

After a clean commit, exact source, package, prompt, and HTTP-body identities are recorded under `.verification-runs/oracle-observation-proposal/`, including `preparation.json`, `request-package.json`, `http-body.json` and `simulated-results.json`.

## Request-specific approval packet

- **Endpoint:** `https://api.tokenfactory.nebius.com/v1/chat/completions`
- **Model:** `nvidia/nemotron-3-super-120b-a12b`
- **Purpose:** `oracle_observation` (scenario selection and observable proposal only)
- **Source SHA, body/package SHA-256, byte counts, operation reference:** see the final committed-source `preparation.json` and exact `http-body.json`.
- **Output ceiling:** 192 completion tokens; 1,024 bytes of model content; 1 MiB HTTP envelope.
- **Network policy:** one POST; 30-second timeout; no retry, including after an ambiguous result.
- **Cost estimate:** manifest estimate uses the previously recorded public list price of $0.30/M input tokens and $0.90/M output tokens, with each body byte conservatively treated as one input token plus all 192 output tokens. Current model/account pricing could not be rechecked during this turn; refresh it before owner approval. This is not a billing cap. No provider-enforced account spend cap was verified.
- **Residual risks:** actual tokenizer usage and billing can differ, including taxes or other charges; existing local credential custody/account ownership is unverified; model availability could not be rechecked; no independent external executor, signer or durable consume-once ledger exists.

**Owner action required before any POST:** establish an independently administered executor with protected provider-key storage, an owner-authenticated request-specific approval bound to the final source and exact body hash, and an atomic consume-once ledger that burns ambiguous attempts. Then review current pricing and explicitly approve this exact operation and its residual financial risk. No inference POST has been issued. The prepared packet alone is not authorization.
