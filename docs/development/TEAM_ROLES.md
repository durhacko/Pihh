# Team roles

Purpose: who is accountable for what. Lanes are **proposed, not confirmed**: the team's skills and availability have not been recorded, and Haris has not yet acted on GitHub. A lane becomes real when its owner claims an issue. Lanes are defaults for picking work, not limits.

| Human | GitHub | Lane (see [development plan](../planning/development-plan.md#lanes)) | Owns these shared files |
|---|---|---|---|
| Arnav Chitriv | `reverez` (verified) | **A. Brain and contracts**: `src/contracts`, `src/score`, `src/agent`; integration; runs the orchestrator | `src/contracts/**`, the contracts doc |
| Williams (William Pimentel) | `wpimento` (confirmed: closed #2) | **B. World and evidence**: `src/sim`, `src/observer`, `src/cli`, build and CI | `package.json`, build config, `scripts/check.sh`, CI |
| Haris | `sirahmo` (inferred by elimination) | **C. Experience**: `src/app/**`, demo, pitch, submission | `src/app/main.ts`, `index.html`, README |

## Agents

Each human may run one or more AI agents, which act under that human's GitHub account and accountability. There are no bot accounts. An issue assigned to `wpimento` means "Williams, or Williams's agent under Williams's supervision".

Arnav's session also runs an **orchestrator** with local sub-agents. It keeps issues and labels in sync and can pick up unclaimed READY issues in any lane, one worktree per issue. It cannot reach agents on other laptops.

## Single points of failure

- **Contracts and integration:** Arnav. If unreachable for 30 minutes, Williams acts as integrator and may approve `[contract]` PRs.
- **Demo and pitch:** Haris owns them, but all three must be able to run the scripted demo by 08:30 Sun.
- **Any lane with nobody active:** its READY issues are open to anyone; say so on the issue.

## Readiness

Cross-laptop coordination is **untested** until each person's readiness check is closed: Haris #34, Williams #35, Arnav #36. Each check proves GitHub auth, Node and npm, repo access, issue claiming and one PR, and records the details in `docs/development/readiness/<handle>.md`. Haris's check also confirms his GitHub handle.

## Skills inventory (fill in on first contact; it decides the final lanes)

| Human | TypeScript | Three.js / graphics | Testing / tooling | Laptop OS, Node version | Awake overnight? |
|---|---|---|---|---|---|
| Arnav | | | | | |
| Haris | | | | | |
| Williams | | | | | |
