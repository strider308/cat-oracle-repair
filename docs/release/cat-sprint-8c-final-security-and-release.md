# CAT Sprint 8C — final security and release status

**Disposition: HUMAN REVIEW REQUIRED.** Local preparation only. No provider inference POST, remote publication, deployment, upload, or submission occurred.

## Source and validation

- Starting source: `0d4bb937820201e71723c966def37f938fdf2156` on `codex/cat-sprint7-competition-release`.
- Final source SHA/tree: recorded in the unique native validation manifest and reported with the final commit result.
- Final working tree: verify clean after commit; ignored local evidence and static packages remain local.
- Native project validation: the final full run passed 351 tests, 0 failed. The active Tri-Tier receipt names its unique immutable run manifest under `.agent-runs/validation-runs/`; the manifest records source SHA/tree, clean-tree state, diff/output hashes, test summary, previous-run references, and disposition. Earlier full runs include a transient P03 calibration failure and a Windows temporary-directory `EBUSY`; focused reruns passed, and all failed run logs remain in their own validation directories with hashes.
- Separate `npm run cat:oracle` and `npm run cat:sealed` checks were blocked by Docker Desktop returning `permission denied` for `npipe:////./pipe/dockerDesktopLinuxEngine`. These checks did not establish an oracle/sealed result.
- `npm run cat:console:check` passed and reported P04 omitted. The static package passed with 13 manifest files; independent hash and byte-count checks passed, and the package manifest bound its source commit. The final bundle is local under `.verification-runs/cat-console-static-*`; the command prints its exact path and source SHA.
- Sprint 8B's earlier failed run output was overwritten by the old fixed log path. The prior task record reports an earlier failure, but its raw output is not present in the repository and cannot be independently reproduced. No reconstructed log is represented as original evidence.

## Owner approval authenticity and replay

The Sprint 8B approval JSON trusted a locally writable `ownerReference`; it did not prove who approved the request. Its `.consumed` marker also cannot resist deletion or rollback. No independently controlled signer or consumption ledger is available in this task. The runtime now rejects all inference POSTs with `INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE`, including both smoke and repair paths, before calling `fetch`. The focused authorization tests passed (4 tests), and the focused P05 V2 tests passed (2 tests). Both the required Sol security review and Luna inventory were attempted, but their agents returned an account usage-limit error; no agent participation or review is claimed.

For a future request, the owner must first provision an out-of-repository signing authority. The signer must approve a canonical request-specific document binding the exact source SHA/tree, implementation hashes, account reference, endpoint/model, purpose, operation ID, canonical body and repair-package hashes, timeout, output and response limits, one-POST count, Option B estimate and residual risk, approval time, and expiry. The verifier must anchor the signing public-key fingerprint in owner-controlled policy that the repository process cannot replace. Keep the private key outside the repository and release package. A signature alone is insufficient: a separately administered ledger must atomically reserve the authorization ID before the provider call and reject reuse after deletion, rollback, concurrent use, crash, or ambiguous response. These controls have not been implemented or approved. Until both are independently tested, keep inference blocked.

Owner-operated interim procedure: do not create an `approved` local JSON record or run either inference command. Have the owner review the final request and risk packet out of band, and defer the sponsor POST until authenticated signing and independent consume-once state exist. No amount of local file review makes the current JSON an authenticated approval.

## P05 successor status

Historical P05 V1/V5 code and identities remain unchanged. V2 is a candidate only and is not activated. Its `ownerReference` approval is locally forgeable; its remote-tracking ref is local evidence rather than proof of publication; and ignored executable shadow paths are not included in the current untracked-path check. Do not approve or run V2 based on this checkout. Before a future activation, independently establish source/remote authority, verify committed and working bytes and all executable resolution paths, and bind approval through the external signer described above. No remote ref was fabricated or rewritten.

## Exact Nemotron request and financial risk

The target experiment is one sanitized node-cache repair proposal using Nebius Token Factory at `https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions`, model `nvidia/nemotron-3-super-120b-a12b`, strict structured output, a 12,000-token output limit, a 1 MiB response limit, and only `_src/lib/node_cache.coffee` as an allowed patch path. CAT remains the deterministic judge. Model availability was observed in the account-visible read-only model list on 2026-10-28; refresh it immediately before any future request. The old GET did not authorize inference.

The account-visible metadata recorded input at `$0.30/1M` tokens, output at `$0.90/1M`, and a 262,144-token context. At those rates, a context-sized input plus 12,000 output tokens is approximately `$0.08945` before tax or other charges. This is a planning estimate, not a guaranteed charge ceiling; the context calculation may double-count output, package bytes are not token counts, and current account pricing/limits must be rechecked. Option B is the strategic choice, but owner acceptance for this exact operation is absent. Nebius's [Nemotron Token Factory model page](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference) is the public model reference; account-specific metadata and billing behavior still require fresh owner-side verification.

The exact body/package hashes, source binding, account reference, operation UUID, expiry, signer identity, and ledger reservation are intentionally pending. The previous proposal generator refuses the current branch because no matching remote-tracking head exists. See [the request authorization packet](sprint-8c/exact-request-authorization-packet.md). No request was sent.

## Submission package

- Source snapshot: this committed local candidate only; no public source URL or rights-cleared source archive exists yet.
- License: MIT remains a candidate only. Resolve contribution ownership, copyright holder/year, fixture/dependency license gaps, notices, trademarks, and author-history disclosure before creating or publishing a root license/source package.
- Console: rebuild the allowlisted static package from the final committed source. Keep its manifest and bundle local pending host approval. Existing handoff instructions are in `docs/release/sprint-7/static-hosting.md`.
- Oracle/evidence: public oracle remains `WEAK`; P03 remains `HISTORICAL_INCOMPLETE`; P04 remains omitted; Candidate F was not run. Do not claim `PROVEN`.
- Browser/video: the Codex browser safety check previously blocked navigation before a page was established. No fresh viewport acceptance or video was captured. Follow `docs/release/sprint-8b/viewport-video-procedure.md` on an owner-approved browser/recorder.
- Devpost and eligibility: retain the existing Sprint 8B/Sprint 7 drafts and official eligibility checklist as drafts. Confirm eligibility, historical-work disclosure, links, and limitations before submission.

## Freeze and submission checklist

Development freeze: Friday, October 30, 2026, 12:00 PM IST. Submission sprint runs from noon; stated deadline is 10:30 PM IST.

Before freeze, the owner should review the final source SHA and validation evidence; choose a legitimate private remote/snapshot authority; approve rights and notices; recheck account model availability and prices; decide whether a live sponsor experiment can be supported by external signing and consume-once infrastructure; and approve the exact host and authentic recording process. If either security authority is unavailable, keep inference disabled and submit only if the rules permit the disclosed offline demonstration.

After freeze, make no elective source changes. Revalidate the exact frozen SHA; verify the static bundle hashes and hosted routes/headers only after separate deployment approval; check all links and disclosures; capture and review the owner-approved video; complete the eligibility checklist; then obtain explicit approval for any publication, deployment, upload, or Devpost submission. No such external action is authorized by this packet.
