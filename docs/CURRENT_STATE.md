# Current state

> **Canonical snapshot and the single operational record. Keep it short and edit in place; it is not a log.** Last updated: Sun 15 Nov 2026 ~01:25 GMT by Arnav's orchestrator. Integrated commit: `main` at `23d6748`, CI green. Live status: [issues](https://github.com/durhacko/Pihh/issues), [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **G1-G5 met; integrating the app shell, then freeze**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest, Node 22.12+. **Scope: software only**, one laptop, no hardware, no internet, no external services ([NFR-10](specification/requirements.md)).

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design + contracts | Sat 20:30 | **Passed 20:04** |
| G1 Local healing, headless | Sat 23:30 | **Passed ~22:50** (#101, #103): 40 drones, 20% loss, seeds 1-5 and 101-105 |
| G2 3D vertical slice | Sun 00:30 | **Met**: both brains in the app (#107); the 90 s demo browser pass matched the sim at every beat |
| G3 Radio resilience | Sun 02:30 | **Met**: radio faults, X-ray, isolation tests on the real Encore brain (#68, #128) |
| G4 Dissemination | Sun 03:30 | **Met, headless** ([#21](https://github.com/durhacko/Pihh/issues/21)): T18 relay; S5 split and merge on seeds 1-5 and 101. Partition belief view in the app: #132 |
| G5 Validation | Sun 06:30 | **Met** (#122): minimum matrix at 200 drones, independently recomputed. S1/S2 Encore wins 5 of 5, S0/S3 tie, no losses. **S5 cost: 103 collisions vs 14** ([#123](https://github.com/durhacko/Pihh/issues/123), fix tried and rejected) |
| Feature freeze / backup video | Sun 08:30 / 09:00 | Freeze-run script #137; automated recording #131 |
| **G6 Submit on Devpost** | **Sun 10:15 (hard 11:00)** | Text in #125 (round 3 of review) |

Evidence and caveats: [`results/RESULTS.md`](../results/RESULTS.md). nPWC uses our own priority labels; coverage ties; repair is local, never globally optimal.

## Critical path

#113 app shell (in re-review) → #127 readout greying → #126 quality ladder, #82 sensing order → **freeze at 08:30**: `bash scripts/eval/freeze-run.sh` (#137) on the freeze commit → backup video (#131) → submit (#125 text).

## Who is doing what (claims and file locks)

Do not edit a locked path. To join, read `AGENTS.md`, take a **free** task, assign yourself and comment on the issue, and work in a worktree. Open a PR with `bash scripts/check.sh` green; the orchestrator reviews and merges. Contract changes (`src/contracts/**`, `docs/design/contracts-and-algorithms.md`) need orchestrator approval first. `src/agent/**` is frozen except through the orchestrator.

| Work | Owner | Locked paths |
|---|---|---|
| #113 app shell | `durhack-0c` | `src/app/main.ts`, `src/app/ui/**` (except Readout phase), `src/app/ui/styles.css` |
| #127 readout transition | `durhack-48` | `src/app/ui/Readout.ts`, its tests |
| #126 quality ladder | `durhack-18` | `src/app/render/**` |
| #82 sensing order | `durhack-18` | `src/sim/world.ts`, `src/sim/sensing.ts`, `tests/sim/**` |
| #125 submission text | `durhack-fe` | `README.md`, `docs/demo/DEVPOST.md`, `docs/demo/SUBMISSION_CHECKLIST.md`, `docs/demo/DEMO_PLAN.md` (shared with `durhack-01`'s operator rewrite) |
| #131 backup video | `durhack-d1` | `scripts/demo/**` |
| #137 freeze run; test timeouts | `durhack-5b` | `scripts/eval/**`, `results/**`; timeouts in `tests/agent`, `tests/g1`, `tests/g4` |
| #132 T16 + partition belief | `durhack-77` | `tests/g4/` new files (PR #136) |
| #133 full matrix dry run | `durhack-41` | scratch only |
| #134 judge walkthrough | `durhack-98` (684fea) | report only |
| Reviews, merges, this file | Orchestrator | `docs/CURRENT_STATE.md` |

**Free tasks** (label `help wanted`): #138 pitch script (`docs/demo/PITCH.md`); #139 shell accessibility audit (after #113, report only); #140 grid radius guard (after #82); #141 Devpost screenshots (after #113); #110, #117, #130 Phase 2 docs (proposed, not implemented; docs only, no external services in the app).

## Decisions waiting for a human

- Sponsor brief and theme wording, captured at the venue (#1).
- Submission steps H1-H13 in [`demo/SUBMISSION_CHECKLIST.md`](demo/SUBMISSION_CHECKLIST.md): Devpost draft and team, repo visibility, backup video, rehearsals, real-GPU fps on the demo laptop, final submit; confirm the AI-credit line (H13).
- Research handoff packet still not received ([`context/research-handoff.md`](context/research-handoff.md)).

## Known risks

- S5 collisions (above): every S5 claim states the cost.
- Machine load (many sessions): tests near their timeouts can fail under load; timeouts are being raised (5b, #113).
- Frame rate: 180+ fps on this laptop's GPU; software rendering is about 10 fps. #126 adds an automatic quality ladder below 30 fps.
