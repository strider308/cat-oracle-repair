# Sprint 5 Nemotron integration readiness

**Status: NOT READY FOR INFERENCE. No inference POST was made.**

## Exact proposed selection

- Provider: Nebius Token Factory.
- Model ID: `nvidia/nemotron-3-super-120b-a12b`.
- Selection rule: require that exact ID in a fresh live model-list response and the NVIDIA namespace; no fuzzy fallback is accepted.
- Endpoint: the existing allowlisted Token Factory HTTPS base URL and `chat/completions` path.
- Current availability: not confirmed for Sprint 5. Prior model-list discovery failed at DNS before provider contact.

## Local request boundaries

- Existing request uses structured JSON output and a 12,000-token output cap.
- Replacement output is bounded to 65,536 bytes; the complete provider response envelope has existing bounds.
- Sprint 5 additionally rejects public request packages above 65,536 UTF-8 bytes before invoking fetch.
- The repair path disables DNS retries. An ambiguous POST must not be retried under the same authorization.
- Public projection excludes sealed challenge content, private evidence, credentials, and raw chain-of-thought fields.

These code limits reduce exposure and bound local payloads. They do not establish the provider's counted input tokens, billed overhead, account spending limit, or invoice total.

## Financial control gap

The proposed $0.10 hard ceiling is **not verified or enforceable from this checkout**. Public price arithmetic and local byte limits are not a billing control. Before any request, obtain evidence that a provider/account hard limit at or below $0.10 applies to the selected endpoint/account, including applicable fees. If the provider cannot enforce that boundary, do not issue the request under this ceiling.

## Required future authorization record

The owner must separately authorize one request bound to the final committed source SHA, unique run ID, exact model and endpoint, account identity, sanitized package SHA-256, verified spend cap, one-use authorization identifier, and expected output bound. The authorization must be durably consumed before network I/O. A timeout or ambiguous transport result ends that authorization; a new attempt needs a new decision. Sprint 5 did not create or consume such an authorization.
