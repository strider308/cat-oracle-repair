# Counterfactual Acceptance Testing (CAT)

**Release state:** local Sprint 4 candidate; public release pending owner review. **Public oracle: WEAK.**

> Your tests passed. Would the wrong product have passed too?

CAT checks whether existing acceptance evidence can distinguish approved behavior from plausible alternatives. Its strongest result is consistency with an approved interpretation over evaluated distinguishing cases; it does not prove an implementation correct.

## What works in this candidate

- Offline evidence and oracle demonstrations for node-cache zero TTL.
- Controlled DP05B generation/replay evidence bound to historical freeze and artifact SHAs in release reports.
- Local Evidence Console for two fixed public records: a historical rejected candidate and an authority preflight that stopped before execution.
- Strict schema/provenance validation and optional repair/inference code; this sprint made no model request.

The Console is a recorded-evidence viewer. It does not execute candidate code or call a model. No live sponsor-backed repair ran for this release. Candidate F remains unevaluated. P04 accepted control is omitted because strict verification could not close the missing sealed-private annex.

## Requirements and quick start

- Node.js 22 or newer.
- Git checkout with committed public fixtures.
- Docker only for isolated evaluator/repair paths; Console and public evidence do not require Docker.
- No root runtime npm dependencies are declared. The frozen hero fixture has its own package lock for its pinned offline build.

```powershell
npm test
npm run cat:evidence
npm run cat:oracle
npm run cat:console:check
npm run cat:console
```

The local Console binds to `127.0.0.1:4173`. Stop with Ctrl+C. Do not set a provider key for the recorded demo.

Prepare an allowlisted static package from a committed, tracked-clean checkout:

```powershell
npm run cat:console:package
```

The exporter writes to ignored `.verification-runs/cat-console-static-*`. It includes fixed assets, security headers, two public case JSON files and a hash manifest. Inspect the manifest and run a deployment-equivalent smoke before publishing. No host is approved or deployed.

## Verify a public record

`npm run cat:evidence` emits the canonical public record. `npm run cat:console:check` validates assets and fixture schema. Static `site-manifest.json` lists exported file SHA-256 and source commit. P04 is unavailable in this checkout; its old public fixture alone is not current verification.

## Architecture and trust boundaries

1. A human-approved behavior statement defines the target.
2. Counterfactual cases look for distinguishing witnesses.
3. Existing tests/oracles are assessed for their ability to distinguish behaviors.
4. Candidate execution uses a constrained local Docker boundary when run.
5. Public receipts are projections; sealed challenges/private evidence remain local.

Nebius Token Factory and NVIDIA Nemotron are supported by the optional repair path. Historical public evidence includes a Nebius model attribution, but no live request was issued this release. Current model-list discovery failed at DNS. See `docs/release/sprint-4/nemotron-one-request-authorization.md`.

## Unsupported and known limits

- No proof of correctness or broad oracle strength.
- No live sponsor-backed repair; no Candidate F evaluation; no inference POST.
- Public oracle remains WEAK.
- Strict P04 sealed evidence closure is unavailable; accepted-control card is omitted.
- No public URL, deployment, public repository release, or YouTube/Devpost publication exists.
- Root project license is pending owner approval. Commit history contains author metadata requiring a publication decision.
- A test pass, public fixture or demo is not an independent sealed evaluation.

## Work provenance

Pre-hackathon materials include research, specifications, benchmark protocol, Behavioral IR/witness design, threat model, schemas, scaffolding, historical node-cache cases, DP05B freeze authority and controlled candidate artifact. Hackathon work includes later implementation, replay/receipt tooling, regression closure, provider integration/retry guard, and Sprint 4 Console/package and submission preparation. See `docs/release/cat-sprint-3-independent-replay.md` and `docs/release/sprint-4/existing-work-vs-hackathon-work.md`.
