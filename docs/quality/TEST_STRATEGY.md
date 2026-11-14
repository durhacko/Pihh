# Test strategy (lightweight)

Purpose: just enough testing that `main` always demos. Stack-specific commands are added when the stack is chosen (M1 issue).

| Layer | What | When | Required? |
|---|---|---|---|
| Smoke | `scripts/check.sh` (to be created at M1): install, build, start in sim mode, exit 0 | Every PR, in CI | **Must** |
| Contract | Each interface in `architecture/INTERFACES.md` has an example payload and a test that validates producer and consumer against it | When a contract is added or changed | **Must** for cross-component interfaces |
| Component | Unit tests for the core algorithm (the "technical depth" judges will ask about) | With the feature | Should |
| End-to-end demo | Scripted run of the known-good demo path (`demo/DEMO_PLAN.md`) | After every merge from M2 on; before judging | **Must** (may be manual) |
| Failure modes | Kill each external dependency (network, hardware, API) and confirm sim/mock fallback works | M3 | **Must** for demo dependencies |
| Reproducibility | Fresh clone → follow README → runs, on a second teammate's laptop | M3 and M5 | **Must** |

Rules:
- A feature isn't done until it runs inside the integrated app.
- A test that can't run in CI is documented as a manual check in the PR's "Tests run" section.
- Mock/sim modes are first-class: selected by an env var or flag, documented in `.env.example`.
