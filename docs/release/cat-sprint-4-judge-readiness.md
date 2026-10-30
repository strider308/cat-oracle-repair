# CAT Sprint 4 — Judge readiness and release decision

**Verdict: HUMAN REVIEW REQUIRED.** This successor prepares a local judge-facing recorded-evidence Console and submission materials. It is not a public release or acceptance GO. Candidate F remains unevaluated; no paid inference, push, publication, submission, or deployment occurred.

## Identity and outcome

- Starting source: `1509bbb32931a309c5ffb67cc2118582f285c1d0` (preserved).
- Trusted DP05B generation authority: `5069680ff093695a227bf410eb3de88d99dce9e7`.
- Controlled artifact source: `cec8054ba8690172a7b53267cc985a4445b7860b`.
- Sprint 4 implementation successor: `c182c065eca2615f118db8314fdf39504e5dba4f`; report-only successor: `ff00b3d79ebe0ce70ffe4f36ad6fa6f742b00170`. This closeout contains documentation only; no code changed after c182.
- Outcome target: reviewers can open and understand a reproducible, offline record of a rejected patch and an authority stop without access to private evaluator evidence.

A green test count, static export, or successful browser render is only a proxy for reviewer comprehension, source provenance, safe public disclosure, and product effectiveness. The public oracle remains WEAK. Offline calibration does not establish broad oracle strength.

## P04 accepted-control evidence is not re-established

The strict P04 verifier failed with `P04_CONTROL_VERIFICATION_FAILED`. Sol independently reproduced the result without inspecting private body contents. The pinned receipt hash and all 120 non-sensitive artifacts matched, and the P03 chain verified; the required sealed-private annex is absent from this checkout. This is incomplete evidence closure, not evidence of public artifact drift. The historical public fixture remains unchanged but cannot support a current `ACCEPTED` or verified-control claim. The Console and static export omit P04 entirely. Do not restore it until the complete authorized evidence closure is available and strict verification passes.

## Console scope

The Console serves two fixed canonical public records only: the historical rejected zero-TTL candidate and an authority preflight that stopped before candidate execution. The browser reads local JSON files; no candidate code or model is run. It states there is no live sponsor-backed repair in this release. Candidate F remains NOT EVALUATED. Public oracle is WEAK.

## Nebius preflight and cost boundary

A fresh model-list GET failed at DNS resolution for `api.tokenfactory.nebius.com` (`ENOTFOUND`) before contacting the provider. No inference POST was made. The current public catalog lists `nvidia/nemotron-3-super-120b-a12b` at $0.30/M input, $0.90/M output and 256K context. CAT bounds `max_tokens` to 12,000 and replacement output to 65,536 bytes, but does not enforce provider-counted input tokens or an account spending cap. Therefore the proposed $0.10 ceiling is **NOT ENFORCEABLE; do not authorize a request**. A local byte cap would not prove an invoice ceiling because provider tokenization/overhead and billing limits are outside this code. Smallest correction: verify a provider/account hard spending limit no greater than $0.10 for this isolated experiment, or implement and independently verify provider-counted input-token limit plus billed overhead. Current auth is not a durable one-use token; ambiguous POST outcomes must not be retried under the same approval.

## Validation snapshot

- Focused Console suite: 58/58 passed; static exporter test: 1/1 passed.
- Implementation suite: `npm test` on `c182c065eca2615f118db8314fdf39504e5dba4f` — 339 passed, 0 failed, 0 skipped. The initial run had three stale P04 expectations; tests now require strict P04 failure when the sealed annex is absent.
- Required project validator on report successor `ff00b3d79ebe0ce70ffe4f36ad6fa6f742b00170`: 338 passed, 1 failed, 0 skipped. `tests/p03-subject.test.ts` expected `CALIBRATED` but received `UNCALIBRATED` from the Docker-backed evaluation. A focused retry failed before the test ran because access to `dockerDesktopLinuxEngine` was denied. This remains a failed required validation, not a pass.
- Console check: PASS; reports `P04_CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE`.
- Browser: desktop rendered the rejected historical record and five stage links. Work settings disabled viewport overrides; tablet/320px screenshots and visual acceptance remain pending.
- `npm run cat:oracle`, `npm run cat:sealed`, and the focused P03 retry were blocked by Docker engine permission denied. No test or evaluator was weakened to bypass this environment failure.
- Strict P04: FAIL / evidence closure incomplete.
- Fresh provider model-list GET: BLOCKED at DNS; official public catalog reviewed separately.
- Gitleaks history scan on report successor `ff00b3d` covered 103 commits and returned six reviewed `generic-api-key` false positives: four deliberate test sentinels and two SHA field/path matches. The scan is not clean. Full Git history contains author email metadata. No history rewrite was performed.
- Static headers are prepared; no deployment host was tested or approved.
- Project-specific required validation is `npm run test`; `.codex/tri-tier-policy.json` is present and unchanged.

The exact-SHA project validation failed one Docker-backed P03 calibration case. A Sol adjudication reviewed the failure and the permission-denied retry and rejected release closure. Do not repeat validation absent restored Docker engine access; restore that access, rerun the focused P03 case, then rerun the required project validator on the intended release SHA. The current release state is HUMAN REVIEW REQUIRED.

## Human decisions

1. Select the project license and approve public author-metadata/history treatment.
2. Restore/verify the sealed P04 annex in an authorized environment if an accepted control must be shown.
3. Resolve a hard, independently verified $0.10 provider spend boundary and separately authorize one paid request.
4. Separately authorize Candidate F evaluation in the exact frozen authority environment.
5. Approve public repository release, static host, Devpost submission, and YouTube publication.

No release GO is claimed.
