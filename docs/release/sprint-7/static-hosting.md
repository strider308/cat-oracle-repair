# Static hosting handoff — Cloudflare Pages Direct Upload

**Prepared only. No Cloudflare project or deployment was created.** The existing CAT exporter produces a prebuilt static folder and `_headers`; Pages Direct Upload accepts a folder of prebuilt static assets and deploys it without requiring a server-side inference API. Use a static-only package; do not include Functions, credentials, private annexes, or holdout artifacts.

The official Pages guide documents Wrangler deployment of a build-output directory with `npx wrangler pages deploy <DIRECTORY>`; the CLI supports a project name and branch. See [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/).

## Owner-run steps after approval

1. Select the Cloudflare account owner and project name. Confirm the Pages project is a Direct Upload project and its production branch is understood; Cloudflare notes Direct Upload projects cannot later switch to Git integration.
2. Build and verify the CAT static package from the owner-approved exact source SHA. Set `$bundlePath` to the verified package directory under `.verification-runs`.
3. After separate deployment approval, log in using the owner's approved Wrangler installation, then create the Pages project through the dashboard or `npx wrangler pages project create`.
4. Deploy the immutable directory:

```powershell
npx wrangler pages deploy $bundlePath --project-name <OWNER-APPROVED-PROJECT>
```

5. Record the deployment ID and URL. Fetch the hosted site and verify `_headers` behavior, CSP, MIME types, route fallback, deep links, refresh, asset hashes, source SHA, cache behavior, evidence links, missing/stale labels and no private/API endpoints.
6. Repeat desktop/tablet/mobile visual and keyboard checks using the authorized browser. Keep the package manifest and hosted verification log with the release evidence.

`$bundlePath` and project name are placeholders; this document does not authorize account login, project creation, or deployment.
