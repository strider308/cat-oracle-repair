# Nebius Capability Report

## Run Metadata

- Date: 2026-10-06
- CAT branch: `hackathon/nebius-nvidia-cat-r5-20261006`
- CAT commit at report creation: `bb3340a60653befc563c12b1c65db68c4a7d765d`
- Baseline: `862b88b522e2284090f8bc2344e5ba48fdd63c5b`
- Node: `v22.22.3`
- npm: `10.9.8`
- OS: Windows 11
- Shell: PowerShell `7.6.6`

## Token Factory

- Authentication: `TOKEN_FACTORY_AUTH_MISSING`; `NEBIUS_API_KEY` was absent. No credential value was read or printed.
- Base endpoint: `https://api.tokenfactory.nebius.com/v1/`
- Models endpoint: `GET /models`; documented at [List models](https://docs.tokenfactory.nebius.com/api-reference/models/list-models).
- Inference endpoint: `POST /chat/completions`; documented at [Create chat completion](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion).
- Authentication documentation: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart) describes bearer API-key authentication.
- Structured output: the [JSON output guide](https://docs.tokenfactory.nebius.com/ai-models-inference/json) documents JSON response modes. Support for an account model is unverified.
- Actual model candidates: `UNKNOWN`; account discovery was not run.
- Selected NVIDIA model: `UNKNOWN`.
- Real inference: `NOT_ESTABLISHED`; no request was sent.
- Request ID: `UNKNOWN`.
- Operation ID: `UNKNOWN`.
- Latency: `UNKNOWN`.
- Token usage: `UNKNOWN`.
- Provider-reported cost: `UNKNOWN`.
- Limitations: no account-authenticated provider evidence exists. `npm run cat:preflight` and `npm run cat:smoke` require `NEBIUS_API_KEY`.

## Sandboxes

- Documentation: [Sandbox overview](https://docs.tokenfactory.nebius.com/sandboxes/overview), [spawn instance API](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance), [cancel operation API](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation), and [branching guide](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching).
- Documented access requirements: current API docs require IAM bearer authentication and a project identifier; `NEBIUS_IAM_TOKEN`, `NEBIUS_PROJECT`, and `NEBIUS_AI_PROJECT` were absent. Documentation also identifies Sandboxes as beta and describes an access request path.
- Account access: `NOT_ESTABLISHED`.
- Command executed: none.
- stdout / stderr / exit status: `NOT_APPLICABLE`; no operation was created.
- Provider operation ID: `UNKNOWN`.
- Timeout: account behavior `NOT_ESTABLISHED`; the API documents a spawn timeout parameter.
- Cancellation: account behavior `NOT_ESTABLISHED`; the API documents operation cancellation.
- Reconciliation: `NOT_ESTABLISHED`.
- Branching: account behavior `NOT_ESTABLISHED`; SDK docs describe branch/checkpoint behavior.
- Cleanup: `NOT_APPLICABLE`; no resources were created.
- Network controls: account configuration `NOT_ESTABLISHED`.
- Secret isolation: account configuration `NOT_ESTABLISHED`.
- Limitations: documentation describes API behavior, not access or security settings on this account. No sandbox request was made.

## Evidence Table

Code validation: `npm test` — 13 tests passed, 0 failed, 0 skipped; 158.732 ms. `npm run cat:preflight` and `npm run cat:smoke` each returned `TOKEN_FACTORY_AUTH_MISSING` with exit code 2 and sent no provider request.

| Capability | Result | Evidence | Confidence |
|---|---|---|---|
| Repository recovery | PASS | Verified R5 branch at `bb3340a60653befc563c12b1c65db68c4a7d765d`; baseline is an ancestor; M0 remains at `4c4a61f095e38cb9547fce068a35cc5cab3e378e`. | High |
| Core acceptance and receipt checks | PASS | `npm test`: 13 passed, 0 failed. | High for covered cases |
| Token Factory authentication | NOT_ESTABLISHED | Existence-only check found no `NEBIUS_API_KEY`. | High |
| NVIDIA model discovery | NOT_ESTABLISHED | No authenticated `/models` request. | High |
| NVIDIA inference and structured output | NOT_ESTABLISHED | No authenticated inference request; docs describe JSON mode but model support is unknown. | High |
| Sandbox account access | NOT_ESTABLISHED | Required IAM token and project variables absent; no account request. | High |
| Sandbox timeout/cancellation/branching | NOT_ESTABLISHED | Documented API/SDK paths only; no account probes. | High |
| Sandbox isolation controls | NOT_ESTABLISHED | No account configuration or runtime evidence. | High |

## Unknowns

- Which NVIDIA/Nemotron model IDs this account can access.
- Whether a discovered model accepts JSON mode and returns the required smoke shape.
- Request, operation, latency, usage, and cost metadata for a real inference.
- Whether this account has Sandbox beta access and how its security controls are configured.
- Sandbox execution, timeout, cancellation, reconciliation, cleanup, and branching results.

## Gate

`WP1_BLOCKED`
