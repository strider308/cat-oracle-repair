# Development Environment Freeze

## Package manager

**npm**. Use `npm ci` once a lockfile exists.

## Runtime target

- Node.js 22+
- TypeScript strict mode
- ESM
- Vitest
- Fastify for demo fixtures
- Zod for boundary/schema validation where helpful

## Critical-path dependency policy

Prefer the standard library over dependencies unless the dependency materially saves build time.

Likely Day-1 packages:
- `typescript`
- `tsx`
- `vitest`
- `fastify`
- `zod`

Do **not** put Z3 on the critical path.  
Do **not** add a vector database/RAG/multi-agent framework unless official tracks create a concrete need.

## Local tools to verify before kickoff

- `node --version`
- `npm --version`
- `git --version`
- `docker version`
- `docker run --rm hello-world`
- `gh --version`
- `python --version`
- screen recorder
- deployment account/CLI only after track/sponsor freeze
