# Cloudflare Pages owner publication procedure

**Preparation only. No account/project creation or deployment is authorized by this document.** Use only the verified static Console directory, never the full repository, source candidate, private evidence, Functions, or credentials.

Cloudflare's current Direct Upload guide accepts a folder of prebuilt static assets with Wrangler. Direct Upload projects cannot later switch to Git integration, so the owner must choose the project mode knowingly. See [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and the [Wrangler Pages deploy command](https://developers.cloudflare.com/workers/wrangler/commands/pages/).

## Owner procedure after approval

1. Approve the Cloudflare account, project name, and Direct Upload project mode. Confirm the production branch and understand that Direct Upload cannot later become Git-integrated.
2. Build the Console from the owner-approved clean source commit: `npm run cat:console:package`. Set `$bundlePath` to the exact generated static folder.
3. Before login/upload, verify the bundle manifest and all bytes/hashes against the evidence index in this package. Confirm the bundle contains only the 13 allowlisted static files, has no private annex/provider code, and records the intended source commit.
4. Only after separate deployment approval, install/use the owner's approved Wrangler environment and authenticate with the least-privileged approved account. Create a Direct Upload project if one does not exist:

```powershell
npx wrangler pages project create
```

5. Deploy the verified directory after the owner supplies the project name:

```powershell
npx wrangler pages deploy $bundlePath --project-name <OWNER-APPROVED-PROJECT>
```

Wrangler accepts a single static asset directory; it does not accept a ZIP for this upload method. Record the deployment ID, URL, source commit, bundle-manifest hash, operator, and timestamp.

6. From the public URL, verify HTTPS, CSP/security headers, MIME types, route/deep-link refresh, asset hashes, source/evidence links, cache behavior, missing/stale labels, no private/API paths, and desktop/tablet/mobile/keyboard states. Preserve the fetched responses and owner-reviewed screenshots in the local evidence folder.

Do not deploy if rights review, bundle verification, or owner approval is incomplete. A successful local build does not establish a public deployment.
