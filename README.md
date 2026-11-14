# Encore

**A drone light show with no central controller.** Encore explores a 3D simulation in which every drone decides from its own state, nearby sensing and short-range messages. The intended show repairs gaps after failures and spreads new compositions by radio. Built at DurHack 2026; the team-reported theme is Composition. Theme wording and the Neptune North challenge brief still await verification ([#1](https://github.com/durhacko/Pihh/issues/1)).

> **Current app: two real simulation worlds in lockstep, both using the static baseline while the Encore brain is integrated.** Healing and score dissemination are not yet demonstrated. See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) and [live issues](https://github.com/durhacko/Pihh/issues).
> **Submission deadline: Sun 15 Nov 2026, 11:00 GMT (Devpost).**

## Intended demonstration

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

Open the loopback URL printed by Vite in a browser with WebGL enabled. The app runs two real worlds from the same seed; its badge currently says **STATIC BRAIN IN BOTH ARMS**. Surviving drones keep flying their preloaded score after a kill. This fallback does not demonstrate healing.

Use `/?seed=101` for a reproducible seed, `/?arm=static` for the static view, or `/?seed=101&split=1` for the current two-pane view. Drag to orbit, right-drag to pan, scroll to zoom; keys 1–3 choose camera presets. The controls panel offers transport and kill actions. Radio fault, composition and display controls remain unavailable until their bootstrap callbacks are connected, even where their underlying modules are merged.

For a console smoke check, pause with `window.encore.setPlaying(false)`, inspect `window.encore.alive()`, schedule `window.encore.killIds([0])`, then resume with `window.encore.setPlaying(true)`. After the next simulation tick, both alive counts should decrease by one. `window.encore.reset(101)` rebuilds both worlds from that seed. These are inspection steps, not a claim that a browser rehearsal has been completed.

On Windows PowerShell use `npm.cmd` if script execution policy blocks `npm`; use Git Bash for `bash scripts/check.sh` (the Windows `bash` command may instead launch WSL).

Encore always runs in simulation mode. Optional `.env` setting `VITE_SIM_MODE=true` is documented in `.env.example`; setting it to false is rejected. No credentials are needed. Dependency installation needs internet; the app uses local assets at runtime.

After `npm ci`, run all checks with `bash scripts/check.sh` (Git Bash on Windows). This performs typecheck, lint, import-boundary tests, Node tests, production build and the Python docs link check. Python 3 is required. Alternatively run `npm run check` and `python scripts/check_links.py` in PowerShell. The T01 test scans all source files and tests deliberate violations against the same checker.

Use `npm run build` then `npm run preview` to serve the production files locally.

## Built with

The runtime uses Three.js for 3D rendering. Development and validation use Node.js, TypeScript, Vite, Vitest, ESLint, `@eslint/js`, typescript-eslint and tsx, with TypeScript definitions from `@types/node` and `@types/three`. Python 3 runs the documentation link checker. Exact direct dependency versions and the transitive dependency tree are pinned in `package.json` and `package-lock.json`; see those files for the complete package inventory.

## AI use

AI assistance is used throughout this project and is credited explicitly under [BRIEF R4](docs/competition/BRIEF.md#4-submission-and-rules). Claude Code (Anthropic) was used on 14 Nov 2026 for repository setup and coordination documents, research into event rules and prior art, and architecture/specification drafting and review under the team's direction.

OpenAI Codex was used for implementation, tests, code and documentation review, GitHub issue coordination and PR integration. Recorded contributions include the scaffold and CI/import-boundary checks (#5), world simulation (#14/#19), rendering and visual evidence layers (#18/#25), controls (#22), observer metrics (#23), isolation tests (#20), readiness and documentation corrections (#34/#56), and test timeout fixes (#71). Haris's Codex session also drafted these setup and AI disclosures. Human contributors direct the agents; implementation and validation evidence is recorded in the repository's commits, issues and PRs. Update this credit if additional tools are used before submission.

## Where Encore ties or loses

Evaluation results are pending (#17/#26); no healing improvement or convergence time is reported yet. The comparison with the static baseline is pre-registered in [`docs/validation/evaluation-and-tests.md`](docs/validation/evaluation-and-tests.md), including scenarios where we expect no advantage. Both current app arms use the static brain, so their comparison cannot establish an Encore benefit.

Design limits to disclose alongside the eventual results: repair is local and greedy, radio silence alone is not evidence of death, partitions can preserve different scores, and collisions are counted without changing drone physics. This is a simulated proof of concept, not flight-control software. Measured results must retain unsuccessful and censored runs; the submission checklist remains open until results, media, judge access and Devpost submission are verified.

## License

Apache License 2.0. See [LICENSE](LICENSE).
