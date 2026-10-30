# Sprint 6 host and deployment checklist

**No host is approved, configured, or deployed.** The static package is local only.

## Local package checks completed

- Static export completed from committed, tracked-clean source.
- The 13 manifest-listed files pass SHA-256 and byte-count verification.
- The fresh local P04 sealed-control run passed, but its accepted-control card remains omitted from the static package because the committed public-source binding points to an unavailable receipt; the static app does not execute candidate code or call a model.
- Source routes use same-origin fetches. Fixed route allowlist and security headers are covered by project tests.
- Git source archives exclude `.git`, `.agent-runs`, `.verification-runs`, `node_modules`, `.gortex`, and `.env` paths.

## Before approving a host

1. Select a hosting provider and named owner.
2. Review `_headers` in the exact static package: CSP, content type, frame protection, referrer policy and permissions policy.
3. Deploy only the reviewed 13-file static package; do not expose private evidence, credentials or a repair API.
4. Verify hosted response headers, MIME types, cache behavior, source-link status, stale-evidence labels and route errors on the actual host.
5. Verify the deployed manifest source SHA equals the owner-approved release SHA.
6. Test desktop, tablet, 390 px and 320 px; keyboard navigation, long hashes, code panels, reduced motion and failure/empty/loading states.
7. Capture real screenshots and unedited footage only after browser access is available and the owner approves recording.
8. Record GitHub, Console, YouTube and submission URLs only after owner-approved publication.

Current environment limitation: Codex Work reports local browser use disabled in Work settings. No viewport screenshot or hosted-header check was produced. CSS breakpoints and route tests do not substitute for visual acceptance.
