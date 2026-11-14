# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: Sat 14 Nov 2026 ~19:20 GMT by Arnav's orchestrator.

## Phase: **architecture done, implementation starting**

Project: **Encore** (selected 18:05, issue #3). Stack: TypeScript, Vite, Three.js, vitest. No application code exists yet.

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design accepted + contracts merged | Sat 20:30 | Docs merged; **waiting on scaffold (#5) and contract types (#12)** |
| G1 Local healing works headless | Sat 23:30 | Not started |
| G2 3D vertical slice | Sun 00:30 | Not started |
| G3 Radio resilience / G4 Dissemination | Sun 02:30 / 03:30 | Not started |
| G5 Validation | Sun 06:30 | Not started |
| Feature freeze / backup video | Sun 08:30 / 09:00 | — |
| **G6 Submit on Devpost** | **Sun 10:15 (hard deadline 11:00)** | — |

Gate evidence: [evaluation doc §7](validation/evaluation-and-tests.md#7-gates). Full work table and dependencies: [development plan](planning/development-plan.md).

## What to do now

| Who | Issue | State |
|---|---|---|
| Williams (proposed) | [#5](https://github.com/durhacko/Pihh/issues/5) WP-0a scaffold + CI | **READY. Nothing else can start until this merges.** Not claimed yet (Williams closed #2 at 19:03, so he is on GitHub); under the release rule in `AGENTS.md` it is free to anyone if unclaimed |
| Arnav | [#12](https://github.com/durhacko/Pihh/issues/12) WP-0b contract types + fixtures | Blocked by #5 (30 minutes of work) |
| Haris (proposed) | [#1](https://github.com/durhacko/Pihh/issues/1) verify the Neptune North brief and theme wording at the booth | READY |
| Everyone | Read `AGENTS.md`, the [contracts](design/contracts-and-algorithms.md) and your lane in the [plan](planning/development-plan.md#lanes) | — |

Once #12 merges, three issues open at once with no shared files: [#13](https://github.com/durhacko/Pihh/issues/13) score (lane A), [#14](https://github.com/durhacko/Pihh/issues/14) world core (lane B), [#18](https://github.com/durhacko/Pihh/issues/18) render slice (lane C). Critical path to G1: #5 → #12 → #13 → #15 → #16 → #17.

All work-package issues (#12–#29) are labelled `status:blocked` until their dependencies merge; the orchestrator removes the label when they become READY.

## Blockers and open questions

- **Haris has not yet acted on GitHub**, and his handle (`sirahmo`) is inferred. Williams's handle (`wpimento`) is confirmed: he closed #2. Lanes B and C stay proposals until their owners claim an issue.
- **Research handoff packet not received** ([placeholder](context/research-handoff.md)). The design was not checked against it.
- **Neptune North brief and theme wording are team-reported, not verified** (#1).
- **The review loop was stopped after its second full round.** All 27 confirmed findings were fixed, but the fixes were not re-reviewed ([review history](planning/development-plan.md#review-history)).
- The healing mechanism is a design until G1 passes. If it fails, take the [fallback ladder](planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1).
- No branch protection and no Projects board (plan limits). PR-only is by convention; issues, labels and milestones are the board.
- Repo is private: decide on public or judge access before submission (#8).

## Measured numbers

None yet. Frame rate and roster size go here at G2; G1 results at G1.
