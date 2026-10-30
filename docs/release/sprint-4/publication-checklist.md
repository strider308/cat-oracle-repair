# Publication and submission checklist

## Before public repository release

- [ ] Owner selects MIT or Apache-2.0 and confirms copyright authority.
- [ ] Add approved root license and third-party notices; retain node-cache notices.
- [ ] Decide whether author email in Git history may be public. If not, approve a provenance-linked metadata-free/squashed release snapshot; do not rewrite preserved history silently.
- [ ] Rerun Gitleaks; inspect each finding and retain historical false-positive classifications.
- [ ] Verify no secrets, sealed annex, holdout contents, local databases, environment files or generated evidence enter the public tree.
- [ ] Close or explicitly disclose P04 verification gap; current Console omits P04.
- [ ] Run full successor suite and Tri-Tier validator; preserve exact output/source SHA.
- [ ] Verify clean archive setup and public fixture reproduction.

## Before hosting

- [ ] Owner authorizes a host and public exposure.
- [ ] Build static bundle from exact committed SHA; inspect allowlist and hashes.
- [ ] Test CSP, nosniff, referrer, COOP/CORP, permissions and caching headers on actual host.
- [ ] Verify root/path-prefix behavior, two supported cases, malformed routes and cache policy.
- [ ] Capture desktop, tablet and 320px screenshots; keyboard/reduced-motion checks; failure states.
- [ ] Record stable judge URL and rollback artifact.

## Before YouTube / Devpost

- [ ] Approve final Devpost/demo script; disclose prior work accurately.
- [ ] Capture actual local footage under 3 minutes without implying live inference.
- [ ] Review screenshots, architecture image, attribution, marks and sponsor feedback.
- [ ] Confirm judge access to repo/demo without credentials.
- [ ] Submit only after approvals; save URL and exact source SHA.

No boxes are checked here. Nothing has been published, pushed, deployed, uploaded or submitted.
