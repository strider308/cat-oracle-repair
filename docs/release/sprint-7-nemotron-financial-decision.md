# Sprint 7 Nemotron and financial decision pack

**State: NOT AUTHORIZED. No inference POST was sent.**

## Current evidence

- One read-only GET to `https://api.tokenfactory.nebius.com/v1/models` completed on 2026-10-28 with `CAT_NETWORK_ATTEMPTS=1` and no retry.
- Exact model `nvidia/nemotron-3-super-120b-a12b` appeared in the account-visible model list. This establishes current account-visible availability only.
- The standard list response exposed model IDs but did not refresh pricing, context/output limits or account identity. The Sprint 6 verbose response is historical metadata, not current pricing confirmation.
- The official model-list API documents availability/basic model information. The official billing documentation describes real-time balance debits and automatic card charges when the configured billing threshold is reached or the balance is negative; it does not establish a per-request `$0.10` hard stop. [List models API](https://docs.tokenfactory.nebius.com/api-reference/models/list-models), [Billing & Consumption](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new).
- A credit balance or an estimated token cost is not a provider-enforced hard cap. Taxes and other account charges remain possible.
- Local code limits the request package to 65,536 UTF-8 bytes and output to 12,000 tokens, uses strict JSON schema and allows one modification path. Those limits do not independently prove a maximum charge.
- Sprint 7 changes force no DNS retry for repair inference and require exactly one attempt in receipt verification. Focused tests exercise omitted caller retry options and reject two-attempt receipts.
- The P05 source-binding check still requires its historical branch and matching remote head. The current release branch cannot run that path. This authority check was not relaxed.

## Exact experiment shape

The proposed demonstration uses one sanitized public repair package for the node-cache issue, exact model `nvidia/nemotron-3-super-120b-a12b`, the allowlisted Token Factory regional endpoint, 12,000 maximum output tokens, strict structured output and one allowed patch path. The model proposes only; CAT's constrained evaluator remains the acceptance authority. Private holdouts, credentials and privileged environment data are excluded. If an outcome is ambiguous after POST start, mark it `INCONCLUSIVE`; do not retry.

## Owner must select one option

| Option | Decision |
|---|---|
| A | Keep `$0.10` as a hard requirement. No inference unless an enforceable account/provider hard stop is independently verified. |
| B | Accept specified residual billing risk for one tightly bounded request. State the spend estimate and explicitly acknowledge that it is not a guaranteed ceiling. |
| C | Defer inference and accept the risk that sponsor eligibility may be insufficient. |

No option is selected here. Do not infer approval from a model-list GET, hackathon deadline, or this pack.

## Request-specific authorization must bind

- final commit SHA and Git tree SHA;
- implementation-file hashes and the authorized branch/remote identity;
- owner-selected non-secret account reference;
- exact endpoint and model ID;
- operation ID, canonical public request-package SHA-256 and byte count;
- timeout, one-attempt rule, output-token limit and response-size limits;
- expiry and selected financial option with accepted residual risk;
- explicit statement that only one POST is authorized, with no retry after ambiguity.

The current code does **not** implement durable one-use authorization or its consumed-before-network state. Do not create an authorization file or execute a POST on the assumption this feature exists. A separate code/source-binding review and explicit request-specific owner authorization are required.

**Current count:** GET 1 in this Sprint 7 verification; inference POST 0. **Live result:** `NOT_EXECUTED`.
