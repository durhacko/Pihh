# Team roles

Purpose: who is accountable for what. As of 21:20 Sat: **Williams has paused development**, and his open issues were reassigned. Arnav's agents run lanes A and B (contracts, score, brains, world, observer, batch runner, app integration). Haris (`sirahmo`) owns the sponsor brief (#1), demo and pitch (#7), submission (#8), the split view and HUD (#24) and the scripted demo (#27). Unowned and optional: #28, #29.

| Human | GitHub | Lane (see [development plan](../planning/development-plan.md#lanes)) | Owns these shared files |
|---|---|---|---|
| Arnav Chitriv | `reverez` (verified) | **A. Brain and contracts**: `src/contracts`, `src/score`, `src/agent`; integration; runs the orchestrator | `src/contracts/**`, the contracts doc |
| Williams (William Pimentel) | `wpimento` (confirmed: closed #2) | **Paused development 21:20 Sat.** Built the world, radio faults, render slice, X-ray, controls, observer and isolation tests | `package.json`, build config, `scripts/check.sh`, CI |
| Haris | `sirahmo` (confirmed: readiness PR #59, 20:41 Sat) | **C. Experience**: `src/app/**`, demo, pitch, submission | `src/app/main.ts`, `index.html`, README |

## Agents

Each human may run one or more AI agents, which act under that human's GitHub account and accountability. There are no bot accounts. An issue assigned to `wpimento` means "Williams, or Williams's agent under Williams's supervision".

Arnav's session also runs an **orchestrator** with local sub-agents. It keeps issues and labels in sync and can pick up unclaimed READY issues in any lane, one worktree per issue. It cannot reach agents on other laptops.

## Single points of failure

- **Contracts and integration:** Arnav (via his orchestrator). With Williams paused there is no backup integrator; if Arnav is unreachable, Haris may merge non-contract PRs with green CI.
- **Demo and pitch:** Haris owns them, but all three must be able to run the scripted demo by 08:30 Sun.
- **Any lane with nobody active:** its READY issues are open to anyone; say so on the issue.

## Readiness

Cross-laptop coordination is **exercised on all three laptops**: each has authored PRs that someone on another laptop reviewed and merged (Arnav #40, Williams #38, Haris #59). Readiness checks: Arnav #36 and Haris #34 closed; Williams #35 is still open as a formality.

## Skills inventory (fill in on first contact; it decides the final lanes)

| Human | TypeScript | Three.js / graphics | Testing / tooling | Laptop OS, Node version | Awake overnight? |
|---|---|---|---|---|---|
| Arnav | | | | | |
| Haris | | | | | |
| Williams | | | | | |
