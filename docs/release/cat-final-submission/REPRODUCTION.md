# Reproduction instructions

## Recorded Console

Requirements: Node.js 22 or newer. From the repository root:

```powershell
npm ci --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite
npm run cat:oracle:repair
npm run cat:console:check
npm run cat:console
```

`cat:oracle:repair` runs the H0-2 and idempotency self-owned fixtures twice per control in bounded Node child processes, writes source-bound receipts under the ignored verification area, and does not contact a model. The idempotency contract is a synthetic draft. These runs are not Docker-sealed evaluations. The Console listens at `http://127.0.0.1:4173`; stop it with Ctrl+C. It displays fixed, recorded evidence and does not execute code or call a model in the browser.

## Offline provider-request preparation

`npm run cat:oracle:observation:prepare` requires a committed, tracked-clean checkout, runs the process-controlled H0-2 fixture, and writes a source-bound proposal package, HTTP body, preparation manifest, and locally executed simulation results under ignored `.verification-runs/oracle-observation-proposal/`. The request contains the approved H0-2 clause, original suite, and four bounded fixture scenarios; it does not contain implementation identities or outcomes. The model may propose `response = ALLOW` or `DENY` for one listed scenario. The command performs no network request and reads no provider credential. Its four test responses are labeled `SIMULATED_TEST_FIXTURE_NOT_PROVIDER`; no provider response or live model contribution is included.

`npm run cat:repair-preflight -- --json` builds the v2 historical node-cache repair request locally and reports its package/body byte counts, hashes, and the four allowlisted generated-content omissions. The verified v2 request retains all 15 file paths, roles, and hashes. This is a separate local preparation check and does not authorize or issue an inference POST.

## Full regression suite limitation

The required full-suite run on source commit `25974c3f857f58110a64f9452f04076cecd9d217` reported 305 passed, 35 failed, and 3 skipped. Failures grouped into 26 local HTTP fetch failures, 7 Docker API access failures, 1 Windows junction permission failure, and 1 P03 calibration cascade following Docker precheck failure. The 3 skips were symlink/junction operations unavailable on this host. The preserved local log is `.agent-runs/validation-runs/29c24e9b2a364272929b39d7eae3bdb7/validation-01-test.log`; those environment failures are not passes and were not repaired by altering tests. The earlier 351/351 result applies only to application commit `027d9aff1b103ec1eaa2ae03a552f8036e36ecbe`. The source snapshot omits `.git` history and ignored P03 durable-evidence state, so it cannot independently reproduce all history-bound results.

## Optional isolated evaluation

`npm run cat:oracle` and `npm run cat:sealed` need Docker Desktop with working Linux engine access. A Docker daemon permission failure means no result was established. Do not substitute synthetic results or change the release claim to imply a pass.

## Static package

From a clean, committed checkout, run `npm run cat:console:package`. The exporter writes an allowlisted static folder under ignored `.verification-runs/`; compare every path, byte count, and SHA-256 in `site-manifest.json` before use. The package contains no inference service or private annex. The current package omits the P04 card because strict source verification is unavailable.

Do not configure a provider credential to reproduce the recorded demo. No inference POST occurred. The H0-2/idempotency process runs and historical node-cache record are different evidence classes; do not combine them into a fresh sealed evaluation claim.
