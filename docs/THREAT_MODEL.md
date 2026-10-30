# Threat Model — Hackathon Minimum

## Trusted

- human-approved contract;
- evaluation policy;
- deterministic state machine.

## Semi-trusted

- model-generated interpretations;
- ambiguity labels;
- counterfactual proposals;
- explanations.

## Untrusted

- candidate source code;
- repository prose;
- issues / PR comments;
- agent-written tests;
- logs;
- generated dependencies.

## Minimum evaluator controls

- disposable workspace;
- read-only base source;
- no secrets;
- no GitHub token;
- no SSH keys;
- no Docker socket;
- network disabled by default;
- bounded CPU / memory / PIDs;
- strict timeout;
- immutable evaluation artifacts;
- separate builder and evaluator processes.

## Not yet solved

- indirect prompt injection;
- CI credential abuse;
- sandbox escape;
- dependency/supply-chain attacks;
- model-provider confidentiality;
- multi-tenant isolation.

Do not make production-security claims until these receive separate research and implementation.
