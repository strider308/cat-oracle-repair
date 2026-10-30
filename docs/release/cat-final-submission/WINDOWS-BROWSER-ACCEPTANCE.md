# Owner Windows browser acceptance and capture workflow

No screenshots or recording are included in this release package. Complete these checks on the owner's Windows machine in a browser the owner explicitly permits.

1. Use the owner-approved clean source checkout. Record `git rev-parse HEAD` and the static bundle `site-manifest.json` SHA-256.
2. Run `npm run cat:console` in PowerShell. Open `http://127.0.0.1:4173` in the approved browser; keep the URL visible in raw captures.
3. Capture actual screenshots at 1280×800 (desktop), 768×1024 (tablet), 390×844 and 320×800 (mobile). For each, save the screenshot plus a text record of source SHA, URL, viewport, date/time, browser, and pass/fail.
4. At each viewport, check first-screen comprehension; V1/V2 comparison; evidence/source navigation; keyboard-only focus visibility; missing/stale evidence messaging; long hashes/code blocks; mobile overflow; and absence of private information.
5. Record the walkthrough using an owner-approved screen recorder. Capture only the real Console and recorded evidence. Do not show local environment variables, `.agent-runs`, `.verification-runs`, private annexes, or unapproved credentials.
6. Preserve the original recording, captions, edit manifest, screenshots, and final under-three-minute render locally. Compare narration and captions with `DEVPOST-SUBMISSION.md` and `JUDGE-WALKTHROUGH.md`.

Mark capture complete only when actual media files exist and have been reviewed. Obtain separate owner authorization before video upload or public submission.
