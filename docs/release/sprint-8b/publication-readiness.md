# Sprint 8B publication readiness

**Local preparation only.** No source snapshot, license grant, host, deployment, upload or Devpost submission is authorized.

## Existing candidate materials

- MIT text candidate: `docs/release/sprint-7/LICENSE-MIT.candidate`.
- Public README candidate: `docs/release/sprint-7/README-publication.candidate.md`.
- Third-party/license review: `docs/release/sprint-7-source-license-review.md`.
- Third-party notice draft: `docs/release/sprint-4/proposed-publication/THIRD-PARTY-NOTICES.md`.
- Provenance and work-origin notes: `docs/release/sprint-4/existing-work-vs-hackathon-work.md` and `docs/release/sprint-6/license-provenance-decision.md`.
- Static-host handoff: `docs/release/sprint-7/static-hosting.md`.
- Eligibility and entry draft: `docs/release/sprint-7/eligibility-checklist.md` and `docs/release/sprint-7/devpost-draft.md`.
- Judge walkthrough source: `docs/release/sprint-4/demo-script-2m50.md`.

## Review status

- MIT is a candidate only. Confirm rights for pre-hackathon and hackathon contributions and choose the copyright holder/year before creating a root `LICENSE`.
- Resolve the declared-license gaps already identified for `colors@0.6.2`, `dateformat@1.0.2-1.2.3`, `expresso@0.9.2` and `inherits@1.0.2`; include the applicable source notices and attribution in any source snapshot.
- Re-review third-party code, fixture data, model naming/terms, trademarks and historical author metadata. The static Console bundle is separately allowlisted and contains no inference service.
- Prefer the selected provenance-linked clean source snapshot only after copyright, license and notice review. Do not rewrite history to hide author metadata.
- Keep the Test Discrimination Summary and oracle semantics. State that P03 is `HISTORICAL_INCOMPLETE`, the public oracle is `WEAK`, P04 is omitted, and Candidate F was not run.

## Submission copy update

CAT checks whether acceptance evidence distinguishes an approved behavior from plausible alternatives. In its node-cache zero-TTL case, the historical ordinary suite accepted a finite-expiry survivor because Oracle V1 did not observe expiry. V2 added that observation and rejected that survivor. The shown evidence is bounded and does not prove general correctness.

The Console presents recorded, hash-bound evidence. Optional Nebius repair integration is gated by one-use request approval; this sprint issued no inference POST. No sponsor feedback, endorsement, public deployment, published source, or submission is claimed. Fill all source, demo and video links only after their separate approvals.
