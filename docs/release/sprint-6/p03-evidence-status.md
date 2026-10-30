# Sprint 6 P03 evidence status

**Historical status remains `HISTORICAL_INCOMPLETE`.** The missing `controller-runner` was not recreated or replaced with current source.

## Expected artifact binding

- Historical receipt: `evidence/historical/p03-v2/receipt-v2.1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b.json`.
- Receipt artifact path: `src/evaluation/p03-runner.ts`.
- Required SHA-256: `f29e04e2c5ab8daee8b487adaa2868f319d9a6ffc9c70d7484cce1aca6041e36`.
- A current runner does not satisfy this binding unless its bytes hash to the expected SHA and the source identity matches.

## Recovery checks

- Searched active repository Git history for all versions of `src/evaluation/p03-runner.ts`: three versions were found; none match the required SHA-256.
- The release clone is the same baseline commit `32208efa9ec2a034431629af94bfd15f49870db5`; its existing recovery inventory records `HISTORICAL_ARTIFACTS_NOT_RETAINED: controller-runner` and “No exact controller-runner match.”
- No authorized backup record or package containing the exact bytes was found in accessible repository evidence. No file was restored.
- This does not prove no external backup exists. No exact match is available in the searched, authorized sources.

## Current fresh evidence

On this Sprint 6 source, `npm run cat:oracle` completed its isolated P03 control run: the finite-expiry survivor passed V1 and failed V2; known-good and equivalent controls passed V2; the control run reported `CAT_P03_PASS`. `npm run cat:sealed` also completed strict current-source P04 verification: its S2 counterfactual passed public checks and failed the sealed challenge, while the known-good and equivalent controls passed both; its leakage probe denied private-evidence, Git, environment-secret, and network access, and container removal was verified. The public oracle remains `WEAK`.

These are fresh, case-bounded local control results. The generated receipts and private annex are ignored local artifacts, not committed or published evidence. The static Console still omits the P04 card because its committed public-source binding points to a different unavailable receipt; adding generated receipts to the source archive or changing that binding requires a separate safe packaging decision. Neither fresh control run reconstructs the missing historical `controller-runner`; do not relabel the old P03 receipt as complete or use these controls to strengthen the public-oracle claim.

The native-host Sprint 6 required suite passed 344/344 on the final Sprint 6 source commit. Focused output is retained under `.verification-runs/cat-oracle-sprint6.log` and `.verification-runs/cat-sealed-sprint6.log` locally.

Owner decision: accept the historical P03 limitation for submission, or identify an authorized backup location that may contain the exact artifact. The current P04 local run does not fill the missing historical runner bytes. Decide whether the P04 card should be integrated into the public static package through a source-bound, privacy-reviewed path; until then it stays omitted from that package.
