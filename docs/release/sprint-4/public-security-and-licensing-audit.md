# Public repository security and licensing review

## Security and privacy

- Static export includes only fixed Console assets, headers and the two supported public JSON projections. It excludes sealed evidence, agent runs, validation runs, credentials and arbitrary repository files.
- Browser uses a fixed case allowlist, same-origin CSP, no inline scripts/styles, safe text DOM rendering, traversal rejection and GET/HEAD-only methods.
- Prior Gitleaks history audit found six matches: four deliberate test sentinels and two SHA-256 field/path matches. Do not report zero findings; rerun on successor. History contains author email metadata. No rotation or history rewrite occurred.
- No public deployment or push occurred. Host headers need verification on the chosen host.
- P04 private annex is absent; the P04 accepted card is excluded.

## License recommendation, pending owner selection

Recommend **MIT** as the lower-administration permissive option, subject to owner copyright and third-party-rights review. Apache-2.0 is reasonable if an explicit contributor patent grant is important; it adds notice, attribution and changed-file obligations. This is a recommendation, not a decision. Root `LICENSE` remains absent. Proposed MIT text and draft attribution are in `proposed-publication/`.

The existing `fixtures/hero/node-cache-ttl-zero-001/ATTRIBUTION.md` records copied node-cache 3.2.1 and 4.0.0 source and preserved MIT licensing. Complete a whole-repository third-party/model/data terms review before publication.

References: [OSI MIT License](https://opensource.org/license/mit), [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
