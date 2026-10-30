# Sprint 6 license and provenance decision pack

**Owner decision required. No license was added and no history was rewritten.**

## Copyright and license

- The root repository has no `LICENSE` file. The prior MIT recommendation is not an owner decision.
- Confirm repository copyright authority and the contributors' right to license both pre-hackathon and hackathon contributions.
- Frozen `node-cache` 3.2.1 and comparison `node-cache` 4.0.0 fixtures carry upstream MIT notices. Keep those notices in source and distributions.
- The fixture dependency tree contains 136 package/version records: 109 MIT, 17 ISC, 5 BSD, 1 dual `WTFPL OR MIT`, and 4 without a declared license field (`colors@0.6.2`, `dateformat@1.0.2-1.2.3`, `expresso@0.9.2`, `inherits@1.0.2`). The metadata scan found no GPL/AGPL/SSPL/EUPL label among declared licenses. This is a metadata inventory, not legal compatibility approval; inspect the four missing declarations and preserve all package notices before publication.
- Root `package.json` declares no runtime or development dependencies. The fixture lockfile governs its independent build/test dependencies.
- Third-party model, dataset, trademark and fixture-source terms still need owner review. No sponsor endorsement or license grant is implied.

## History scan and archive

- The full local Git history scan found six `generic-api-key` matches: four synthetic test sentinels and two SHA-256 values in archived P03 evidence. No live credential was identified. Review the exact source lines before any public push; do not remove historical evidence or rewrite Git history.
- Commit author metadata remains present. An owner must decide whether a public release may disclose it.
- A Git archive preserves tracked commit contents as a source snapshot and omits ignored runtime evidence, but it does not remove author metadata from the underlying Git history.
- Static package manifest hashes bind the public bundle to one source SHA. The package contains no private annex or evaluator holdout by design.

## Publication options

| Option | What it preserves | Tradeoff and required owner decision |
|---|---|---|
| History-preserving repository release | Existing commit graph, authorship, and chronology | Publish only after owners approve contributor metadata, copyright authority, notices, and six historical scanner findings. Do not rewrite history. |
| Provenance-linked clean source snapshot | A reviewed source tree and source SHA, with a public statement distinguishing pre-hackathon work | Loses commit-level history in the public snapshot. Retain local Git history; publish a provenance statement and archive hash. Owner approves attribution and snapshot contents. |

Neither option is approved. Keep the archive local until the owner selects an option, approves license/copyright, and resolves attribution/notice review.
