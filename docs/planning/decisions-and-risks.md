# Decisions and risks

Purpose: every architecture decision with its reason, the decision log, the risks with mitigations, and the answers to the red-team questions. Status of each ADR: **accepted** unless marked otherwise. Detail lives in the design docs; this file records *why*.

## Source precedence

When sources disagree: (1) the latest explicit instruction from the team, (2) verified event rules ([BRIEF](../competition/BRIEF.md)) and safety, (3) decisions already merged in this repo, (4) the research handoff's validated requirements, (5) the architect's recommendations. The research handoff packet has **not been received** ([research-handoff.md](../context/research-handoff.md)); when it arrives, level 4 applies and conflicts get an issue.

## Architecture decisions

| ADR | Decision | Alternatives rejected, and why | Consequence |
|---|---|---|---|
| **001 Runtime** | TypeScript (strict) + Vite + Three.js. A pure-TS simulation core with no DOM, run in the browser and headless under Node with vitest. | *Python sim + Three.js front end:* two languages and a socket or file interface between them, and two implementations of every type. *Python only:* weak real-time 3D. | One brain implementation serves the live show and the batch experiments. Static build, works offline. **Risk:** the team's TypeScript experience is unrecorded; the AI agents write most of the code, and the contracts are small. |
| **002 Execution** | Fixed 20 Hz timestep; all brains step on the previous tick's state; explicit radio queue; rendering interpolates at display rate; one seed per run with separate streams for the world and for each brain. | *Variable timestep:* not reproducible. *Event-driven agents:* harder to replay and to explain. | Same seed gives the same run. We do not promise bit-identical floats between Node and the browser; replay tests run within one host. |
| **003 Agent boundary** | A brain is `init` / `step(state, input) → output` / `belief(state)`. Input is its own body, delivered messages, anonymous sensed neighbours and the clock. No world handle exists in the API. | *Agents as objects holding a world reference with "please only read your own data":* unenforceable. | Enforced by an import-boundary check and a differential locality test. The observer reads beliefs through `belief()` only. |
| **004 Radio** | Broadcast-only disc model: range, 1–2 tick latency, per-receiver loss, jam spheres, partition planes, a real event log. Two message types, `HB` and `SCORE`. No relaying. | *Unicast and acknowledgements:* more protocol than the demo needs. *Relay floods with TTL:* see ADR-007. | Message cost is bounded: each drone sends 4 heartbeats a second. The X-ray view draws from the medium's log. |
| **005 Membership** | A peer table from directly heard heartbeats, with three levels: last-known, suspected (silent), locally observed vacancy (silent **and** sensed empty). Radio silence alone never counts as death. No gossiped membership in the MVP. | *Gossiped heartbeat counters with max-merge:* a counter proves past life, not present life, and nothing in local repair needs a global view. | Peer tables are never claimed to converge. A drone knows only its radio neighbourhood. |
| **006 Composition** | A score is a version plus timed movements, each a small recipe (text, sphere, helix). Every drone expands a recipe to exactly `n0` slots in farthest-point order. Slot index persists across formations. | *Shipping point clouds:* large messages and a central author at run time. *Per-formation reassignment:* needs coordination on every transition. | A formation change needs no messages. Any prefix of the slots is an evenly thinned image, which gives "priority" a visual meaning. Unrelated slot positions between formations mean drones cross paths in transitions (risk 6). |
| **007 Healing** | **Local one-hop claims.** A drone claims only a vacancy it senses itself within `rClaim`, that is more important than its own slot by `claimGap`. It announces the claim in its heartbeat for 1 s; the bidder with the least important current slot wins. Duplicates: the earlier holder keeps the slot and the other pops back down its history; a claimant also yields if it sees the slot already occupied. [Contracts §8](../design/contracts-and-algorithms.md#8-healing-local-claims-adr-007). | *Slot = my rank among believed-alive drones:* one death shifts everyone, and it needs a death verdict radio cannot give. *Flooded vacancy and claim messages (first draft):* the red-team review showed millions of deliveries on a clumped kill, amplified false positives and no benefit, since every eligible claimant senses the hole itself. *An "unassigned" state:* thrashes, no termination argument. *Auctions (CBBA-style):* multi-round, fragile under loss, too much for the time. *Tail reassignment over a gossiped per-slot register:* cleaner end state, but long crossings and far more machinery. | Simple and bounded, with a settling argument. **Repair is local and greedy, not global or optimal** (limits in contracts §8.5). Proven or killed first, at gate G1. |
| **008 Partitions** | Physical failure and communication failure are separate. Under a jam or partition, live drones keep flying their score and do not claim. Sides may hold different score versions; after reconnection, anti-entropy on heartbeats spreads the newest version. Version = (injection tick, origin). | *Promising agreement during disconnection:* false. *Version = local counter + 1:* a stale-side injection could silently lose to an older composition. | Four kinds of convergence are distinguished and only score-version convergence is claimed, and only between drones that can communicate ([contracts §9](../design/contracts-and-algorithms.md#9-score-dissemination-and-partitions-adr-005-adr-008)). |
| **009 Motion** | The brain proposes an acceleration; the world clamps acceleration and speed. Arrive-style steering plus separation and a mirrored sidestep. Collisions and near-misses are counted from true positions and have no physical effect. | *Proving collision-freedom, or velocity-obstacle planners:* out of reach in the time. | We report collision counts and never claim safety. Not flight-control software. |
| **010 Observer isolation** | Renderer, metrics and baseline comparison read snapshots. The app changes a world only by scheduling environment events. A new score enters through one drone's inbox. Two worlds (Encore, static) run from the same seed and event script. | *One world with a "baseline overlay":* invites shared state. | Tested: the state hash is identical with and without the observer attached. |

## Decision log (newest first)

| Date (GMT) | Decision | By | Why |
|---|---|---|---|
| 2026-11-14 18:30 | Healing redesigned after red-team: no floods, no unassigned state, local `canHeal` gate | Arnav (orchestrator) | Three fatal flaws found in the first draft; see ADR-007 |
| 2026-11-14 18:15 | Keep the existing `docs/` tree and map the directive's `Documentation/` layout onto it | Arnav (orchestrator) | Existing issues and links point there; one canonical tree |
| 2026-11-14 18:05 | **Encore selected**, Neptune North as primary track | Arnav | [SELECTION_DECISION](../ideation/SELECTION_DECISION.md); three-way scoring skipped |
| 2026-11-14 | Bootstrap PR #10 squash-merged to `main` on Arnav's instruction | Arnav | Coordination system needed on `main` |
| 2026-11-14 | GitHub Issues + labels + milestones are the task board; no Projects board | Arnav (agent) | Token lacks the `project` scope |
| 2026-11-14 | No branch protection; PR-only by convention | Arnav (agent) | Private repo on a free org: API returns 403 |
| 2026-11-14 | Trunk-based flow, short-lived branches, squash merge | Arnav (agent) | Lowest friction for three people |

## Risks

P = probability, I = impact. Owners are roles until skills are confirmed.

| # | Risk | P | I | Owner | Mitigation | Trigger | Fallback |
|---|---|---|---|---|---|---|---|
| 1 | Healing oscillates, duplicates or never settles | M | H | Agent-brain owner | G1 falsification tests first, on 40 drones, before any polish; conservative timers | G1 not passed by 23:30 Sat | Fallback ladder below |
| 2 | Scope too large for ~14 hours | H | H | Arnav | MUST/SHOULD/STRETCH per requirement in [requirements](../specification/requirements.md); feature freeze 08:30 | G2 not reached by 01:30 Sun | Cut in the order listed in the plan |
| 3 | Contracts drift between laptops | M | H | Arnav | Types land in one PR before parallel work; `[contract]` PR rule; contract log check | A PR fails to compile against `main` | Contract owner fixes within 15 min |
| 4 | Parallel work never integrates | M | H | Arnav | G2 vertical slice by 00:30 using fixtures; PRs under 2 hours | Components "done" but not wired | All three on integration until G2 passes |
| 5 | Looks like "just particles"; decentralisation invisible | M | H | Experience owner | X-ray and belief views are MUST, with real events; inspector | Judges' first question at a rehearsal | Lead the pitch with the kill + split view |
| 6 | Transition gridlock or ugly collision counts | M | M | Agent-brain owner | Transition time scales with distance; `transitLanes` switch; counts shown as "measured" | Collisions per transition > 20 on dev seeds | Turn on lanes; lengthen transitions; fewer drones |
| 7 | Performance below 30 fps with two worlds | M | M | Experience owner | Instancing; degrade order; `?q=low` | Measured at G2 | Toggle view instead of split; `n0` 100 |
| 8 | Static baseline ties or beats Encore on some metric | H | L | Validation owner | Expected and pre-registered (random kill, pure jam, message cost, collisions); report it | — | Say so in the README; it is evidence of honesty |
| 9 | Neptune North brief differs from what the team reported | M | H | Haris (#1) | Verify at the booth | Brief captured | Re-angle the pitch; the demo stands |
| 10 | Research handoff contradicts this design | M | M | Arnav | Reconcile when received | Packet arrives | Issue per conflict, precedence above |
| 11 | No TypeScript experience on a laptop | M | M | Each human | Agents write the code; contracts are small; `scripts/check.sh` catches breakage | Scaffold PR struggles | Pair on the first PR |
| 12 | Demo fails live | M | H | Experience owner | Scripted demo from a fixed seed; reset control; backup video by 09:00 | A rehearsal fails | Play the video; show the headless numbers |
| 13 | Missing submission items (framework list, AI credit, public repo) | M | H | Haris (#8) | [SUBMISSION_CHECKLIST](../demo/SUBMISSION_CHECKLIST.md) | Not started by 08:00 | Minimal Devpost by 10:15 |
| 14 | Overnight fatigue breaks `main` | H | M | All | CI on every PR; `demo-good-<n>` tags; revert first | `main` red | Revert to the last tag |

## Fallback ladder if healing fails G1

Take the first rung that passes the three G1 tests. Never fake healing in the renderer.

1. **Tune:** longer `tVacant` / `tSuspect`, larger `claimGap`, one claim per drone per 10 s.
2. **Simplify:** drop the contention window. A drone commits immediately if it is the highest-index drone it has heard within `rClaim` of the vacancy; duplicates resolve as before.
3. **Reduce:** healing only when radio is fully connected and the formation is in hold; anything else is "holds position".
4. **Honest reduced product:** no healing. The demo becomes composition by gossip, partitions and beliefs (gates G3 and G4), with the static baseline compared on dissemination only. Say plainly that repair was not achieved.

## Red-team answers

Answers after the review rounds recorded in [development-plan.md](development-plan.md#review-history). "Tested" means a named automated test exists in the evaluation doc; none has run yet, because no code exists.

| # | Question | Answer |
|---|---|---|
| 1 | Hidden central decision-making? | None by design. The world emulates physics and radio only. Central inputs are all preloaded or external: roster, initial score, parameters, and the operator's one-drone uplink. To be tested by the import boundary, differential locality and observer-read-only tests. |
| 2 | Can drones know things they shouldn't? | Sensing is anonymous and range-limited; inbox is range-, jam- and loss-limited. Residual leaks to police in review: ids in observations, world-pruned peer tables, shared mutable caches. The synced clock is a stated assumption. |
| 3 | Recovery without a global oracle? | Yes in design: claims use only self-sensed vacancies and heard heartbeats. Unproven until G1. |
| 4 | Oscillation under delay? | Claims only lower a drone's index; pops are bounded by history; a claim is re-checked at the end of its window and repeated four times. Measured by slot changes per drone. |
| 5 | Conflicting assignments under partition? | Possible. Two claimants that cannot hear each other may both commit. Resolved on contact (earlier holder keeps) or by physical yield. Counted as duplicate-slot seconds. |
| 6 | Can a drone reach the slot? | Usually: `dAvoid` is below slot spacing, and repulsion is soft. Not guaranteed in dense 3D shapes; collisions are counted. `transitLanes` is the reserve. |
| 7 | Can the static baseline win? | Yes: on message cost always; on collisions and near-misses probably; on pure jam and nominal runs it ties; on a random kill the difference is small. Total coverage is identical by physics. |
| 8 | Is the baseline fair? | Same world, physics, steering, seed, kills and metric code. It keeps flying under jam and failures. Its inability to adopt a new score is inherent and reported as a capability difference. |
| 9 | Are metrics biased? | Priority-weighted coverage uses our own ordering, so it is always paired with total coverage and a label-independent shape-fidelity distance. Capacity loss and coordination loss are reported separately. |
| 10 | 100+ agents interactive? | Expected: O(N·k) per tick with a spatial grid, no floods. Unmeasured until G2. |
| 11 | Is the picture really the simulation? | The renderer reads snapshots; radio lines come from the medium's log, with a "drawn n / m" counter; the inspector shows `World.inspect` and `Belief` only. |
| 12 | First test that could falsify the thesis? | Contracts §8.6 test 2: clumped kill on 40 drones, headless. |
| 13 | Can the MVP ship in time? | Tight. The plan protects it with G1 by 23:30, G2 by 00:30 and a cut order. |
| 14 | What goes first if behind? | The [cut order in the plan](development-plan.md#if-we-fall-behind-cut-order). Never: real radio lines, agent isolation, the regional kill with repair. |
| 15 | Can another agent build from this alone? | That is the acceptance test for the docs: each issue names its contract sections, allowed files, fixtures and tests. |
