# Encore

**A drone light show with no central controller.** Encore is a 3D simulation in which every drone decides for itself: the swarm holds a formation, repairs the image when drones fail, and spreads new compositions from drone to drone by radio. Built at DurHack 2026 (theme: Composition) for the Neptune North challenge.

> **Status: scaffold available; simulation implementation pending.** See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).
> **Submission deadline: Sun 15 Nov 2026, 11:00 GMT (Devpost).**

## What it shows

1. Around 200 simulated drones form text and 3D shapes. Each one knows only its own state, the shared score, what it hears on short-range radio and what it senses nearby.
2. A judge destroys a region of the formation. The neighbours notice the gap, and the least important nearby drones move in to restore the outline. A conventional pre-programmed show, run beside it from the same seed, keeps the hole.
3. The judge jams the radio and sends a new composition to a single drone. It spreads as far as the radio allows and no further, and the rest catch up when the jam lifts.
4. An X-ray view shows the real messages, each drone's beliefs, and the disagreement during a partition.

It is a simulation, and software only: no physical drones or other hardware, no internet, one laptop. The drones are logically independent actors inside one program, not separate machines. Each decides for itself; the program plays the air and the radio, not a controller. Collisions are measured, not ruled out.

## For the team

| You want to… | Go to |
|---|---|
| Know what's happening now | [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) |
| Find any doc | [`docs/INDEX.md`](docs/INDEX.md) |
| Pick up work | [Open issues](https://github.com/durhacko/Pihh/issues) and the [development plan](docs/planning/development-plan.md) |
| Start your AI agent on an issue | [`docs/development/WORKFLOW.md`](docs/development/WORKFLOW.md#starting-your-agent-on-an-issue-bootstrap-prompt), then [`AGENTS.md`](AGENTS.md) |
| Understand the design | [Architecture](docs/design/system-architecture.md), [contracts and algorithms](docs/design/contracts-and-algorithms.md) |

## Repo layout

```text
AGENTS.md / CLAUDE.md   protocol for AI agents
docs/                   specification, design, plan, event brief
src/contracts/          shared types (change only by [contract] PR)
src/score/              recipe -> priority-ordered slots
src/agent/              drone brains (Encore and the static baseline)
src/sim/                the world: physics, radio, sensing, events
src/observer/           metrics and run records
src/app/                Three.js app: views, controls, scripted demo
src/cli/                headless batch experiments
tests/  scripts/  assets/  research/
```

## Run it

Install Node.js 22.12+ (CI uses 24.11.0), then:

```bash
npm ci
npm run dev
```

Open the loopback URL printed by Vite. The page currently confirms scaffold readiness; it does not simulate drones yet. On Windows PowerShell use `npm.cmd` if script execution policy blocks `npm`.

Encore always runs in simulation mode. Optional `.env` setting `VITE_SIM_MODE=true` is documented in `.env.example`; setting it to false is rejected. No credentials are needed. Dependency installation needs internet; the app uses local assets at runtime.

Run all checks with `bash scripts/check.sh` (Git Bash on Windows). This performs a clean dependency install, typecheck, lint, import-boundary checks, Node tests, production build and loopback preview smoke check. Alternatively use `npm ci` followed by `npm run check` in PowerShell. The smoke check verifies HTTP delivery of the built page and JS bundle; it does not execute a browser or verify WebGL.

Use `npm run build` then `npm run preview` to serve the production files locally.

## Built with

TypeScript, Vite, Three.js, Vitest, ESLint and typescript-eslint, with Node.js and TypeScript definitions from `@types/node` and `@types/three`. Exact direct versions and the transitive dependency tree are pinned in `package.json` and `package-lock.json`. Three.js is installed for the upcoming renderer; the scaffold does not render a scene yet.

## AI use

*Completed before submission; the event rules require AI use to be credited explicitly ([BRIEF R4](docs/competition/BRIEF.md#4-submission-and-rules)).* So far: Claude Code (Anthropic) was used on 14 Nov 2026 to set up the repository and coordination docs, to research the event rules and prior art, and to draft and review the architecture and specification documents under the team's direction. AI coding agents will also write application code; this section will say which parts.

OpenAI Codex implemented the issue #5 scaffold, build and CI configuration, import-boundary checks and their tests under Williams's direction.

## Where Encore ties or loses

*Filled in from the evaluation runs.* The comparison with the static baseline is pre-registered in [`docs/validation/evaluation-and-tests.md`](docs/validation/evaluation-and-tests.md), including the scenarios where we expect no advantage.

## License

Apache License 2.0. See [LICENSE](LICENSE).
