# Evidence Console

## Purpose

The Evidence Console is a judge-facing shell for understanding one real CAT rejection: the existing test suite passed, while public semantic evidence contradicted the approved zero-TTL behavior.

## Data source

The page offers three fixed public cases. The server validates each case against its own schema and serves the selected canonical evidence object at /evidence.json. The browser normalizes only validated schema shapes and fails closed if evidence is unavailable or invalid.

## Run locally

Run npm run cat:console and open http://127.0.0.1:4173. Use npm run cat:console -- --port 0 to let the operating system select a local port. Pass `--case <public-case-id>` to choose the initial case.

Run npm run cat:console:check to validate the fixture, assets, and public-data boundaries without starting a server.

## Routes

The server allowlists /, /index.html, /styles.css, /app.js, /evidence.json, and /healthz. It serves no repository paths or arbitrary files and binds to 127.0.0.1.

## Security boundary

The server uses Node built-ins, a restrictive content security policy, and same-origin headers. The browser uses text-only DOM updates, fetches only /evidence.json, and has no external assets or telemetry. Private evidence, receipts, holdouts, candidate source, credentials, and local environment data are excluded.

## Inference and execution

Nebius Token Factory is attributed to AI inference. Candidate execution is shown as isolated local Docker (LOCAL_DOCKER_FALLBACK); the evidence does not claim Nebius Sandbox execution.

## Current case and future phases

The console exposes one historical rejection, one verified P04 `good` control lane, and one deterministic H0-1 authority preflight. It does not represent the aggregate P04 run as accepted.
