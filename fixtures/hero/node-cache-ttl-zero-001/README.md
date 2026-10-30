# node-cache TTL zero

P03 builds the exact 3.2.1 and 4.0.0 package trees from frozen upstream source inside the pinned networkless container, then executes those build outputs. The original 3.2.1 build and eight-test Expresso suite run on every evaluation. The controller requires each candidate runtime hash to match the corresponding runtime rebuilt by the suite runner. Source tree hashes and every source file bind the build inputs. The suite result comes from process exit status and parsed test output; manifest counts are expectations only.

Before first replay on a clean checkout, prepare the frozen suite toolchain from the local npm cache:

`npm ci --offline --ignore-scripts --prefix fixtures/hero/node-cache-ttl-zero-001/suite`

This does not access GitHub or run dependency install scripts. Normal `cat:hero` and `cat:oracle` evaluations do not download sources.

Oracle V1 observes only the return value and immediate key value. S1 preserves a finite expiry, so it passes V1 while violating the sourced no-expiry clause. Oracle V2 adds the public `getTtl(key)` observation; the pinned API returns zero when a key has no expiry. V2 rejects S1 and retains the exact 4.0.0 and equivalent controls.

The equivalent implementation and S1 are local test fixtures. They are not upstream candidates. The container has no network, a read-only root and source/candidate mounts, non-root execution, dropped capabilities, no-new-privileges, and CPU, memory, PID, output, and timeout bounds. This local container boundary is not a production isolation certification.
