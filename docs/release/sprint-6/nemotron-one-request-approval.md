# One-request Nemotron observation proposal — owner approval packet

**Status: prepared for owner review; not authorized. No inference POST was issued.** This is a proposal request, distinct from CAT's full historical source-repair workflow. The production inference guard remains fail-closed.

## Operation

- Purpose: ask Nemotron to choose one source-bound H0-2 fixture scenario and propose its expected observable response with a short rationale.
- Source: the exact committed SHA, source tree, contract, suite, scenario catalog, package, prompt, and HTTP body hashes are recorded in `.verification-runs/oracle-observation-proposal/preparation.json` and `request-package.json`.
- Endpoint: `https://api.tokenfactory.nebius.com/v1/chat/completions`.
- Model: `nvidia/nemotron-3-super-120b-a12b`.
- Request method: one POST, 30-second timeout, no retries, no retry after an ambiguous result.
- Output ceiling: 192 completion tokens; 1,024 bytes of model content; 1 MiB HTTP envelope.
- Schema: only a listed `scenarioId`, `field=response`, `expected=ALLOW|DENY`, and a rationale up to 160 characters. CAT checks the proposal against H0-2 and independently runs the selected scenario against four source-bound implementations.
- Prompt exclusions: no implementation identities, control roles, survivor outcome, repaired oracle, post-repair matrix or successful assertion.

## Financial exposure

The preparation manifest records the final exact HTTP body byte count/hash and a rough estimate using the previously recorded public list rates ($0.30 per million input tokens, $0.90 per million output tokens). The estimate treats every body byte as one input token and the full 192 output tokens as billed. This is not a guaranteed upper bound or provider-enforced ceiling; actual tokenization, account billing, tax and other charges can differ. Refresh current account pricing immediately before any approval. No verified account hard spend cap exists in this evidence.

## Authorization and custody status

The local environment previously returned an account-visible model list on a read-only GET, including the model ID. This proves neither the account owner nor credential custody. No credential value is stored in the repository or emitted in this packet. No external signer, signer key anchored outside the repository, or durable independent consume-once ledger is configured. Consequently there is no safe local route to consume an owner approval and send exactly one request while preserving CAT's existing production guarantee. A local approval file or command-line confirmation would weaken that guarantee and is not used.

**Owner action required:** provide/authorize an independently administered executor that verifies the exact source and body hashes, keeps credentials in protected storage, authenticates a request-specific approval, atomically consumes a one-use authorization before network I/O, disables retries, and captures the genuine bounded provider response and usage. Then approve the exact operation and residual billing risk using a new packet generated for the final source. Without that infrastructure and approval, sponsor eligibility remains **NOT ESTABLISHED**.

## Execution result

No inference response or usage exists. The locally exercised response examples are explicitly labeled `SIMULATED_TEST_FIXTURE_NOT_PROVIDER`; CAT's deterministic evaluation of those simulations is not sponsor-model use. Read-only model-list GETs are not an inference demonstration.
