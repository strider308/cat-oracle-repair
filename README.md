# Counterfactual Acceptance Testing (CAT)

**Release state:** public MIT-licensed source-only snapshot and Cloudflare Pages static Console deployment. Nebius sponsor-run evidence is not established. Focused Oracle Repair and recorded-evidence checks pass on this source. A direct 362-test run was reported passing at source commit `53a80fac269da2c363ede8d2f2dfce3467310321`; the receipt-bound validation still showed Docker, loopback, and Windows junction restrictions. The direct run is not independently reproduced in this release assembly. **Public oracle: WEAK.**

> Your tests passed. Would the wrong product have passed too?

## Public demo and source

- **Hosted static Console:** https://cat-oracle-repair.pages.dev/ (Cloudflare Pages deployment reported successful on October 30, 2026; independent end-to-end browser acceptance is pending).
- **Public source repository:** https://github.com/strider308/cat-oracle-repair
- **License:** root [MIT LICENSE](LICENSE) for CAT-original material; see [third-party notices](THIRD-PARTY-NOTICES.md).
- **Important limitation:** This is a static evidence viewer. The model-proposal examples are labeled simulations; no live Nebius/NVIDIA inference POST has occurred. The project does not claim sponsor runtime eligibility on that basis.

CAT checks whether existing acceptance evidence can distinguish approved behavior from plausible alternatives. Its strongest result is consistency with an approved interpretation over evaluated distinguishing cases; it does not prove an implementation correct.

## What works in this candidate

- Historical node-cache zero-TTL evidence, including the recorded V1 finite-expiry survivor and the bounded `expiresAt = 0` proposal. This is recorded historical evidence, not a fresh node-cache execution.
- Two fresh, self-owned Oracle Repair fixture runs: H0-2 tenant-scoped export under a human-approved source contract, and duplicate-operation idempotency under a synthetic draft contract. For each, the process-controlled runner executes ordinary and proposed assertions against good, equivalent, surviving-wrong, and already-rejected controls.
- A bounded comparison solver that separates ordinary-suite outcomes from counterfactual observations, binds one declared scenario/input identity across controls, preserves positive controls, and reports caller-declared authority as unverified.
- A controlled Node child-process workflow that executes H0-2 tenant export and a synthetic idempotency case twice per control, recomputes input/source hashes, applies the generated assertion, and writes verifiable source-bound receipts. These are process-isolated self-owned fixtures, not Docker security isolation.
- The idempotency contract remains a synthetic draft, not an approved product specification. Node-cache evidence remains historical and incomplete.
- Controlled DP05B generation/replay evidence bound to historical freeze and artifact SHAs in release reports.
- Local Evidence Console with a default Test Discrimination Summary plus two fixed public records: a historical rejected candidate and an authority preflight that stopped before execution.
- Hash-verified public package sources that explain V1/V2 oracle discrimination and show recorded known-good, known-wrong, survivor, and equivalent controls.
- Strict schema/provenance validation and local repair-request proposal tooling. Inference POSTs fail closed until authenticated owner signing and independent consume-once state are available. An earlier October 29, 2026 model-list GET returned the Nemotron model; a later GET recheck failed DNS with `ENOTFOUND`, so current access is unverified. No inference POST occurred.
- A source-bound Nemotron observation proposal request can be prepared from the approved H0-2 contract and original suite. It offers four fixture-supported scenarios and asks the model to select one and propose an expected observable response; the request withholds control identities and outcomes. CAT reruns the selected scenario against all four implementations and calculates false acceptance, false rejection, positive-control preservation, survivor detection, and already-rejected-control preservation. Simulated responses are explicitly labeled; no live Nemotron response is claimed.

The Console is a static evidence viewer and does not execute code or call a model in the browser. Its two Oracle Repair matrices come from controlled child-process runs performed during local evidence generation; receipts expose source hashes, repeatability and the process-only security boundary. These self-owned fixtures are not sealed Docker evaluations. The historical node-cache evidence is separate: P03 remains an old recorded result, not a fresh replay, and its receipt is incomplete because the controller-runner artifact is missing. No live sponsor-backed repair ran for this candidate. Candidate F remains unevaluated. P04 is not established by this checkout; do not infer a fresh sealed-control result from an older generated receipt.

The V1/V2 example asks whether the original oracle observed the expiry field. The archived survivor passes V1 and fails V2; known-good, known-wrong, and equivalent controls remain visible to show both discrimination and calibration limits. Read [the Sprint 5 readiness report](docs/release/cat-sprint-5-winning-product-readiness.md) before using any result as a release claim.

## Requirements and quick start

