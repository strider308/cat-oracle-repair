# Third-party notices and distribution scope

These notices cover observed vendored source and known fixture dependency gaps; they are not a complete license compatibility opinion. Retain original upstream license files with every copied source. A CAT root license, if approved, applies only to CAT-original material and does not supersede upstream terms.

## Copied node-cache source

The repository includes node-cache 3.2.1 source under `fixtures/hero/node-cache-ttl-zero-001/suite/source/` and `upstream/3.2.1/`, and node-cache 4.0.0 source under `upstream/4.0.0/`. The tracked upstream `LICENSE` files state the MIT License and `Copyright (c) 2016 mpneuried`. The fixture `ATTRIBUTION.md` and manifest record upstream commit identities; those identities have not been independently checked against upstream hosting. Keep each original `LICENSE` file beside its source.

The DP05B source and reproduction copies also contain node-cache license files; retain those copies. The repository's `candidates/equivalent` and `candidates/survivor-s1` are identified by the fixture as CAT test implementations, not copied node-cache source.

## Locked fixture dependencies with missing package license metadata

The existing release dependency-license inventory flags these package versions as lacking a declared license field in their installed package manifests. Local installed package text provides the evidence below. Generated `node_modules` is not tracked by Git and is not part of the source-only archive; if a release bundles it, include or resolve each applicable notice first.

| Package | Observed license and attribution |
|---|---|
| `colors@0.6.2` | MIT; `MIT-LICENSE.txt` names Marak Squires and Alexis Sellier, copyright 2010. |
| `dateformat@1.0.2-1.2.3` | MIT; README names Steven Levithan, copyright 2007–2009. |
| `expresso@0.9.2` | README includes MIT terms and copyright 2010 TJ Holowaychuk. Installed `deps/jscoverage/COPYING` contains GNU GPL version 2. Whether that component is shipped in any release bundle remains unresolved. |
| `inherits@1.0.2` | ISC; `LICENSE` names Isaac Z. Schlueter. |

The existing dependency inventory records 136 package/version entries. Review the full inventory and exact build/distribution scope before release; raw lockfile metadata is not a substitute for package-license review. Do not distribute an installed or built dependency tree until all included files and licenses are covered.

## Additional owner review

Review fixture data, all other third-party source, model/service terms, marks, and sponsor wording in the exact release archive. Do not imply NVIDIA/Nebius endorsement. Decide whether to publish preserved Git metadata (which contains a personal author email) or a provenance-linked reviewed snapshot. No sponsor endorsement is claimed.

**Scope:** This is a source-only release. No installed dependency tree (`node_modules`) or distributable dependency-bundled binary is included. Reassess all notices and compatibility obligations before redistributing bundled dependencies or binaries.

## Attribution qualifications

The repository's `UPSTREAM-ATTRIBUTION.node-cache.md` says the frozen package and test source are byte-for-byte copies. That wording is not accurate for the entire trees. The tracked CoffeeScript sources and retained MIT files (plus the 4.0.0 README snapshot) were byte-verified against the pinned upstream commits. The generated JavaScript is local build output, 3.2.1 `package.json` is modified, and the suite tree has line-ending differences. See `UPSTREAM-ATTRIBUTION.node-cache.reviewed.md`; retain original upstream notices and mark generated/modified files as derived.

The 4.0.0 README contains an additional MIT attribution, `Copyright © 2013 Mathias Peter, http://www.tcs.de`, which should remain alongside the retained LICENSE notice (`Copyright (c) 2016 mpneuried`).
