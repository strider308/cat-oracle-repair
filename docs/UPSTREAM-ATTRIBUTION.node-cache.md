# node-cache upstream attribution — reviewed draft

The repository pins node-cache 3.2.1 at commit `bc49b373396cdbe4c1de612b866b4fece4c8471e` and node-cache 4.0.0 at `59d947471d0dcc2d305d1675e80c04e4a598cc86`, as recorded by `fixtures/hero/node-cache-ttl-zero-001/manifest.json` and `ATTRIBUTION.md`.

In a local comparison against primary files staged under `upstream-verification/`, the following tracked files matched the pinned source bytes:

- 3.2.1 `_src/lib/node_cache.coffee`: SHA-256 `949200dc3afdc0ee284af021b757c0f8f8d52a466f17f6b1859958e6932544ce`.
- 3.2.1 `LICENSE`: SHA-256 `9fe226a90a1549d833ccb09feee2041d52987a9f1bdbc47321df32ffcfc503e2`.
- 4.0.0 `_src/lib/node_cache.coffee`: SHA-256 `2b5819050c06c30f6b60e58cc30e2beae05efb2b4742689f862551a1da34f95b`.
- 4.0.0 `LICENSE`: same SHA-256 as the 3.2.1 license.
- 4.0.0 README snapshot: SHA-256 `08a754db9c0a3091036fc3e6ce385a66c1562ae22c0acf7829cd1ac9db105059`.

These retained MIT license files state `Copyright (c) 2016 mpneuried`. The 4.0.0 README's embedded MIT attribution states `Copyright © 2013 Mathias Peter, http://www.tcs.de`. Preserve these notices verbatim with corresponding copies.

Do not describe the complete fixture package trees as byte-for-byte copies of those upstream commits. The local generated `index.js` files are build outputs (the pinned commits do not contain them at those paths) with local 2026-10-06 banners. The 3.2.1 `package.json` was modified/reformatted and adds `grunt-cli` 1.5.0. The suite copy also has line-ending differences. Describe the CoffeeScript sources, tests, and license files that were verified against pinned commits, then identify generated JavaScript and modified metadata as local derived artifacts. The equivalent control and S1 remain local test implementations, not node-cache code.

This attribution draft does not establish CAT's ownership or authority to license CAT-original files, and it does not imply node-cache endorsement.
