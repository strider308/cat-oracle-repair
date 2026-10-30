# Public Evidence Contracts

Public evidence is CAT's judge-facing, deterministic summary of a decision. Each evidence kind has its own exact schema; the internal case wrapper and renderer view are not public response envelopes.

Public evidence is separated from private proof material so readers can verify the story without receiving credentials, raw model inputs or outputs, candidate source, private receipts, local environment details, or holdout contents. The validator uses an allowlisted schema and rejects unknown fields.

`PublicEvidenceV1` remains the historical execution schema. `PublicExecutedControlV1` describes one verified executed control lane and keeps source-file, canonical receipt, verifier, and lane-projection hashes distinct. `PublicAuthorityPreflightV1` records an authority-only stop without historical execution identifiers. `ACCEPTED`, `REJECTED`, and `HUMAN_REQUIRED` are distinct outcomes. An operationally inconclusive run may have a null decision. Rejection is a valid CAT decision, not an execution error.

Inference provider and model describe who proposed a patch. Execution backend describes where candidate code ran. The DP02F hero records Nebius Token Factory inference and isolated local Docker validation; it does not claim Nebius Sandbox ran the candidate.

The checked-in DP02F example shows green existing tests alongside failures in the public contract and calibrated oracle. Its candidate was rejected before hidden verification. No hidden challenge values are included.

Generate the historical V1 object with `npm run cat:evidence`. Verify that schema with `validatePublicEvidenceV1`; canonical serialization sorts object keys, and `publicEvidenceSha256` hashes those bytes. The Evidence Console selects among three fixed public fixtures; case IDs never become filesystem paths.