- Node.js 22 or newer.
- Git checkout with committed public fixtures.
- Docker only for Docker-sealed evaluator/repair paths; the self-owned Oracle Repair demonstrations use bounded Node child processes. Console and public evidence do not require Docker.
- The frozen hero fixture has its own lockfile. Install its test/build dependencies before running the regression suite or Docker-backed controls:

```powershell
npm ci --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite
npm run cat:oracle:repair
npm run test
npm run cat:evidence
npm run cat:oracle
npm run cat:console:check
npm run cat:console
```

The locked `expresso` coverage hook invokes `make`; CAT does not use that optional helper, so `--ignore-scripts` keeps fixture setup working on Windows without it.

The local Console binds to `127.0.0.1:4173`. Stop with Ctrl+C. Do not set a provider key for the recorded demo.

Prepare an allowlisted static package from a committed, tracked-clean checkout:

```powershell
npm run cat:console:package
```

The exporter writes to ignored `.verification-runs/cat-console-static-*`. It includes fixed assets, security headers, the summary, six hash-bound public source files, two public case JSON files and a hash manifest. A static bundle was deployed to Cloudflare Pages on October 30, 2026 (15 files uploaded). The public site still requires independent HTTP, browser, and evidence-link acceptance; do not mistake upload success for completed live-site testing.

## Verify a public record

`npm run cat:evidence` emits the canonical public record. `npm run cat:console:check` validates assets and fixture schema. Static `site-manifest.json` lists exported file SHA-256 and source commit. P04 is unavailable in this checkout; its old public fixture alone is not current verification.

## Architecture and trust boundaries

1. A human-approved behavior statement defines the target.
2. Counterfactual cases look for distinguishing witnesses.
3. Existing tests/oracles are assessed for their ability to distinguish behaviors.
4. Candidate execution uses a constrained local Docker boundary when run.
5. Public receipts are projections; sealed challenges/private evidence remain local.

The prepared Oracle Observation Proposal targets only `nvidia/nemotron-3-super-120b-a12b` at Nebius Token Factory. The production runtime rejects inference POSTs because authenticated owner approval and an independent consume-once boundary are unavailable. CAT issued no inference POST, and the Console contains no model-generated result. The reported `$0.10` account spend cap is not provider-enforced or independently confirmed. The local preparation command is `npm run cat:oracle:observation:prepare`; it writes a bounded request artifact and explicitly does not contact the provider. See the [one-request approval packet](docs/release/sprint-6/nemotron-one-request-approval.md) and [sponsor eligibility memorandum](docs/release/cat-final-submission/SPONSOR-ELIGIBILITY.md).

## Unsupported and known limits

- No proof of correctness or broad oracle strength.
- No live sponsor-backed repair; no Candidate F evaluation; no inference POST. Sponsor model availability was checked with GET only.
- Public oracle remains WEAK.
- The three-domain examples do not constitute sealed independent evaluation; cache evidence is historical and the other two are in-process synthetic tests.
- Public GitHub source and a Cloudflare Pages static deployment now exist. Independent hosted route/viewport checks are still pending. No YouTube video or Devpost submission is claimed.
- A root MIT license and third-party notices are included in the public source snapshot with the project owner's release authorization. The scope of third-party obligations remains as documented in the notices. The public snapshot uses a fresh Git history rather than exporting the private history.
- A test pass, public fixture or demo is not an independent sealed evaluation.

## Work provenance

Pre-hackathon materials include research, specifications, benchmark protocol, Behavioral IR/witness design, threat model, schemas, scaffolding, historical node-cache cases, DP05B freeze authority and controlled candidate artifact. Hackathon work includes later implementation, replay/receipt tooling, regression closure, provider integration/retry guard, and Sprint 4 Console/package and submission preparation. See `docs/release/cat-sprint-3-independent-replay.md` and `docs/release/sprint-4/existing-work-vs-hackathon-work.md`.

## Open-source release

CAT-original source is offered under the root MIT `LICENSE` (2026 Samujjwal Bhowmick, as authorized by the project owner). Copied node-cache code and other third-party components remain under their own license texts and notices. See `THIRD-PARTY-NOTICES.md` and retained upstream `LICENSE` files. The source-only archive excludes installed `node_modules`, private `.agent-runs`, and Git history.

The public snapshot was reconstructed from the reviewed `0885062` candidate plus the three uploaded source edits reported between that commit and `53a80fac`. It is not a Git checkout, and the local final Git SHA does **not** identify this published snapshot's tree. This release snapshot has a separate SHA-256 manifest. No live Token Factory inference POST is claimed.
