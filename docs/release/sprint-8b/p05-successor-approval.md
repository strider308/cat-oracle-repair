# P05 implementation binding V2 — approval package

**State: candidate only; not approved or activated.** Historical V1 branch/remote-head checks and V5 verification were preserved.

The successor is implemented in `src/repair/implementation-binding-v2.ts`. Its source closure includes the historical P05 closure plus the smoke entry point, shared inference authorization module, and the V2 verifier itself. It requires a clean worktree, matching commit and remote head, exact branch and remote URL, all closure files tracked, and an approval object matching the computed identity.

## Pending owner approval

Complete against the final committed source and chosen remote. No matching remote-tracking head exists for the current branch in this checkout, so this package cannot yet be approved or used.

| Field | Value |
|---|---|
| Binding version | `2` |
| Source commit SHA | Pending final commit and remote authority |
| Source tree SHA | Pending final commit and remote authority |
| Branch | `codex/cat-sprint7-competition-release` |
| Remote name and URL | Owner to confirm |
| Remote ref and head | Owner to publish/fetch and verify; must equal source SHA |
| Implementation file digest | Recompute with `prepareP05ImplementationBindingV2` |
| Owner reference and approval time | Owner to provide after reviewing the exact fields |
| Activation | Not authorized by this package |

The approval object must include `status: "approved"`, a non-empty `ownerReference`, a parseable `approvedAt`, and exact matches for version, source SHA/tree, branch, remote name/URL/ref/head and `implementationFilesSha256`. This is an owner review gate, not a cryptographic signature or evidence of external remote control.

Do not change `verifyV5Receipt` to call V2 until the owner approves this exact package and a versioned successor receipt/verifier is separately reviewed. Existing V1/V5 records remain evaluated under their original authority.
