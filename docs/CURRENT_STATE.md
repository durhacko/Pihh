# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: Sat 14 Nov 2026 ~21:00 GMT by Arnav's orchestrator. Live status is always [GitHub issues](https://github.com/durhacko/Pihh/issues) and [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **implementation under way**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest, Node 22.12+. **Scope: software only**, one laptop, no hardware, no internet ([NFR-10](specification/requirements.md)).

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design accepted + contracts merged | Sat 20:30 | **Passed 20:04** |
| G1 Local healing works headless | Sat 23:30 | **In progress.** Score (#13) and steering + static brain (#15) merged. Encore brain (#16) in build and verification; G1 tests (#17) follow. **Not yet proven** |
| G2 3D vertical slice | Sun 00:30 | In progress. World core (#14) and render slice (#18) merged; the app still draws fixture drones. Integration (#6) in build |
| G3 Radio resilience | Sun 02:30 | In review: radio faults (#19, PR #50 approved), X-ray (#25, PR #49 approved), isolation tests (#20, PR #51), controls (#22, PR #52) |
| G4 Dissemination | Sun 03:30 | Not started (#21 waits for #16 and #19) |
| G5 Validation | Sun 06:30 | Observer (#23, PR #53) in review; scenarios and batch runner (#26) not started |
| Feature freeze / backup video | Sun 08:30 / 09:00 | — |
| **G6 Submit on Devpost** | **Sun 10:15 (hard deadline 11:00)** | Owner: Haris (#7, #8) |

Gate evidence: [evaluation doc §7](validation/evaluation-and-tests.md#7-gates). Work table and dependencies: [development plan](planning/development-plan.md).

## What runs today

On `main`: `npm ci`, then `bash scripts/check.sh` passes: typecheck, lint with the import-boundary checker, **226 tests in 10 files**, build, docs link check. Covered by those tests: the import boundary (T01), contract parameters, score expansion (T17), the world core with kill and jam, steering and the static brain, the snapshot buffer.

**Not on `main` and therefore untested: the Encore brain, healing, partitions, score gossip, the observer, and the app running a real world.** Nobody may say healing or dissemination works until the G1 and G4 tests pass.

## Who is doing what

| Who | Now | Next |
|---|---|---|
| Arnav's agents (lanes A and B) | #16 Encore brain, #17 G1 tests (orchestrator workers); #6 and #22 integration pass (session `durhack-0c`); #26 scenarios and batch runner (session `durhack-5b`); #64 world follow-ups (session `durhack-48`) | #21 score gossip with relay test T18; #46 per-tick radio evidence; #65 Encore isolation tests; brain swap in #6 |
| Williams (`wpimento`) | **Paused development (21:20 Sat).** No issues assigned; his merged work (world, radio faults, render slice, X-ray, controls, observer, isolation tests) stays | — |
| Haris (`sirahmo`) | Readiness done (#34). Documentation review: raised #55, #57 (both decided and merged), #56 (merged), #58 (needs Arnav) | #1 sponsor brief and theme wording; #7 pitch and demo plan; #8 README and Devpost draft; then #24 split view and HUD (continue draft PR #69) and #27 scripted demo |

Unowned and optional: #28 ghost slots, #29 inspector.

## Decisions waiting for a human

- **#58:** who may merge. `AGENTS.md` says a human other than the author; `WORKFLOW.md` lets the author merge after review, or alone after 10 minutes of green CI. Practice so far follows `WORKFLOW.md`. Arnav to confirm.
- **Research handoff packet:** still not received ([`context/research-handoff.md`](context/research-handoff.md)). Arnav to paste it in; reconciliation is then a separate, small task.
- Repo is private: public or judge access before submission (#8).

## Known risks right now

- Healing is a design until G1 passes (#17). If it fails, take the [fallback ladder](planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1).
- The documented sidestep acts for only a tick or two at high closing speeds, so **formation changes will produce counted collisions** (found verifying #15). Measured, not hidden; `transitLanes` is the first remedy.
- Sensing order in the world is by drone id (#64): no brain uses it, but it should become geometric after G1.
- Neptune North brief and theme wording are team-reported, not verified (#1).

## Measured numbers

- World core: 200 drones with radio step well inside the tick budget in the headless benchmark (see `tests/sim/world.test.ts` output).
- Render slice: Williams's team reports 57 fps with 200 fixture drones in headless Chrome (#6 comment; not re-measured here).
- G1: nothing yet.
