# Sprint 8C — exact request approval packet

**State: DRAFT / NOT AUTHORIZED / ZERO POSTs.** This records the exact intended experiment shape, but it is not executable approval. Request-specific identities remain pending.

## Frozen request shape

| Field | Value |
|---|---|
| Purpose | One repair proposal for the sanitized node-cache zero-TTL case |
| Provider | Nebius Token Factory |
| Endpoint | `https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions` |
| Model | `nvidia/nemotron-3-super-120b-a12b` |
| Method / count | One `POST`; no retry after reservation, timeout, transport failure, or ambiguous outcome |
| Request | Strict JSON schema; sanitized public repair package, maximum 65,536 UTF-8 bytes |
| Output / response | At most 12,000 output tokens; at most 1 MiB response body |
| Patch boundary | `_src/lib/node_cache.coffee` only |
| Evaluation | CAT's constrained deterministic evaluator; model output is only a proposal |
| Financial strategy | Option B, only after explicit acceptance of residual billing risk for this exact request |

## Exact HTTP request form

The request body is generated deterministically from the sanitized package and `REPAIR_RESPONSE_SCHEMA` after the final source commit. In repository order, the implementation serializes this form:

```json
{
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "messages": [{"role": "user", "content": "<exact sanitized package bytes>"}],
  "temperature": 0,
  "max_tokens": 12000,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "cat_repair_proposal",
      "strict": true,
      "schema": "<REPAIR_RESPONSE_SCHEMA from src/repair/model-response.ts>"
    }
  }
}
```

The only permitted edit path is `_src/lib/node_cache.coffee`; CAT validates the returned structured proposal and performs deterministic evaluation. The bearer token is supplied only by an owner-administered executor's protected secret store and is never placed in this packet, repository, shell command, or request-body artifact. The final canonical body bytes, package bytes, SHA-256 digests, and byte counts must be independently inspected before any owner decision. This template is not approval.

## Values the owner must bind before any authorization

| Identity or bound | Required value |
|---|---|
| Source commit and Git tree | Pending final commit and owner-selected source authority |
| Branch, remote URL/ref/head | Pending; remote head must be independently verified to equal the approved source SHA |
| Runtime implementation file hashes | Pending exact-source generation and review |
| Account reference | Owner supplies a non-secret identifier; it does not prove which account the API key uses |
| Operation UUID and authorization ID | Owner-generated, unique values |
| Canonical request body SHA-256 and byte count | Pending final sanitized package generation |
| Repair package SHA-256 and byte count | Pending final sanitized package generation |
| Timeout | 180,000 ms maximum for repair; exact value to be reviewed and signed |
| Approval issue time and expiry | Owner sets shortly before use; expiry must be no more than 30 minutes after approval |
| Signer identity/key fingerprint | Not provisioned; must be anchored outside the repository writable boundary |
| Independent consume-once ledger reservation | Not available; required before any provider call |

## Cost estimate and residual risk

Nebius's public Token Factory model page listed `$0.30/1M` input tokens and `$0.90/1M` output tokens for this model when checked on 2026-10-29 ([current listing](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference)). At the app's 12,000 output-token ceiling, output alone would be `$0.0108`; a hypothetical full 262,144-token input adds `$0.0786432`, for a scenario estimate of `$0.0894432` before tax or account charges. Actual request tokens are not yet measured, rates may change, and neither the app limit nor this estimate is a provider-enforced dollar cap. Account-visible billing and credential-to-account binding are unverified. Refresh them immediately before approval. Option B is not a cost guarantee.

## Approval protocol required to unblock

1. Generate the sanitized package and canonical request body from the final clean committed source. Independently verify source SHA/tree, file hashes, account reference, endpoint, model, and both package/body hashes.
2. Review the cost estimate and explicitly accept the Option B residual billing risk for this operation.
3. Have the owner-controlled external signer sign the canonical authorization containing every field above. Pin the signer public-key fingerprint in owner-controlled policy that repository files and request environment variables cannot replace. Never place the private key in this repository or release package.
4. Atomically reserve the authorization ID in an independently administered consume-once ledger before network I/O. The ledger must reject concurrent reuse and retain the consumed state after authorization/marker deletion, state rollback, power loss, process crash, or ambiguous HTTP outcomes.
5. Only after the verifier and ledger adapter exist and pass adversarial tests may one POST be enabled. Any ambiguity burns the authorization; do not retry.

Those signing and ledger authorities are not available in this task. There is no owner-administered executor, signer, external ledger, verified account/key custody, or owner-approved remote source ref in this checkout. Runtime code therefore blocks both smoke and repair POSTs, even if an `approved` JSON file and `ownerReference` are supplied. No owner signature is claimed, no ledger reservation exists, sponsor eligibility is NOT ESTABLISHED, and this packet must not be used to authorize a request.
