# Current state

> **Canonical snapshot and the single operational record. Keep it short and edit in place; it is not a log.** Last updated: Sun 15 Nov 2026 ~03:35 GMT by Arnav's orchestrator. Integrated commit: `main` at `1962fe5`, CI green. Live status: [issues](https://github.com/durhacko/Pihh/issues), [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **All app work for the demo is merged; docs polish, then the freeze at 08:00-08:30**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest, Node 22.12+. **Scope: software only**, one laptop, no hardware, no internet, no external services ([NFR-10](specification/requirements.md)). William's and Haris's agents are out of usage since 03:00; their open issues (#139, #141, #149, #158) were taken over by Arnav's sessions.

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design + contracts | Sat 20:30 | **Passed 20:04** |
| G1 Local healing, headless | Sat 23:30 | **Passed ~22:50** (#101, #103): 40 drones, 20% loss, seeds 1-5 and 101-105 |
| G2 3D vertical slice | Sun 00:30 | **Met**: both brains in the app (#107); the demo matches the sim at every beat |
| G3 Radio resilience | Sun 02:30 | **Met**: radio faults, X-ray, isolation tests on the real Encore brain (#68, #128) |
| G4 Dissemination | Sun 03:30 | **Met** ([#21](https://github.com/durhacko/Pihh/issues/21)): T18 relay, T16 version order (#136), S5 on seeds 1-5 and 101, and the partition belief view in the app (#132) |
| G5 Validation | Sun 06:30 | **Met** (#122, at 571c8e4): S1/S2 Encore wins 5 of 5, S0/S3 tie, no losses. **S5 costs 103 collisions vs 14**, not like-for-like ([#123](https://github.com/durhacko/Pihh/issues/123)). A full 320-record dry run (#133) found no new losses |
| Feature freeze / backup video | Sun 08:30 / 09:00 | Plan below |
| **G6 Submit on Devpost** | **Sun 10:15 (hard 11:00)** | README redesign (#154) and DEVPOST merged; final wording edits pending |

Evidence and caveats: [`results/RESULTS.md`](../results/RESULTS.md). nPWC uses our own priority labels; coverage ties and is the only metric that cannot favour Encore; repair is local, never globally optimal. Since #82 (geometric sensing order), main differs from 571c8e4 in the last bits; the freeze run supersedes it.

## Freeze plan (about 08:00, quiet machine)

1. The orchestrator pauses the other sessions and names the freeze SHA.
2. `durhack-5b`: `git switch --detach <SHA> && FREEZE_FULL=1 bash scripts/eval/freeze-run.sh` (#137). It runs the minimum matrix plus the full 20-seed matrix into `results/full/`, about 35 min. Exit 5 means hand-update the flagged notes, then the evidence PR. `durhack-41`'s `notes.cjs` drafts the full-matrix notes.
3. `durhack-d1`: record the backup video on the freeze SHA ([`scripts/demo/README.md`](../scripts/demo/README.md)), copy it to `~/encore-backup/`.
4. Update README/DEVPOST evidence-commit references to the freeze SHA.

## Who is doing what

| Work | Owner | Locked paths |
|---|---|---|
| Docs after #166 (beats table, K/J radius) | `durhack-01` | `docs/demo/DEMO_PLAN.md`, `docs/design/experience-and-demo.md` |
| README/DEVPOST tether + X-ray + K wording | `durhack-fe` | `README.md`, `docs/demo/DEVPOST.md` |
| Devpost gallery recapture (#141, supersedes #160), then the #134 regression pass | `durhack-98` (684fea) | `docs/demo/media/**`, `scripts/perf/gallery.mjs` |
| Accessibility audit re-check (#139, report only) | `durhack-41` | none |
| Readout follow-ups; inspector dead-drone row (#108) | `durhack-48` | `src/app/ui/Readout.ts`, `src/app/ui/Inspector.ts` |
| Pitch script fixes (#147) | `durhack-5b` | `docs/demo/PITCH.md` |
| Stand-by for render issues | `durhack-18`, `durhack-0c`, `durhack-77`, `durhack-d1` | none |
| Reviews, merges, this file | Orchestrator | `docs/CURRENT_STATE.md` |

Open follow-up, not demo-blocking: #169 (an open Disrupt popover acts on stale jam state).

## Decisions waiting for a human

- Sponsor brief and theme wording, captured at the venue (#1).
- Submission steps H1-H13 in [`demo/SUBMISSION_CHECKLIST.md`](demo/SUBMISSION_CHECKLIST.md): Devpost draft and team, repo visibility, backup video check, rehearsals, final submit by 10:15; confirm the AI-credit line (H13) and Haris's surname.
- Research handoff packet still not received ([`context/research-handoff.md`](context/research-handoff.md)).

## Known risks

- S5 collisions (above): every S5 claim states the cost.
- Machine load: heavy tests have explicit timeouts (#145, #146, #165); the freeze runs on a quiet machine.
- Frame rate: 180+ fps on this laptop's GPU. The quality ladder (#126) degrades only below 27 fps, so a 30 Hz battery cap is safe.
