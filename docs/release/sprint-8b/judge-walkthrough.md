# Judge walkthrough — 2:45 target

**Recorded local evidence only.** Do not show private holdouts, credentials, raw provider responses or unapproved external services.

| Time | Show and say |
|---|---|
| 0:00–0:20 | Open the Evidence Console. “Passing tests do not necessarily distinguish approved behavior from a plausible wrong behavior.” |
| 0:20–0:50 | State the approved zero-TTL behavior: refresh the existing key without expiry. Point to the recorded evidence and source binding. |
| 0:50–1:20 | Compare V1 and V2. V1 did not observe expiry and let a finite-expiry survivor through; V2 observes expiry and rejects it. |
| 1:20–1:45 | Show known-good, known-wrong and equivalent controls. Explain that these controls illustrate this case's discrimination and calibration limits. |
| 1:45–2:05 | Show the Test Discrimination Summary and explain that evidence can remain unresolved or unsupported. |
| 2:05–2:25 | Describe the optional repair proposal path. Show the pending approval gate only if the final local source and proposal are prepared. State that no inference POST occurred in this release. |
| 2:25–2:45 | Close with the limits: P03 historical evidence is incomplete, the public oracle is weak, P04 is omitted, Candidate F was not run, and no publication or sponsor endorsement is claimed. |

Keep the screen capture authentic. Do not imply that a test pass proves general correctness or that local evidence is live sponsor execution.
