# CAT Friday submission runbook — October 30, 2026

**Development freeze:** Friday 12:00 PM IST. **Submission window:** 12:00 PM–10:30 PM IST. **Official deadline:** 10:30 PM IST. This runbook prepares the work; it does not authorize external actions. See the [Sprint 8C security and release status](cat-sprint-8c-final-security-and-release.md) for current gates.

## Before noon

1. Record the final approved source SHA and require a clean tracked tree.
2. Run the native project validator against that exact SHA. Keep its unique run directory, metadata and full logs; run it again and verify the first run's evidence hashes did not change. Run the oracle, sealed controls, Console checks, static package verification and security scans. Sprint 8B's overwritten raw failure log is missing; do not recreate or overwrite it.
3. Rebuild the static package from that SHA. Verify every manifest hash, byte count, public allowlist, CSP/header file, route and source commit identity. Inspect the archive for `.agent-runs`, `.verification-runs`, credentials, private evidence, holdouts and local databases.
4. Confirm copyright authority, license selection, notices, attribution, history publication option and six scanner findings. Do not publish until approved.
5. Confirm sponsor rule eligibility and exact evidence. The current runtime blocks inference because external owner-signing and consume-once authorities are unavailable; keep `INFERENCE_POST_COUNT=0` unless both are implemented and approved.
6. Capture the real app in desktop 1280 px, tablet 768 px, mobile 390 px and narrow 320 px only through an authorized browser. Capture keyboard and evidence-state walkthroughs. Do not use fabricated UI or model results.
7. Render the 2:40–2:50 video from authentic screen recordings. Keep raw captures, final MP4 and edit manifest. No soundtrack unless licensed.

## 12:00 PM–10:30 PM IST submission sprint

### Gate 1 — publication authorization

Obtain explicit owner approval for the selected repository/history option, approved root license and notices. Create/publish the repository only after approval. Confirm the public URL, default branch, source SHA, README, license, provenance disclosure and no-secret scan.

### Gate 2 — hosting authorization

Obtain explicit approval for the selected static host and exact immutable bundle. Deploy only that package. Verify hosted source identity, headers, content types, routes, deep links, refresh, cache behavior, public evidence links, missing/stale labels, mobile layout and no private/API endpoints.

### Gate 3 — video authorization

Review the final MP4 and disclosures. Upload to YouTube only after explicit owner approval. Verify playback and use the final URL.

### Gate 4 — Devpost submission

Complete title, pitch, narrative, project links, hosted demo, video, images, technical implementation, design, potential impact, idea quality, sponsor integration, actual feedback (or explicit none), significant-update disclosure, limitations, security/privacy summary and future roadmap. Reopen all links in a clean session. Obtain owner approval, submit, and retain the confirmation URL/time.

## Stop conditions

- Missing license/copyright decision: do not publish source.
- Missing host or deployment approval: do not deploy.
- Missing recording/upload approval: do not upload video.
- No separately authorized request-specific Nemotron approval: do not issue inference POST.
- P03 remains incomplete; P04 remains omitted unless a safe current projection is independently verified.
- Any validator failure, hash mismatch, leak, or source drift: stop and repair before publication.

## Decision record fields

For each approved external action, retain approver, exact artifact SHA, target account/project, selected option, timestamp, links/results and independent verification. Record `NOT_DONE` for every action that does not receive approval or fails verification.
