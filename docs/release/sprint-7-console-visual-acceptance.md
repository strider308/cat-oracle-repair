# Sprint 7 Console visual acceptance

**Status: BLOCKED — no visual acceptance is claimed.**

The Codex Work browser capability reported local browser use disabled by Work settings. Do not bypass that restriction. No screenshot, browser viewport, keyboard visual check, screen-reader check, hosted-header check or video capture was produced in Sprint 7.

The source package still has the Sprint 6 static-console manifest and automated route/header/hash checks. Those checks do not substitute for visual acceptance. P04 remains omitted because the committed current-source binding does not verify the available ignored local receipt plus private annex as public evidence.

When an authorized browser route is enabled, perform the exact matrix:

| View | Required checks |
|---|---|
| 1280 px desktop | Full Test Discrimination Summary, evidence/source inspection, no clipping |
| 768 px tablet | Navigation and cards reflow, no document overflow |
| 390 px mobile | Readable claims, controls, long hashes and source panels |
| 320 px narrow mobile | No horizontal document overflow; content remains operable |

Also test keyboard-only navigation, visible focus, reduced motion, screen-reader labels where feasible, loading/empty/error states, missing/stale evidence labels, deep links and refresh. Record browser/version, viewport screenshots, results and source SHA. Do not label CSS breakpoints as a passed visual test.
