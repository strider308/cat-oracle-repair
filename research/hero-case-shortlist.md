# Hero case shortlist

| Candidate | Repository | Authority | Score | Decision | Reason |
|---|---|---|---:|---|---|
| HC-01: `node-cache` zero TTL update deletes an existing key | [node-cache](https://github.com/node-cache/node-cache) | Maintainer release fix, pinned v4.0.0 source and API docs | 9/10 | Selected | JavaScript behavior, MIT, old source and suite reproducible, explicit maintainer fix, one-call witness, known-good and equivalent controls. |
| HC-02: `p-limit` issue #25 | [p-limit](https://github.com/sindresorhus/p-limit) | [Issue #25](https://github.com/sindresorhus/p-limit/issues/25) | 4/10 | Rejected | Enhancement request does not establish one binding expected behavior or a maintainer-confirmed correction. |
| HC-03: `lru-cache` `has()` semantics, issue #346 | [lru-cache](https://github.com/isaacs/node-lru-cache) | [Issue #346](https://github.com/isaacs/node-lru-cache/issues/346) | 5/10 | Rejected | Documentation interpretation and fix status are ambiguous; not a sufficiently clear independent oracle for this bounded run. |

Scores weigh source authority, suite-green evidence, clarity, reproducibility, licensing, and viable controls. The scores are a selection aid, not outcome evidence.
