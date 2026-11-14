# Encore

**A drone light show with no central controller.** Encore is a 3D simulation in which every drone decides for itself: the swarm holds a formation, repairs the image when drones fail, and spreads new compositions from drone to drone by radio. Built at DurHack 2026 (theme: Composition) for the Neptune North challenge.

> **Status: architecture approved, implementation starting.** Nothing runs yet. See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).
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

*Added by the scaffold issue (#5).* It will be `npm ci && npm run dev`, with no network needed at run time.

## Built with

*Completed before submission; the event rules require every public framework and library to be listed ([BRIEF R3](docs/competition/BRIEF.md#4-submission-and-rules)).* Planned: TypeScript, Vite, Three.js, vitest.

## AI use

*Completed before submission; the event rules require AI use to be credited explicitly ([BRIEF R4](docs/competition/BRIEF.md#4-submission-and-rules)).* So far: Claude Code (Anthropic) was used on 14 Nov 2026 to set up the repository and coordination docs, to research the event rules and prior art, and to draft and review the architecture and specification documents under the team's direction. AI coding agents will also write application code; this section will say which parts.

## Where Encore ties or loses

*Filled in from the evaluation runs.* The comparison with the static baseline is pre-registered in [`docs/validation/evaluation-and-tests.md`](docs/validation/evaluation-and-tests.md), including the scenarios where we expect no advantage.

## License

Apache License 2.0. See [LICENSE](LICENSE).
