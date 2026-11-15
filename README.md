# Encore

**A drone light show with no conductor during the performance.** About 200 simulated drones each decide from their own state, what they sense nearby and what they hear on short-range radio. The score and the roster are written beforehand and loaded onto every drone. After failures, nearby survivors move into the more important parts of the picture. This is tested headless, and how much it helps is measured, not assumed (see "Where Encore ties or loses"). New compositions are meant to spread from drone to drone by radio. A conventional pre-programmed show runs beside it from the same seed, so you can compare the two.

Built at DurHack 2026 by Arnav Chitriv, Haris `[HUMAN: Haris's surname]` and William Pimentel. The theme, as reported to the team, is Composition: drones compose an image, and a timed score composes images into a show. The theme wording and the Neptune North challenge brief are not verified online ([#1](https://github.com/durhacko/Pihh/issues/1)).

**It is a simulation, and software only.** There are no physical drones or other hardware, no internet and no backend. Everything runs on one laptop. The drones are logically independent agents inside one program, not separate machines. Each decides for itself; the program plays the air and the radio, not a controller. Collisions are measured, not ruled out.

> **Status at this commit: the Encore world flies the Encore brain and the other world flies the static pre-programmed baseline; the app labels each world with its brain.** Local healing passes its pre-registered headless tests (G1: three tests on seeds 1–5 and 101–105; the clumped-kill result depends on where the kill lands, 183 of 200 runs in a sweep of every kill centre). It is also exercised through the app by `tests/app/encoreArm.test.ts`. Score gossip is merged and its relay test (T18) passes. Dissemination evidence (G4) and the evaluation numbers are not yet claimed here. `[UPDATE AT FREEZE: replace this box with the build's real status, the frozen revision and a link to results/RESULTS.md, and resolve every bracketed placeholder below; legend in docs/demo/DEVPOST.md]`

## Run the demo (30 seconds)

You need Node.js 22.12 or later and a browser with WebGL.

```bash
npm ci            # once; needs internet
npm run build     # no internet needed from here on
npm run preview
```

Open **http://127.0.0.1:4173/?seed=101&split=1**, or the address Vite prints if port 4173 is taken. Both worlds start from seed 101.

- **Camera:** drag to orbit, right-drag to pan, scroll to zoom. Keys `1`–`3` choose camera presets.
- **Select a drone:** click one in the Encore view, or type its id in the panel. Region kill and jam act around the selected drone, and inject sends to it; partition splits the swarm along a fixed plane.
- **Keys:**

  | Key | Action |
  |---|---|
  | `Space` | Play or pause |
  | `R` | Reset to the seed |
  | `K` | Kill the region around the selected drone |
  | `J` | Jam the radio around it |
  | `P` | Partition the swarm |
  | `I` | Send a new composition to it |
  | `X` | X-ray: the radio messages actually sent |
  | `C` | Belief colours: each drone's score version |
  | `[` / `]` | Slower or faster |

  The panel on the left has the same actions, plus "Kill random 10%", packet loss and the choice of composition.
- **Single view:** remove `&split=1` from the address.

On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm`.

`npm ci` may print warnings: a deprecated package, `npm audit` findings and, with npm 11, an install-scripts notice for esbuild. They are harmless and do not affect the build. The audit findings are in development tools only: `npm audit --omit=dev` reports none.

On WSL, run npm from a Linux path inside WSL (`cd ~/...`), not on a `\\wsl.localhost\...` path from Windows. Windows npm fails there ("UNC paths are not supported").

## What to look for

1. **Which brain each world runs.** The caption under the title and the HUD's arm labels say which brain each world flies (the badge reads LIVE SIMULATION). Trust them over this README.
2. **Two worlds, one difference.** The top world is Encore and the bottom is the static baseline. Both run from the same seed and get the same failures; only the brain differs.
3. **Kill a region.** In the Encore world, survivors next to the hole infer a vacancy and move into more important slots. They give up less important detail, so the image thins instead of keeping a hole. The static world keeps the hole until its next formation. Repair is local and greedy, so it isn't complete, and a hole that no survivor can sense is never noticed.
4. **Jam the radio, then send a new composition to one drone.** `[IF G4]` The new score spreads along real radio messages, stops at the jam, and crosses when the jam lifts. The static world can't adopt it.
   **FALLBACK until G4 passes:** the jam and inject controls work, but neither world adopts the new score.
5. **The numbers.**
   - The readout at the bottom right shows each world's live drones and the frame rate.
   - The comparison panel above the readout shows nPWC, plain coverage, shape error, message rate, collisions and more for each world.
   - Each world has its own observer, built from the same code.

`[IF G1 and the scripted demo #27 is merged]` Press `[HUMAN: key]` to play the 90-second scripted demo.

## Where Encore ties or loses

These cases were written down before any evaluation run, in [evaluation and tests §3](docs/validation/evaluation-and-tests.md#3-scenarios). Each placeholder is filled from `results/RESULTS.md`; nothing here is a result yet. Results will keep ties, losses and unrecovered runs.

| Case | What we expect | Measured |
|---|---|---|
| **Null run, no failures (S0)** | Tie on the image. Encore sends messages; the static show sends none, so Encore loses on message cost. | `[RESULT: S0 nPWC both arms; Encore messages per drone-second]` |
| **Random kill (S1)** | The two look similar: scattered holes are already an even thinning. Plain coverage ties. Any nPWC win rests on our own priority order. Encore loses on messages, slot changes and near-misses. | `[RESULT: S1 W/T/L over N seeds; coverage, sfMean, sfMax both arms]` |
| **Regional kill (S2)**, the case Encore is built for | Ahead during the hold after the kill, but repair is partial. After the next formation change the dead drones are scattered, so shape error ties. Plain coverage ties. Some seeds may not recover. | `[RESULT: S2 median nPWC Encore vs static, W/T/L, sfMaxEndA difference, median recovery time, censored count]` |
| **Pure jam or radio cut, no failures (S3)** | Tie at best. Encore only adds blocked messages. A jammed drone never claims a slot, so nothing inside a jam is repaired until it lifts. | `[RESULT: S3 W/T/L; Encore slot changes; blocked messages]` |
| **Partition with failures (S4, optional)** | Smaller gain than S2. Drones on opposite sides can claim the same slot, so expect duplicates, more slot changes and losses on some seeds. | `[RESULT: S4, or "not run"]` |
| **New composition during a partition (S5)** | Two versions fly at once until reconnection. The group left behind repairs its old formation and then unwinds. The static show can't adopt, which is a capability difference, not a win. | `[RESULT: S5 adoption on the injected side, time to one version]` |
| **Message cost (all scenarios)** | The static show sends nothing, so it is always cheaper. | `[RESULT: messages per drone-second, Encore]` |
| **Collisions (all scenarios)** | Encore ≥ static. The static world collides during formation changes. In one deterministic run of the no-event scenario (200 drones, identical for seeds 1–5), pacing each drone's target along its path (#96) cut its transition collisions from about 60 to 14, and near-misses from 310 to 250 ([#80](https://github.com/durhacko/Pihh/issues/80)). The Encore world shares the same motion code. Counts are lower bounds, sampled at 20 Hz. | `[RESULT: collisions and near-misses per run, both arms, all scenarios]` |

Design limits to state alongside the results:

- Repair is local and greedy.
- Radio silence alone is never treated as death.
- Partitions can keep different scores alive until they reconnect.
- Drones that fail are removed; drones that fail in place are not modelled.
- Sensing is ideal, the radio is a disc model, and the clock is shared.

This is a simulated proof of concept, not flight-control software. Assumptions: [evidence and assumptions §2](docs/context/evidence-and-assumptions.md#2-assumptions).

## Built with

Public libraries, exact versions as pinned in [`package.json`](package.json). The full dependency tree is in [`package-lock.json`](package-lock.json).

| Library | Version | Used for |
|---|---|---|
| [Three.js](https://threejs.org/) (`three`) | 0.181.1 | 3D rendering (WebGL), the only runtime dependency |
| [TypeScript](https://www.typescriptlang.org/) (`typescript`) | 5.9.3 | Language, type checking and the import-boundary test's parser |
| [Vite](https://vite.dev/) (`vite`) | 7.2.2 | Dev server, production build and preview |
| [Vitest](https://vitest.dev/) (`vitest`) | 4.0.9 | Tests |
| [ESLint](https://eslint.org/) (`eslint`, `@eslint/js`) | 9.39.1 | Linting; bans DOM, clock and `Math.random` in core code |
| [typescript-eslint](https://typescript-eslint.io/) (`typescript-eslint`) | 8.46.4 | TypeScript lint rules |
| [tsx](https://tsx.is/) (`tsx`) | 4.23.15 | Runs the headless batch runner (`npm run eval`) |
| `@types/node` | 24.10.1 | Node.js type definitions |
| `@types/three` | 0.181.0 | Three.js type definitions |

Tooling:

- **Node.js** 22.12 or later; CI uses 24.11.0.
- **Python 3**, standard library only, for the docs link checker (`scripts/check_links.py`).
- **GitHub Actions** for CI: `actions/checkout@v4`, `actions/setup-node@v4` and `actions/setup-python@v5`.

## AI use

Credited explicitly under [BRIEF R4](docs/competition/BRIEF.md#4-submission-and-rules). **Most of the code and documentation in this repository was written by AI coding agents, directed by the team.** The team chose the idea and made the design decisions. We split the work into GitHub issues, reviewed every pull request and decided what to merge. The commits, issues and pull requests record who did what, and commits written with Claude carry a `Co-Authored-By: Claude …` trailer.

- **Claude Code (Anthropic).** Arnav ran Claude Code sessions, using the Claude Opus 5.5 and Claude Fable 5.2 models, including an orchestrator session that handed issues to parallel worker sessions. Work done this way:
  - Repository setup and coordination documents.
  - Research into event rules and prior art.
  - Architecture, specification and contract drafting and review.
  - Contract types and fixtures (#12).
  - Score expansion and timing (#13).
  - Steering and the static baseline (#15).
  - App integration of two lockstep worlds (#6).
  - Scenarios, batch runner and results table (#26).
  - World follow-ups (#64).
  - The Encore brain (#16) and its G1 tests (#17).
  - Score adoption and gossip (#21).
  - The Encore brain in the app (#6).
  - Paced steering targets (#80).
  - Isolation and replay tests on the real Encore brain (#65).
  - The UI design system (#89), command parser (#90), selection and inspector (#91), composer and console (#93), Show timeline and QA harness (#94), and the scripted demo (#27).
  - This Devpost text and README (#8).
- **OpenAI Codex.** William's and Haris's sessions used Codex for implementation, tests, code and documentation review, GitHub issue coordination and PR integration. This is team-reported: Codex adds no commit trailer. Recorded contributions:
  - Scaffold and CI/import-boundary checks (#5).
  - World simulation and radio faults (#14, #19).
  - Rendering and visual evidence layers (#18, #25).
  - Controls (#22).
  - Observer metrics (#23).
  - Isolation tests (#20).
  - Comparison HUD (#24).
  - Readiness and documentation corrections (#34, #56).
  - Test timeout fixes (#71).
  - The first draft of these setup and AI disclosures (#8, PR #74).
  - The pitch and demo plan draft (#7, PR #75).
- **GitHub Copilot** is credited as co-author on the initial repository scaffold commit.

`[HUMAN: William and Haris confirm the Codex line; name any code a team member wrote by hand, or confirm there was none worth separating out. Update this section if other AI tools are used before submission.]`

## For the team

| You want to… | Go to |
|---|---|
| Know what's happening now | [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) |
| Find any doc | [`docs/INDEX.md`](docs/INDEX.md) |
| Submit on Devpost | [Devpost text](docs/demo/DEVPOST.md), [submission checklist](docs/demo/SUBMISSION_CHECKLIST.md) |
| Present the demo | [Demo plan](docs/demo/DEMO_PLAN.md) |
| Pick up work | [Open issues](https://github.com/durhacko/Pihh/issues) and the [development plan](docs/planning/development-plan.md) |
| Start your AI agent on an issue | [`docs/development/WORKFLOW.md`](docs/development/WORKFLOW.md#starting-your-agent-on-an-issue-bootstrap-prompt), then [`AGENTS.md`](AGENTS.md) |
| Understand the design | [Architecture](docs/design/system-architecture.md), [contracts and algorithms](docs/design/contracts-and-algorithms.md) |

### Repo layout

```text
AGENTS.md / CLAUDE.md   protocol for AI agents
docs/                   specification, design, plan, event brief, demo and submission
src/contracts/          shared types (change only by [contract] PR)
src/score/              recipe -> priority-ordered slots
src/agent/              drone brains: Encore, the static baseline, and steering
src/sim/                the world: physics, radio, sensing, events
src/observer/           metrics
src/app/                Three.js app: views, controls, HUD, scripted demo; composer, console, inspector
                        and timeline modules (wired by the app shell, #113)
src/cli/                headless batch experiments and run records
tests/  scripts/  assets/  research/  results/
```

### Development

- `npm run dev` serves the app with hot reload on a loopback address.
- URL options: `/?seed=101` gives a reproducible seed, `/?arm=static` shows only the static world, `/?seed=101&split=1` shows both.
- **Console smoke check:** start from a fresh run with `window.encore.reset(101)`, pause with `window.encore.setPlaying(false)` and read `window.encore.alive()`. Schedule a kill with `window.encore.killIds([0])`, then resume with `window.encore.setPlaying(true)`. After the next tick, both alive counts should have dropped by one. This is an inspection step, not a completed browser rehearsal.
- **Checks:** run `bash scripts/check.sh` after `npm ci`. It runs typecheck, lint, the tests (including the import-boundary test), the production build and the Python docs link check. On Windows use Git Bash, because the Windows `bash` command may launch WSL instead. Alternatively run `npm run check`, then `python scripts/check_links.py`.
- **Headless evaluation:** `npm run eval`. See [`results/README.md`](results/README.md).
- **Simulation mode:** Encore always runs in simulation mode. The optional `.env` setting `VITE_SIM_MODE=true` is documented in `.env.example`; setting it to false is rejected. No credentials are needed.

## License

Apache License 2.0. See [LICENSE](LICENSE).
