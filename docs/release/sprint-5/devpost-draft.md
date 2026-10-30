# Devpost submission draft — owner review required

## Your tests passed. Would the wrong product have passed too?

AI coding agents can produce patches that leave an existing suite green while violating the behavior a user approved. Counterfactual Acceptance Testing (CAT) asks whether the acceptance evidence distinguishes the intended behavior from plausible alternatives.

In the node-cache example, the approved behavior says that setting a cache entry's TTL to zero preserves the value without expiry. The historical ordinary suite passed a known-wrong patch. The original oracle V1 did not observe the expiry field, so a finite-expiry survivor passed V1. Oracle V2 added that observation and rejected the survivor. CAT also displays known-good, known-wrong, and equivalent historical controls so a stronger oracle is judged against multiple outcomes.

These are recorded historical controls, not fresh Sprint 5 executions. The archived P03 receipt is incomplete because its controller-runner artifact is missing. The current public oracle remains WEAK; CAT does not prove a patch or product correct.

## What this build demonstrates

- An offline, hash-bound Test Discrimination Summary as the Console's default page.
- Public source artifacts that let a reviewer follow the approved behavior, V1/V2 oracle definitions, and archived controls.
- A recorded rejected candidate and a separate authority preflight that stopped before execution.
- A fixed static package with a file allowlist and SHA-256 manifest; it runs without candidate execution, a model request, Docker, or credentials.

The optional Nebius/NVIDIA repair path is not demonstrated live. No inference POST occurred. Candidate F remains unevaluated. P04 accepted-control evidence remains omitted because its strict sealed-evidence closure is unavailable.

## Prior work and limitations

CAT includes substantial pre-hackathon research, specifications, benchmark protocol, schemas, fixture cases, and DP05B freeze artifacts. Hackathon work includes later evaluator, replay and receipt tooling, provider integration, and the recorded-evidence Console. The Sprint 4B result of 339/339 tests at `32208efa9ec2a034431629af94bfd15f49870db5` is historical only and does not validate this Sprint 5 source. The final Sprint 5 validation result and source SHA must be inserted from the machine evidence before submission.

## Publication status

Draft only. Root license selection, history/author metadata treatment, final terms review, public repository, hosted judge access, final footage, and Devpost submission require owner decisions. No submission or publication has occurred.
