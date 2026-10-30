# One-request Nebius inference — request-specific approval proposal

**State: not authorized; zero inference POSTs.** Financial strategy Option B is selected, but no billable request is approved here.

## Proposed single operation

| Field | Proposed value |
|---|---|
| Purpose | One sanitized repair proposal; smoke is a separate billable operation and needs its own authorization |
| Provider and endpoint | Nebius Token Factory, `https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions` |
| Model | `nvidia/nemotron-3-super-120b-a12b` |
| Calls | Exactly one POST; no retry after timeout, transport failure or ambiguous response |
| Output limit | 12,000 tokens |
| Request package limit | 65,536 UTF-8 bytes |
| Response limit | 1 MiB |
| Patch boundary | Existing single allowed path `_src/lib/node_cache.coffee` |
| Spend strategy | Option B residual risk; no guaranteed monetary ceiling is claimed |
| Account reference | Owner to provide a non-secret identifier; the client cannot independently verify the API key's account identity |
| Operation ID | Owner-generated UUID, copied into `CAT_INFERENCE_OPERATION_ID` |
| Expiry | Owner to set shortly before the exact approved operation |
| Source commit/tree and implementation hashes | Pending final commit, matching remote head and clean-tree verification |
| Exact package/body SHA-256 and byte count | Pending the final-source local proposal generation |

After the final source commit is present on its selected remote, generate a local-only proposal with `npm run cat:inference-authorization-proposal -- repair <OWNER-GENERATED-UUID>`. Set `CAT_NEBIUS_ACCOUNT_REFERENCE` and, if needed, `CAT_INFERENCE_TIMEOUT_MS` first. Inspect both the sanitized package and pending JSON proposal. The command performs no GET or POST and refuses to proceed without a clean source tree and a matching remote head.

The runtime refuses to POST unless a matching approved record is supplied through `CAT_INFERENCE_AUTHORIZATION_FILE` under `.agent-runs/inference-authorizations/`. The record must bind all values above, `financialOption: "B"`, and this explicit statement: “Option B: accepts residual billing risk for exactly one request; any cost estimate is not a guaranteed ceiling; no provider-enforced hard cap is asserted.” The consumed marker is written before network I/O.

An owner must inspect the final sanitized package and verify the account reference, request identity, cost estimate and residual risk before creating an approved record. Do not include credentials in the record. Local deletion or rollback of the marker permits replay; this workflow does not claim deletion-resistant protection.

**Approval fields remain blank:** owner reference, approval timestamp, exact source and remote identities, exact package/body hashes, account reference, operation UUID and expiry. Until all are filled and reviewed, the proposed operation remains `NOT_AUTHORIZED`.
