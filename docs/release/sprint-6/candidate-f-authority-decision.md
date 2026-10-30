# Sprint 6 Candidate-F authority decision

**Decision requested:** whether to authorize a successor contract. No Candidate-F execution occurred. The original one-evaluation authorization remains unused.

## Existing frozen authority

- Freeze commit: `5069680ff093695a227bf410eb3de88d99dce9e7`.
- Candidate artifact commit: `cec8054ba8690172a7b53267cc985a4445b7860b`.
- Frozen source hash: `80424bd379df4a836680d5ca420289c7e080a24377e61947a393f01c08d0a8c1`.
- Frozen runtime hash: `fc594a965abb22c1542d7b887a8490244454d0c9ba51e16babeaeabf456e7621`.
- Authority and candidate hashes remain unchanged; evaluation count is zero.

## Proposal only: exact dependency closure

The proposal pins lockfile SHA-256 `21c448532a8e400504c800df67ad246d6d9461c7883fc7e68861d3960ebc3ce8`, `clone@1.0.4` and `lodash@4.18.1` with lockfile integrity, 9 direct runtime specifiers and builtin `events`. The derived package-root closure contains 1,057 regular files and hashes to `2ed00926190bce0bc8b335b3d5f33bb64ac3674c43c852162fcd922085ec7f8f`. Exact path/hash rows are retained in `.verification-runs/candidate-f-dependency-closure-v2-proposed-rows.json`; focused inventory validation passed. This is review evidence, not frozen authority.

The candidate artifact stays bound to its existing commits and hashes. Do not recalculate its identity from the Sprint 6 workspace or substitute package-root rows into DP05B.

## Executor and mount rules to carry into a successor

The existing sealed runner uses Docker `run --pull=never --rm -i`, `--network none`, `--read-only`, `--pids-limit 64`, `--memory 256m`, `--cpus 1`, UID/GID `10001:10001`, `--cap-drop ALL`, `no-new-privileges`, and a 16 MiB no-exec/no-suid `/tmp`. It mounts `/candidate`, `/deps/node_modules`, and `/adapter.cjs` read-only; the probe path mounts `/candidate` and `/probe` read-only. The P03 target runner uses Docker `create` with the same network, read-only root, PID/memory/CPU, UID/GID, capability, and security limits, plus a 32 MiB no-exec/no-suid `/tmp`; it mounts the case, fixture dependencies, suite runner, and build-evidence adapter read-only. A successor must retain these controls, set bounded time/output and verify container removal, keep sealed holdouts inaccessible to the candidate, and keep builder-visible evidence separate from evaluator evidence. These are existing source controls, not evidence that Candidate F has been executed under them.

The proposed contract derives file closure from committed lock metadata and hashes rather than loading candidate code and trusting host `require.cache`. It rejects row/path disorder, extra or changed files, symlinks, native addons, lock mismatch and version substitution.

## Receipt identity and remaining assumptions

A successor must bind its contract hash, exact lock bytes, ordered package path/hash rows, candidate source/runtime identities, executor image/configuration, and run ID into generation/evaluation receipts before execution. Preserve the historical DP05B receipt and make supersession explicit.

Remaining assumptions for owner/security review: registry integrity and package metadata are trusted only through pinned lock integrity plus file hashes; host and container runtime remain trusted; mount semantics and cleanup are enforced; no filesystem/process side channel leaks sealed material; and independent evaluation controls remain inaccessible.

## Decision requested

Either keep the original freeze as the only authority and defer Candidate F, or commission a separately reviewed authority successor before any evaluation. The tested proposal does not authorize execution. No decision is made here.
