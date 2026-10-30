# Counterfactual Acceptance Testing (CAT)

**Your tests passed. Would the wrong product have passed too?**

CAT checks whether acceptance evidence distinguishes approved behavior from plausible alternatives. In the node-cache zero-TTL example, the historical ordinary suite passed a known-wrong patch. Oracle V1 missed a finite-expiry survivor because it did not observe expiry; V2 added that observation and rejected it. Known-good, known-wrong and equivalent controls make the limits visible.

CAT is an independent acceptance firewall for AI-generated code proposals. Models may propose changes; deterministic, constrained checks decide the recorded outcome. CAT does not prove general correctness. The public oracle is WEAK and this demonstration is case-bounded.

## Reproduce locally

Requirements: Node.js 22 or newer. Docker is needed only for isolated candidate/evaluator paths. From a clean, owner-approved checkout:

```powershell
npm ci --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite
npm run test
npm run cat:oracle
npm run cat:sealed
npm run cat:console:check
npm run cat:console:package
```

Do not configure a provider credential for the recorded Console demonstration. No live inference was executed for this release candidate. Generated receipts and private annexes are local-only and must not be published.

## Limits and release status

- P03 historical receipt: `HISTORICAL_INCOMPLETE`.
- P04 accepted-control card: omitted from public Console pending safe current source binding.
- Public oracle: `WEAK`.
- Candidate F: not executed.
- No verified live sponsor inference, public host or public submission link is included.
- This candidate README and the MIT license text are not approved for publication until owners confirm copyright authority, license, notices, provenance and history option.

See the Sprint 7 release report for exact validation evidence, financial decisions and submission blockers.
