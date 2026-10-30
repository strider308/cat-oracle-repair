# One-request Nemotron repair — approval form

**Decision: NOT AUTHORIZED. No inference POST was made.** Complete and approve every field before a future run.

| Field | Proposed bound |
|---|---|
| Provider/model | Nebius Token Factory / `nvidia/nemotron-3-super-120b-a12b` |
| Source identity | Sprint 3 baseline `1509bbb32931a309c5ffb67cc2118582f285c1d0`; rebind to exact approved successor SHA |
| Endpoint | Token Factory OpenAI-compatible `chat/completions`; reverify exact base URL before a future request |
| Calls | Existing path makes one inference call per process with retries disabled; no durable global one-use authorization lock |
| Context sent | Existing 15-file public repair package only; modifiable path `_src/lib/node_cache.coffee` |
| Output | `max_tokens=12000`; replacement ≤65,536 bytes; full response ≤131,072 bytes |
| Timeout | 180 seconds; ambiguous transport result is INCONCLUSIVE and must not be retried under same approval |
| Current public price | $0.30/M input; $0.90/M output; 256K context, checked 2026-10-28 |
| Proposed ceiling | $0.10 — **not enforceable with available provider/account limits** |
| Live discovery | Latest `npm run cat:preflight` failed DNS `ENOTFOUND` before provider contact; refresh immediately before a future request |
| Required post-run | Preserve request/response hashes and provider IDs; apply only validated proposal; independently run public and sealed verification |

At published rates, 12,000 output tokens are approximately $0.0108. A purely mathematical $0.10 remainder corresponds to about 297,333 input tokens, but context, provider-added tokens and billing limits matter. Current CAT code has no enforceable input-token cap and no provider/account hard cap was verified, so this arithmetic is not a billing guarantee.

**Smallest correction:** verify and set an account/provider hard spending limit ≤$0.10 for this isolated experiment and preserve evidence that it applies to the selected endpoint/account, including fees. If unavailable, do not authorize under this ceiling. A request-body byte limit alone is insufficient. Owner approval must bind exact source SHA, run ID, model, endpoint, package hash and spend. No retry after an ambiguous POST; a new attempt needs new authorization.

Price/model reference: [Nebius NVIDIA Nemotron catalog](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference).
