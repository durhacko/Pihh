# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: Sun 15 Nov 2026 ~00:25 GMT by Arnav's orchestrator. Live status is always [GitHub issues](https://github.com/durhacko/Pihh/issues) and [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **G1 passed; Encore runs in the app; evidence run in review**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest, Node 22.12+. **Scope: software only**, one laptop, no hardware, no internet ([NFR-10](specification/requirements.md)). Both teammates stopped AI-assisted development at 21:45; Arnav's orchestrator and its sessions own every open issue.

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design accepted + contracts merged | Sat 20:30 | **Passed 20:04** |
| G1 Local healing works headless | Sat 23:30 | **Passed ~22:50** (PRs #101 brain, #103 tests). See below |
| G2 3D vertical slice | Sun 00:30 | Encore and static brains run side by side in the app (#107); scripted demo merged (#104). Browser pass of the demo on main in progress |
| G3 Radio resilience | Sun 02:30 | Radio faults, X-ray, controls and isolation tests merged; isolation now runs against the real Encore brain (#68) |
| G4 Dissemination | Sun 03:30 | Score gossip merged (#105); relay test T18 passes. In the app, a console inject reached all 180 Encore drones in about 0.5-1 s, static none (#113 browser run) |
| G5 Validation | Sun 06:30 | Minimum matrix run at 571c8e4: PR #122 in independent review |
| Feature freeze / backup video | Sun 08:30 / 09:00 | — |
| **G6 Submit on Devpost** | **Sun 10:15 (hard deadline 11:00)** | Submission text merged (#86) with placeholders; stale-text pass in progress |

Gate evidence: [evaluation doc §7](validation/evaluation-and-tests.md#7-gates). Work table: [development plan](planning/development-plan.md). Frontend plan: issue #95.

## G1 result, honestly

On the real simulation world, 40 drones, 20% packet loss, contract default parameters, **no brain change and no tuning**, all three tests of contract §8.6 pass on seeds 1-5 and dev seeds 101-105:

- **Null run** (formation change, no kills): 0 slot changes.
- **Clumped kill of 5**: survivors refill the important slots 4-8 s after the kill, with 0 duplicate slots and at most 1 slot change per drone. Final nPWC 0.974-0.994 for Encore against 0.876-0.939 for the static baseline.
- **Silence is not death** (full jam for 35 s in hold): 0 slot changes, 0 claims.

What makes it weaker than it sounds:
- Outside the gate, sweeping all 40 kill centres at 571c8e4, **38 of 40** runs meet all five conditions; the other 2 miss only "no commits in the last 10 s" (repair finishes at 20.2 s, the test allows 20 s).
- nPWC uses our own priority labels; total coverage is identical in both arms by physics; repair is local and never globally optimal.

## Evidence run (PR #122, not yet merged)

Seeds 1-5 × S0, S1, S2, S3, S5, 200 drones. Fair pairs, Encore against static: S1 and S2 **5 wins of 5** (end nPWC about 0.997 against 0.91); S0 and S3 tie 5 of 5; no losses. S5: all 200 Encore drones adopt the injected score (static none), **but Encore has 103 collisions against 14 for static** (#123, under investigation). Numbers become citable only after the review merges.

## Who is doing what

| Session | Work |
|---|---|
| `durhack-0c` | New app shell (#113): re-merging main, then independent review |
| `durhack-01` | Follow-ups to the composer and timeline (#121) |
| `durhack-18` | Encore step cost (#115): zero-contact-radius fix, then the app quality ladder |
| `durhack-5b` | S5 collisions (#123) |
| `durhack-fe` | Stale-text pass on README and submission docs |
| `durhack-48` | Browser pass of the 90 s demo on main |
| Orchestrator | Reviews and merges every PR after an independent check |

Held: geometric sensing order (#82) waits until the evidence run merges, because it changes trajectories in the last bits.

## Decisions waiting for a human

- The sponsor brief and theme wording must be captured at the venue (BRIEF §7).
- Human-only submission steps H1-H13 in [`demo/SUBMISSION_CHECKLIST.md`](demo/SUBMISSION_CHECKLIST.md): Devpost draft and team, repo visibility, backup video, rehearsals, real-GPU fps on the demo laptop, final submit.
- Research handoff packet still not received ([`context/research-handoff.md`](context/research-handoff.md)).

## Known risks

- S5 collisions (above). Until fixed, every S5 claim must state the cost.
- Browser fps: render-bound on software rendering (about 15 fps single view, 7 fps X-ray/split); real GPU not yet measured. A quality ladder is planned (#115 follow-up).
- The new frontend shell (#113) is large; the stable build is protected by merging only reviewed, CI-green PRs.
