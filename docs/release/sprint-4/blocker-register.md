# Severity-ranked unresolved release blockers

| Severity | Blocker | Evidence | Closure condition |
|---|---|---|---|
| P0 | Final project validation failed | Implementation commit c182c06 passed 339/339; required validator at ff00b3d passed 338/339 with Docker-backed calibration `UNCALIBRATED` | Restore Docker engine access and pass focused P03 test plus validator on exact intended release SHA |
| P0 | P04 sealed evidence closure incomplete | Strict verifier fails; annex absent; 120 non-sensitive artifacts and P03 chain match | Restore authorized annex and pass strict verification, or keep P04 omitted |
| P1 | $0.10 inference budget not enforceable | Output bound exists; input/account caps unverified; preflight DNS failed | Verified account hard cap ≤$0.10 or independently enforced billed-token bounds |
| P1 | Candidate F not evaluated | Replay is not semantic evaluation | Separate owner authorization and exact frozen-environment evaluation |
| P1 | Public license undecided | No root LICENSE | Owner selects and approves license/attribution |
| P1 | Git history contains author metadata | Historical commit metadata includes email | Owner accepts disclosure or approves provenance-linked metadata-free snapshot |
| P1 | No stable judge host/repository release | Local bundle only; no push/deployment | Owner authorizes, host smoke passes and public access verified |
| P1 | Public oracle WEAK | Sprint 3 evidence | Independent new evidence and human review support reclassification |
| P2 | Responsive screenshots/footage absent | Desktop inspected; tablet/320px capture not completed | Capture/review actual screenshots and timed footage |
| P2 | Sponsor feedback absent | No communication/inference result | Do not claim feedback; collect only with authorized communication |
