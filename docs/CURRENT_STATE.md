# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: Sat 14 Nov 2026 ~20:15 GMT by Arnav's orchestrator. Live status is always [GitHub issues](https://github.com/durhacko/Pihh/issues).

## Phase: **implementation under way**

Project: **Encore**. Stack: TypeScript, Vite, Three.js, vitest. **Scope: software only**, one laptop, no hardware, no internet ([NFR-10](specification/requirements.md)).

| Gate | Target (GMT) | Status |
|---|---|---|
| G0 Design accepted + contracts merged | Sat 20:30 | **Passed 20:04.** Scaffold (#5) and contract types (#12) are on `main` |
| G1 Local healing works headless | Sat 23:30 | In progress: #13 score and #15 steering in build; #16 Encore brain next |
| G2 3D vertical slice | Sun 00:30 | In progress: #18 render slice, #14 world core (Williams's team) |
| G3 Radio resilience / G4 Dissemination | Sun 02:30 / 03:30 | Not started |
| G5 Validation | Sun 06:30 | Not started |
| Feature freeze / backup video | Sun 08:30 / 09:00 | — |
| **G6 Submit on Devpost** | **Sun 10:15 (hard deadline 11:00)** | — |

Gate evidence: [evaluation doc §7](validation/evaluation-and-tests.md#7-gates). Work table and dependencies: [development plan](planning/development-plan.md).

## What runs today

On `main`: `npm ci && npm run check` passes (typecheck, lint with the import-boundary checker, **30 tests**, build). Those tests cover the import boundary (T01) and the contract parameters and fixtures only. **No simulation, brain or renderer code is on `main` yet, so no claim about healing, radio or dissemination is tested.**

Run commands inside WSL or a normal local clone. `npm` does not work on a `\\wsl.localhost\…` path from Windows.

## Who is doing what

| Who | Issues | State |
|---|---|---|
| Arnav (lane A, via orchestrator workers) | [#13](https://github.com/durhacko/Pihh/issues/13) score, [#15](https://github.com/durhacko/Pihh/issues/15) steering + static brain | In progress. Then #16 Encore brain, #17 G1 tests, #6 integration, #21 score gossip |
| Williams's team (lane B, plus the render slice) | [#14](https://github.com/durhacko/Pihh/issues/14) world core, [#18](https://github.com/durhacko/Pihh/issues/18) render slice, [#20](https://github.com/durhacko/Pihh/issues/20) isolation tests | In progress |
| Haris | [#34](https://github.com/durhacko/Pihh/issues/34) readiness check, [#1](https://github.com/durhacko/Pihh/issues/1) verify the sponsor brief | **No activity on GitHub yet; handle `sirahmo` still unconfirmed** |

Unowned and coming up in lane C once #6 lands: #22 controls, #25 X-ray, #24 split view and HUD, #27 scripted demo, #7 and #8 demo and submission. If Haris does not appear, these need redistributing.

## Blockers and open questions

- **Research handoff packet not received.** [`context/research-handoff.md`](context/research-handoff.md) records the material changes from the original concept, but the comparison with the packet itself cannot be done until Arnav pastes it in.
- **Haris's identity and readiness are unconfirmed** (#34). Coordination is exercised between Arnav's and Williams's laptops only.
- **Neptune North brief and theme wording are team-reported, not verified** (#1).
- The healing mechanism is a design until G1 passes (#17). Score gossip was amended at 19:50 (no same-version cancellation); its relay test T18 is specified, not yet written.
- The docs review loop was stopped early; fixes after its last round were not re-reviewed ([review history](planning/development-plan.md#review-history)).
- No branch protection and no Projects board (plan limits). Repo is private: decide on public or judge access before submission (#8).

## Measured numbers

- Williams's team reports the render slice at 57 fps with 200 fixture drones in headless Chrome (comment on #6; not yet on `main`, not re-measured here).
- Nothing else yet. G1 results go here at G1.
