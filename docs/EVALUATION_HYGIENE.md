# Evaluation Hygiene

Counterfactual Acceptance Testing depends on independent evidence remaining independent.

## Repository rule

Do **not** commit held-out probes, evaluator-private fixtures, private witness answer keys, or generated evaluation artifacts into builder-visible Git history before evaluation.

Private material belongs outside this repository under a local path such as:

```text
evaluator-private/
```

which is ignored by Git.

## Lifecycle

1. freeze approved H0;
2. builder works from visible requirement/evidence;
3. evaluator creates or loads independent distinguishing evidence;
4. evaluate candidate;
5. human reviews legitimate finding;
6. accepted probe may be promoted into visible regression tests;
7. create new independent evidence for future evaluation.

## Public-release rule

Before this repository becomes public, run a history/secret/evaluator-asset scrub. Deleting a sensitive file in a later commit is not sufficient if it already exists in Git history.
