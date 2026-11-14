# Development plan

Purpose: what gets built, in which order, by whom, and what can run in parallel. Each row in the work table is one GitHub issue and one PR. Live status is on [GitHub issues](https://github.com/durhacko/Pihh/issues), not here. Process rules are in [`AGENTS.md`](../../AGENTS.md) and [`../development/WORKFLOW.md`](../development/WORKFLOW.md).

## Gates and times (GMT)

Each gate's pass/fail evidence is defined in [`../validation/evaluation-and-tests.md`](../validation/evaluation-and-tests.md).

| Gate | Meaning | Target | If missed |
|---|---|---|---|
| G0 | Design accepted, contracts merged | Sat 20:30 | — |
| G1 | Local-only healing works headless (the thesis) | Sat 23:30 | [Fallback ladder](decisions-and-risks.md#fallback-ladder-if-healing-fails-g1) |
| G2 | 3D view shows real agent state and reacts to a kill | Sun 00:30 | All three on integration |
| G3 | Jam and partition honestly block radio; drones act on local knowledge | Sun 02:30 | Keep jam sphere, drop partition plane |
| G4 | Score injected into one drone spreads by radio; split and reconnection visible | Sun 03:30 | Demo healing only |
| G5 | Reproducible metrics and baseline comparison | Sun 06:30 | 5 seeds, fewer scenarios |
| — | **Feature freeze** | Sun 08:30 | — |
| — | Backup video recorded | Sun 09:00 | — |
| G6 | Submitted on Devpost | Sun 10:15 (hard 11:00) | — |

## Lanes

Directories are the collision boundary: one lane owns each. Owners are **provisional** until the team confirms skills and availability; nothing below is binding on Haris or Williams until they claim the issue on GitHub.

| Lane | Directories | Proposed owner | Shared files owned |
|---|---|---|---|
| A. Brain and contracts | `src/contracts`, `src/score`, `src/agent` | Arnav (integration lead; runs the orchestrator and its local sub-agents) | `src/contracts/**`, contracts doc |
| B. World and evidence | `src/sim`, `src/observer`, `src/cli`, build and CI | Williams | `package.json`, `tsconfig`, `vite.config`, `scripts/check.sh`, CI |
| C. Experience | `src/app/**`, demo, submission | Haris | `src/app/main.ts`, `index.html`, README |

If a lane has nobody active, its READY issues can be taken over under the takeover rule in [`AGENTS.md`](../../AGENTS.md) §1: the orchestrator's sub-agents take them, one issue per worktree.

## Work table

"Fixture" means the issue can start before its dependency merges, by building against the named test double from WP-0b.

| ID | Issue | Lane | Allowed files | Depends on | Fixture | Gate | Priority |
|---|---|---|---|---|---|---|---|
| WP-0a [#5](https://github.com/durhacko/Pihh/issues/5) | Scaffold: Vite + TS + vitest + lint, `scripts/check.sh`, CI, import-boundary check | B | repo config, empty `src/*` folders | — | — | G0 | MUST |
| WP-0b [#12](https://github.com/durhacko/Pihh/issues/12) | Contract types, `DEFAULT_PARAMS`, fixtures (`dummyBrain`, `fakeSnapshot`) | A | `src/contracts/**`, `tests/fixtures/**` | WP-0a | — | G0 | MUST |
| WP-4a [#13](https://github.com/durhacko/Pihh/issues/13) | Score: bitmap font, sphere, helix, farthest-point slots, `currentMovement`, `composeNext`, `launchPos` | A | `src/score/**`, `tests/score/**` | WP-0b | — | G1 | MUST |
| WP-2a [#14](https://github.com/durhacko/Pihh/issues/14) | World core: tick loop, physics clamps, sensing grid, radio (range, latency, loss, jam sphere via `JAM_ON`/`JAM_OFF`), `KILL`, snapshot, `inspect`, `stateHash`, seeded RNG | B | `src/sim/**`, `tests/sim/**` | WP-0b | `dummyBrain` | G1 | MUST |
| WP-1a [#15](https://github.com/durhacko/Pihh/issues/15) | Steering function and static baseline brain | A | `src/agent/steer.ts`, `src/agent/staticBrain.ts`, `tests/agent/steer*` | WP-0b, WP-4a | — | G1 | MUST |
| WP-1b [#16](https://github.com/durhacko/Pihh/issues/16) | Encore brain: heartbeats, peer table, `canHeal`, scan, claim, commit, duplicate rule, physical yield, belief | A | `src/agent/encoreBrain.ts`, `src/agent/state.ts`, `tests/agent/encore*` | WP-1a | scripted `AgentInput` sequences | G1 | MUST |
| WP-1c [#17](https://github.com/durhacko/Pihh/issues/17) | G1 falsification tests on the real world (nPWC, duplicate slots and slot changes computed inline in the tests; no observer needed); tune parameters | A | `tests/g1/**`, `src/contracts/params.ts` (values only) | WP-1b, WP-2a | — | **G1** | MUST |
| WP-3a [#18](https://github.com/durhacko/Pihh/issues/18) | Render slice: `WorldView`, instanced drones, camera rig, snapshot buffer, main loop | C | `src/app/**`, `index.html` | WP-0b | `fakeSnapshot` | G2 | MUST |
| WP-3b [#6](https://github.com/durhacko/Pihh/issues/6) | Integrate: app steps two real worlds; kill a drone from the console | A | `src/app/main.ts`, `src/app/worlds.ts` | WP-3a, WP-2a, WP-1a | `staticBrain` in both worlds until WP-1b merges (one-line swap to `encoreBrain`) | **G2** | MUST |
| WP-2b [#19](https://github.com/durhacko/Pihh/issues/19) | Radio faults and events: partition groups, `SET_LOSS`, `INJECT_SCORE`, drop reasons in the radio log, `idsInSphere`, `randomIds` | B | `src/sim/**`, `tests/sim/**` | WP-2a | — | G3 | MUST |
| WP-2c [#20](https://github.com/durhacko/Pihh/issues/20) | Isolation and determinism tests: differential locality, order independence, replay, pure-jam continuity | B | `tests/isolation/**` | WP-2a, WP-1a | — | G3 | MUST |
| WP-6a [#21](https://github.com/durhacko/Pihh/issues/21) | Brain: score adoption, anti-entropy send with jitter and a rate limit (never cancelled); tests on partition, reconnection and the relay line (T18) | A | `src/agent/encoreBrain.ts`, `tests/agent/score*` | WP-1b, WP-2b | — | **G4** | MUST |
| WP-5a [#22](https://github.com/durhacko/Pihh/issues/22) | Controls and actions: panel, kill region / random / selected, jam, inject, play / pause / reset / speed / seed; same events to both worlds; UI integration test | C | `src/app/ui/**`, `src/app/actions.ts` | WP-3b | — | G3 | MUST |
| WP-7a [#23](https://github.com/durhacko/Pihh/issues/23) | Observer: metrics per the evaluation doc, `MetricsSample` stream, `slotStatus`, reference formation, observer-read-only test | B | `src/observer/**`, `tests/observer/**` | WP-2a, WP-4a | — | G5 | MUST |
| WP-5b [#24](https://github.com/durhacko/Pihh/issues/24) | Split view (Encore above, static below) and HUD | C | `src/app/render/WorldView.ts`, `src/app/ui/Hud.ts` | WP-3b, WP-7a | — | G5 | MUST |
| WP-8a [#25](https://github.com/durhacko/Pihh/issues/25) | X-ray: radio layer from `RadioEvent`, jam and partition volumes, belief colours, death marker | C | `src/app/render/layers/{Radio,Zone}Layer.ts`, `colourModes/**` | WP-3b, WP-2b | — | G3, G4 | MUST |
| WP-7b [#26](https://github.com/durhacko/Pihh/issues/26) | Scenarios S0–S5, CLI batch runner, run records, results table generator | B | `src/cli/**` (scenarios in `src/cli/scenarios.ts`), `results/**` | WP-7a, WP-2b, WP-6a | — | **G5** | MUST |
| WP-9a [#27](https://github.com/durhacko/Pihh/issues/27) | Scripted 90-second demo and captions | C | `src/app/ui/DemoScript.ts` | WP-5a, WP-8a, WP-6a | — | G6 | MUST |
| WP-8b [#28](https://github.com/durhacko/Pihh/issues/28) | Ghost slots (faint target points, vacant ones highlighted) from `Observer.slotStatus`; tethers are SHOULD | C | `src/app/render/layers/GhostSlotLayer.ts` | WP-3b, WP-7a | — | G5 | SHOULD |
| WP-8c [#29](https://github.com/durhacko/Pihh/issues/29) | Drone inspector from `World.inspect` and `Belief` | C | `src/app/ui/Inspector.ts`, `layers/SelectionLayer.ts` | WP-3b | — | — | SHOULD |
| WP-9b [#7](https://github.com/durhacko/Pihh/issues/7) | Demo plan, 90-second pitch, rehearsals, backup video | C | `docs/demo/**`, `assets/**` | WP-9a | — | G6 | MUST |
| WP-9c [#8](https://github.com/durhacko/Pihh/issues/8) | README (run steps, frameworks, AI credit, where Encore ties or loses), Devpost submission | C | `README.md`, `docs/demo/**` | WP-7b | — | **G6** | MUST |

Shared-file rules. Each layer and panel is its own file and **self-registers**: WP-3a sets up `src/app/render/layers/index.ts` and `src/app/ui/index.ts` with `import.meta.glob`, so no later issue edits an index. `src/app/main.ts` belongs to WP-3b: other issues ask for a hook there instead of editing it. WP-0a installs every dependency, so no later issue edits `package.json`. With those three rules, no two issues that can run at the same time list the same file.

## Dependency graph

```mermaid
flowchart LR
  0a[WP-0a scaffold] --> 0b[WP-0b contracts]
  0b --> 4a[WP-4a score]
  0b --> 2a[WP-2a world core]
  0b --> 3a[WP-3a render slice]
  4a --> 1a[WP-1a steer + static]
  1a --> 1b[WP-1b Encore brain]
  1b --> 1c{{WP-1c G1}}
  2a --> 1c
  3a --> 3b{{WP-3b G2}}
  2a --> 3b
  1a --> 3b
  2a --> 2b[WP-2b radio faults]
  2a --> 2c[WP-2c isolation tests]
  1a --> 2c
  1b --> 6a{{WP-6a G4}}
  2b --> 6a
  3b --> 5a[WP-5a controls]
  3b --> 8a[WP-8a X-ray]
  2b --> 8a
  2a --> 7a[WP-7a metrics]
  4a --> 7a
  7a --> 5b[WP-5b split + HUD]
  3b --> 5b
  7a --> 7b{{WP-7b G5}}
  2b --> 7b
  6a --> 7b
  5a --> 9a[WP-9a scripted demo]
  8a --> 9a
  6a --> 9a
  9a --> 9b[WP-9b pitch + video]
  7b --> 9c{{WP-9c G6}}
```

**Critical path:** WP-0a → WP-0b → WP-4a → WP-1a → WP-1b → WP-1c (G1). Everything else has slack behind it. WP-1b is the riskiest issue in the project and starts the moment WP-1a merges. Inside WP-1a, `steer.ts` needs nothing from WP-4a and can be written while WP-4a is in progress; only the static brain waits for it.

## What can run in parallel, and when

| When | Lane A | Lane B | Lane C |
|---|---|---|---|
| Now | Architecture PR (#4) | **WP-0a** | Read the experience doc; verify the sponsor brief (#1) |
| After WP-0a | **WP-0b** (30 min) | — | — |
| After WP-0b | WP-4a, then WP-1a, then WP-1b | WP-2a | WP-3a |
| After WP-2a | WP-1c (G1), WP-3b (G2) | WP-2b, WP-2c, WP-7a | WP-5a after WP-3b |
| After G1 and G2 | WP-6a | WP-7b | WP-8a, WP-5b, WP-8b, WP-8c |
| From 06:30 | Fixes only | Batch runs, results table | WP-9a, WP-9b, WP-9c |

Three issues are open to three laptops at once from the moment WP-0b merges (WP-4a, WP-2a, WP-3a), with no shared files.

## Core and optional

The MVP is the **core**: the locality invariant (agent isolation and its tests), genuine local healing, a real communication simulation, 3D rendering of real state, and fair baseline evidence. Optional work is cut before any of that is weakened.

| Core (never cut) | Optional (cut first) |
|---|---|
| WP-0a, 0b, 4a, 2a, 1a, 1b, 1c: the mechanism and G1 | WP-8c inspector |
| WP-2c locality and determinism tests (P0) | WP-8b ghost slots |
| WP-3a, 3b: 3D view of real state (G2) | Split view in WP-5b (a toggle is enough) |
| WP-2b, 6a: jam, partition, score gossip (G3, G4) | Belief and partition extras in WP-8a beyond radio lines and version colours |
| WP-5a controls; WP-8a radio lines from the real log | The 20-seed matrix and S4 in WP-7b (5 seeds on S0, S1, S2, S3, S5 is the minimum) |
| WP-7a metrics; WP-7b minimum evidence | Tethers, follow camera, 3-minute script, glow post-processing |
| WP-9a, 9b, 9c: scripted demo, video, submission | `transitLanes`, judge-typed text |

## If we fall behind: cut order

Cut from the top. Never cut agent isolation, real radio lines, or the regional kill with repair.

1. Follow camera, auto-orbit, 3-minute script, observer truth column
2. WP-8c inspector depth (keep id, slot, version, deaf, last decisions)
3. Partition plane (keep the jam sphere)
4. Glow post-processing (keep the sprite halo)
5. Split view (toggle between worlds; both numbers stay in the HUD)
6. WP-8b ghost slots
7. 20 seeds → 5 seeds; S4 dropped
8. `n0` 200 → 100
9. WP-6a dissemination (demo healing only), only if G1 passed late

## Review history

| Round | What was reviewed | Outcome |
|---|---|---|
| 0 | First healing draft, by an adversarial sub-agent | 3 fatal, 6 serious flaws; redesigned (ADR-007) |
| 1 | The four dependent docs, by their own writers against the contract | 10 contract gaps fixed: group-based partition, per-world reference formation, `makeParams`, observer API, yield only in hold |
| 3 | Independent development-readiness audit (external), 14 Nov 19:40 | Fixed: same-version cancellation removed from score gossip (it could silence the only drone able to reach a stale neighbour); relay test T18 added; offline vs local server clarified; takeover rule tightened; lane C shared index files removed; MVP core vs optional recorded; readiness checks created for all three laptops. Still open: the research handoff packet |
| 2 | All docs, by five reviewers (decentralisation, algorithm, consistency, evaluation, delivery), each finding independently verified | 27 confirmed findings, about 16 distinct, all fixed: dependent docs realigned to the contract; G1 jam moved into WP-2a; `Belief.target` and slot positions exposed for the renderer; shape scaling defined; T02 made deterministic; claim-release rule added. **The review loop was stopped by the team after this round; the fixes themselves have not been re-reviewed** |
