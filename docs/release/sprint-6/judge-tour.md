# CAT judge tour and reproducible setup

## 90-second guided tour

1. Open the Test Discrimination Summary. Start with: “Your tests passed. Would the wrong product have passed too?”
2. Show the approved zero-TTL behavior and the `expiresAt` field that the original V1 oracle did not observe.
3. Point to the recorded finite-expiry survivor: V1 passes it; V2 detects it.
4. Show known-good, known-wrong and equivalent controls. These are hash-bound historical records, not fresh Sprint 6 P03 executions.
5. Show `HISTORICAL_INCOMPLETE` and `WEAK`. CAT does not claim correctness beyond this evidence.
6. Open a public source artifact and show its SHA-256 manifest entry.
7. Close with the sponsor boundary: two model-list GETs confirmed the exact account-visible Nemotron ID; no inference POST, paid repair or Candidate-F evaluation occurred.

## Reproducible setup

Requires Node.js 22+, Git and, for evaluator/Docker-backed tests, Docker Desktop's Linux engine. From a fresh checkout:

```powershell
npm ci --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite
npm run test
npm run cat:evidence
npm run cat:oracle
npm run cat:sealed
npm run cat:console:check
npm run cat:console:package
```

The Console is local and offline. Do not configure `NEBIUS_API_KEY` for this tour. The list-model GET was a separate read-only preflight; the Console itself makes no provider call. Review the static package manifest before use.

## URLs for eventual publication

- Public source: `[OWNER TO APPROVE AND INSERT]`
- Hosted Console: `[OWNER TO APPROVE AND INSERT]`
- YouTube demo: `[OWNER TO APPROVE AND INSERT]`
- Devpost submission: `[OWNER TO SUBMIT AND INSERT]`
