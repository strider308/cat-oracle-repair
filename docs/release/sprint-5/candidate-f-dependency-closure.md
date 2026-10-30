# Candidate-F dependency closure V2 proposal

**Authority: proposal only. Candidate F was not executed.** This proposal does not alter the DP05B freeze or its source/runtime candidate identities.

The current P03 runtime dependency helper loads entry points and reads host `require.cache`. That discovers the current host's load graph after executing module initialization, so it is not suitable as a deterministic authority for Candidate-F runtime bytes.

The proposed contract is `benchmark/protocol/candidate-f-dependency-closure-v2-proposal.json`. It binds the existing DP05B source candidate commit, runtime candidate hash, and trusted freeze; records the exact direct runtime specifiers (`lodash/assignIn`, `lodash/isArray`, `lodash/isString`, `lodash/isFunction`, `lodash/isNumber`, `lodash/isObject`, `lodash/size`, `lodash/template`, and `clone`), plus the built-in `events`; pins the lockfile SHA-256 and exact package versions/integrities (`lodash@4.18.1` and `clone@1.0.4`); and binds a 1,057-file package-root inventory digest.

The proposed checker reuses `inventoryDependencyV1` for each exact locked package root without loading package code. It derives names and versions from the lockfile, checks package metadata, compares exact sorted path/SHA-256 rows, and rejects a lock mismatch, row disorder, additional or changed files, unsafe paths, native add-ons, and symlinks. It remains separate from the frozen Candidate-F execution path until a future owner-approved successor adopts it.

The current recovery workspace contains the exact 4,219-file dependency tree from the read-only release clone. The existing controlled-profile check confirms its full `DependencyInventoryV1` hash matches the frozen `a0923da0…` identity, and the proposal separately inventories the two runtime package roots without loading package code. This restores the local validation fixture; it does not change the frozen profile, establish a successor authority, or authorize Candidate F. Do not alter the historical full-tree hash or execute Candidate F under the proposal.
