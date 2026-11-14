# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: Sat 14 Nov 2026 ~23:05 GMT by Arnav's orchestrator. Live status is always [GitHub issues](https://github.com/durhacko/Pihh/issues) and [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **G1 passed; integration, gossip and evidence under way**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest, Node 22.12+. **Scope: software only**, one laptop, no hardware, no internet ([NFR-10](specification/requirements.md)). Both teammates stopped AI-assisted development at 21:45; Arnav's orchestrator and its sessions own every open issue.

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design accepted + contracts merged | Sat 20:30 | **Passed 20:04** |
| G1 Local healing works headless | Sat 23:30 | **Passed ~22:50** (PRs #101 brain, #103 tests). See below |
| G2 3D vertical slice | Sun 00:30 | Both worlds run in the app; Encore brain swap into the app in progress (#6) |
| G3 Radio resilience | Sun 02:30 | Radio faults, X-ray, controls, isolation tests merged; G1's "silence is not death" test uses the real jam |
| G4 Dissemination | Sun 03:30 | Score gossip in progress (#21), with relay test T18 |
| G5 Validation | Sun 06:30 | Observer and batch runner merged; evidence run starts after the paced-target fix (#96, #80) |
| Feature freeze / backup video | Sun 08:30 / 09:00 | — |
| **G6 Submit on Devpost** | **Sun 10:15 (hard deadline 11:00)** | Submission text merged (#86) with placeholders |

Gate evidence: [evaluation doc §7](validation/evaluation-and-tests.md#7-gates). Work table: [development plan](planning/development-plan.md). Frontend plan: issue #95.

## G1 result, honestly

On the real simulation world, 40 drones, 20% packet loss, contract default parameters, **no brain change and no tuning**, all three tests of contract §8.6 pass on seeds 1-5 and dev seeds 101-105:

- **Null run** (formation change, no kills): 0 slot changes.
- **Clumped kill of 5**: survivors refill the important slots 4-8 s after the kill, with 0 duplicate slots and at most 1 slot change per drone. Final nPWC 0.974-0.994 for Encore against 0.876-0.939 for the static baseline (shape error sfMax 1.8-2.3 m against 3.2-5.0 m).
- **Silence is not death** (full jam for 35 s in hold): 0 slot changes, 0 claims.

What makes it weaker than it sounds:
- In an exhaustive sweep outside the gate (all 40 kill centres × seeds 1-5), **183 of 200** runs meet all five conditions. The other 17 miss only "no commits in the last 10 s": a four-hop repair chain finishes 20.2-21.7 s after the kill, where the test allows 20 s. No run showed a duplicate slot, a pop or a commit that raised a slot index.
- 40 drones and one formation. One run at 120 drones also passes, but repair is partial (nPWC 0.966 against 0.923).
- nPWC uses our own priority labels; total coverage is identical in both arms by physics; repair is local and never globally optimal.

## What runs today

On `main`: `npm ci`, then `bash scripts/check.sh` passes (typecheck, lint with the import-boundary checker, all tests, build, docs links). Tested: the Encore and static brains, healing (G1), world, radio faults, isolation (T01-T05), observer, scenarios and batch runner, command parser, design-system modules, stage selection and inspector. **Not yet tested: score gossip (#21), the Encore brain inside the running app (#6), the evaluation matrix (#26).**

## Who is doing what

| Session | Work |
|---|---|
| `durhack-0c` | Encore brain swap into the app (#6), then the new app shell (#92) |
| `durhack-18` | Score gossip (#21, G4) |
| `durhack-5b` | Finish paced targets (#96), then the evidence matrix (#26) |
| `durhack-01` | Composer and console (#93) |
| `durhack-fe` | Show timeline (#94) |
| `durhack-48` | Follow-ups to #102; scripted demo PR #104 in review |
| Orchestrator | Reviews and merges every PR after an independent check |

## Decisions waiting for a human

- The sponsor brief and theme wording must be captured at the venue (BRIEF §7).
- Human-only submission steps H1-H13 in [`demo/SUBMISSION_CHECKLIST.md`](demo/SUBMISSION_CHECKLIST.md): Devpost draft and team, repo visibility, backup video, rehearsals, final submit.
- Research handoff packet still not received ([`context/research-handoff.md`](context/research-handoff.md)).

## Known risks

- Collisions in formation changes: the paced-target fix (#96) cuts them from 60 to 14 in the static S0 run; not yet merged.
- The G1 repair chain can exceed 20 s for some kill centres (above).
- The new frontend shell is large; the stable build is protected by merging only reviewed, CI-green PRs.
