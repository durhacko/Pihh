<p align="center">
  <img src="docs/assets/readme/encore-hero.svg" width="1000" alt="ENCORE spelled by glowing simulated drones. The O shows a vacant slot and a nearby drone moving to repair the formation." />
</p>

<h1 align="center">Encore</h1>
<p align="center"><strong>A drone light show with no conductor during the performance.</strong></p>
<p align="center">
  <a href="#watch-it-recover">Watch the recovery</a> ·
  <a href="#results-at-a-glance">Results</a> ·
  <a href="#quick-start">Run locally</a> ·
  <a href="#how-encore-works">Architecture</a> ·
  <a href="#a-90-second-tour">90-second tour</a> ·
  <a href="#documentation">Documentation</a>
</p>

In **Encore**, 200 simulated drones perform a shared composition. Each runs an independent, private decision-making process: it knows its own motion, senses nearby neighbours and exchanges short-range radio messages. When part of the picture disappears, surviving drones **redistribute themselves into its more important slots**. When a new score reaches one drone, it spreads through the swarm by gossip.

The same simulation also runs a **static, pre-programmed show**, using the same seed and failures. The result is a visible, measurable comparison—not a claim about flight-ready hardware.

| At a glance | |
|:--|:--|
| **200 agents · 20 Hz** | 3D browser simulation; offline after installing dependencies |
| **20 drones removed** | A regional failure affecting the same 20 drones in both worlds |
| **2.39 m vs 7.03 m** | Median largest gap on the damaged ENCORE formation: Encore vs static; S2, 40–45 s, seeds 1–5 |
| **Trade-off** | Recovery adds radio traffic, slot changes and collisions; there is no collision avoidance |

Built for **DurHack 2026** (Durham, 14–15 November) and its *Composition* theme. This is a **software-only simulation**: no physical drones, no production flight controller and no runtime network requests.

## Watch it recover

<p align="center">
  <a href="docs/assets/readme/repair.gif"><img src="docs/assets/readme/repair.gif" width="840" alt="Animated comparison recorded from the simulator. Both worlds lose the same 20 drones at 20 seconds. Encore, top, shifts surviving drones into the important missing letter slots, while the static baseline, bottom, retains a permanent hole." /></a>
</p>
<p align="center"><sub>Actual simulator capture, seed 101. <strong>Top:</strong> decentralised Encore. <strong>Bottom:</strong> static baseline. Both lose the same 20 drones at 20 s. Frames are cropped and labelled, not simulated anew. <a href="docs/assets/readme/repair.gif">Open the looping GIF directly</a>View the three-step still comparison</a>.</sub></p>

> **Animation not moving?** The GIF contains 44 frames and loops continuously. GitHub may pause GIFs according to your **Settings → Accessibility → Motion** preference or your operating system's reduced-motion setting. The [still comparison](docs/assets/readme/repair-storyboard.png) shows the same sequence without requiring animation; a README cannot override a visitor's GitHub playback settings.

<details>
<summary><strong>View the recovery as three still frames (no animation required)</strong></summary>

<p align="center"><img src="docs/assets/readme/repair-storyboard.png" width="1000" alt="Six-panel still comparison from the recorded GIF: before the failure, just after 20 drones are killed and 25 seconds later. Encore's first letter becomes sparser as survivors fill valuable gaps; the static baseline's first letter retains its missing region." /></p>

Only the first part of the word is enlarged here so the change is legible. Source: [repair.gif](docs/assets/readme/repair.gif).

</details>


## See it in the browser

<p align="center"><img src="docs/assets/readme/stage-split.png" width="820" alt="A split-screen simulator view. The decentralised Encore stage appears above the static baseline; the same formation and seed are shown with separate live readouts." /></p>
<p align="center"><sub><strong>Compare</strong> · Both worlds advance on the same tick. Press <kbd>B</kbd> to toggle Encore, split and static views, or open <code>?split=1</code>.</sub></p>

The interface is built for **doing**, not just watching: select a drone, kill a region (<kbd>K</kbd>), jam communications (<kbd>J</kbd>), partition the swarm (<kbd>P</kbd>) or inject a new composition through the Composer (<kbd>F</kbd>). The same environment events are applied to both worlds. For a guided run, press <kbd>D</kbd> to start the scripted demo.

<details>
<summary><strong>More screenshots: belief propagation, inspector and measured recovery</strong></summary>

### Watch a new score spread

<p align="center"><img src="docs/assets/readme/score-beliefs.png" width="950" alt="A new score has spread to 168 drones while 32 jammed drones retain an older score. Belief colours and the inspector reveal the difference between each drone's own knowledge and the observer's ground truth." /></p>

Colour drones by the score version they believe (<kbd>C</kbd>) and select one to inspect its local knowledge. In this example, a jam keeps 32 drones on the original score while 168 have adopted the newer one. The observer's ground truth is shown separately from each drone's own state.

### See the cost and the improvement

<p align="center"><img src="docs/assets/readme/stage-after-repair.png" width="900" alt="After regional failure the metrics panel compares Encore and the static baseline on the same simulation tick: nPWC is 97.2 percent versus 93.1 percent, with 180 of 200 drones alive in each world." /></p>

Open Metrics (<kbd>M</kbd>) to compare priority-weighted coverage, plain coverage, collisions, radio messages and slot changes. In this captured instant, both worlds have 180 live drones and 90% plain coverage; Encore's priority-weighted score is higher because its survivors moved into more valuable slots.

</details>


## Results at a glance

The initial evidence freeze has **50 matched run records**: five scenarios × five seeds × two brains, with 200 drones for 90 simulated seconds. An expanded matrix covers **20 seeds**, a sixth scenario (S4) and 100-drone repeats. All comparisons pair the same seed and failures; see the [full generated results](results/RESULTS.md) and [expanded matrix](results/full/n200/RESULTS.md).

<details>
<summary><strong>Evidence provenance and reproducibility</strong></summary>

The initial evidence freeze is commit `0b2f8f3`, using parameter SHA-256 `6342c662…`. A replay of one record per scenario reproduced the same state hash, summary and time series. An earlier frozen run at `571c8e4` has the same generated tables but differs in 14 of 50 state hashes and some last-digit floating-point shape metrics (see [superseded records](results/superseded-571c8e4/RESULTS.md), issues #82 and #115). The evidence commit is not the final application release. Subsequent commits up to `f37ef47` changed the interface, UI tests, documentation and results without changing `src/sim`, `src/agent`, `src/score`, `src/contracts`, `src/observer` or `src/cli`.

</details>

**nPWC** (normalised priority-weighted coverage) is the share of the picture's importance covered by live drones, divided by the best the surviving drones could achieve. It uses our own priority order, so the table also gives plain coverage and the largest gap in metres (sfMax). sfMax needs no labels, but our farthest-point slot order is built to keep sfMax small, so it is not fully independent of our choices; plain coverage, which ties at 0.900, is the only metric that cannot favour Encore. The win rule and pass lines were registered in the [evaluation plan](docs/validation/evaluation-and-tests.md#3-scenarios) before the run.

<p align="center">
  <img src="docs/assets/readme/s2-recovery.svg" width="1000" alt="Two line charts of scenario S2 between 15 and 45 seconds, 200 drones, seeds 1 to 5, median line with min-max band. At 20 seconds 20 neighbouring drones are killed. Left: priority-weighted coverage drops to 0.909 for both; the static baseline stays at 0.909 while Encore climbs above the 0.95 recovery line and reaches 0.969 by 45 s. Right: the largest gap in the picture jumps from 1.6 m to about 7 m for both; static stays at 7.0 m while Encore falls back to 2.4 m.">
</p>
<p align="center"><sub>The chart covers the ENCORE hold, 15–45 s, from the 10 S2 run records (<a href="docs/assets/readme/make-charts.mjs"><code>make-charts.mjs</code></a>). The table below measures nPWC later, at 85–90 s, in the next formation.</sub></p>

**The result is not free:** Encore sends roughly 4 messages per drone-second even without failures, the static baseline sends none, and Encore has more collisions in failure and reconnection scenarios. These are simulated entry counts, not physically prevented impacts.

| Scenario (200 drones; 5 seeds) | Late nPWC: static → Encore | Win / tie / loss | Interpretation |
|---|---|---|---|
| **S0** no failures | 1.000 → 1.000 | 0 / 5 / 0 | Encore makes 0 slot changes and sends 4.0 messages per drone-second; static sends none |
| **S1** 20 random drones killed at 20 s | 0.912 → 0.997 | **5 / 0 / 0** | Plain coverage ties at 0.900. Encore recovers in a median 5.25 s; static never reaches the recovery line on any seed |
| **S2** 20 neighbouring drones killed at 20 s | 0.909 → 0.997 | **5 / 0 / 0** | Largest gap in the picture 7.03 m → 2.39 m (median, 40–45 s). Encore recovers in a median 9.25 s, flight included |
| **S3** partition for 30 s, then a 15 s jam, no failures | 1.000 → 1.000 | 0 / 5 / 0 | Encore makes 0 slot changes; 27% of its per-receiver deliveries fail (blocked or lost), against 5% with no radio faults |
| **S5** partition, new score injected on one side, reconnect | no verdict | — | All 200 Encore drones adopt the new score; static cannot (a capability difference, not a win). All live Encore drones agree on one score 0.30–0.45 s after reconnection. **Cost: 103 collisions against 14**, though the two worlds fly different formation changes here ([#123](https://github.com/durhacko/Pihh/issues/123)) |

<details>
<summary><strong>Expanded evaluation: 20 seeds, S4 partition-plus-kill, and 100-drone repeats</strong></summary>

The full matrix, from the same commit, adds seeds 6–20 and the partition-plus-kill scenario S4 at 200 drones, and S1 and S2 at 100 drones ([`results/full/`](results/full/n200/RESULTS.md)). At 200 drones:
- **Ahead on end nPWC on 20 of 20 seeds:** S1 (20 distinct kill sets), S2 (18 distinct) and S4. S4 has only 10 distinct kill sets, because its kill centre is drawn from the few slots near the partition plane.
- **Level on every seed:** S0 and S3. Their events are the same on all 20 seeds, so they are one scenario repeated, not 20 samples.
- **Largest gap during the kill's hold:** 2.39 m for Encore against 7.60 m for static in S2, and 2.99 m against 9.24 m in S4 (medians).
- **Recovery:** S4 is slower, a median of 18.25 s (max 20.75 s). The slowest S2 seed (seed 8, 46.25 s) only partly closes its hole before the next formation.
- **Collisions:** Encore is higher on 19 of 20 seeds in S1 and on 20 of 20 in S2, S4 and S5. In S5 the median is 102 (95–110) against 14, again with the two worlds flying different formation changes.

At 100 drones, S1 and S2 are both 20 / 0 / 0. The full results and their caveats are in [`results/full/n200/RESULTS.md`](results/full/n200/RESULTS.md) and [`results/full/n100/RESULTS.md`](results/full/n100/RESULTS.md).


</details>

<details>
<summary><b>How these numbers are defined and computed</b></summary>

- **nPWC** (normalised priority-weighted coverage): the share of slot importance that is physically occupied by a live drone, divided by the best that the surviving drones could achieve. A slot counts as occupied if any live drone's true position is within 0.6 m of it. It uses our own priority order, so read it beside **plain coverage** (occupied slots / 200) and **sfMax**, the largest distance from any point of the target shape to the nearest live drone, which needs no labels (though our farthest-point slot order is built to keep it small).
- **nPWC at 85–90 s** is the mean over ticks 1700–1799, in the hold of the show's second formation (a sphere), after a formation change. On the damaged ENCORE itself (40–45 s, as in the chart) the medians are S1 0.912 → 0.987 and S2 0.909 → 0.969. **Win** if Encore − static > +0.02 on that seed, **loss** if < −0.02, tie otherwise. Pairs are by seed.
- **Recovery time** (`tRec`): seconds from the kill to the start of the first 3 s stretch with nPWC ≥ 0.95, in a hold. A run that never gets there is *censored*: static in S1 and S2, all 5 seeds.
- **Collisions** are entry events below 0.4 m between live drones, sampled at 20 Hz, so they are lower bounds. They have no physical effect in the simulation.
- **Replay:** run records hold no wall-clock values. One Encore record per scenario was re-run from the same commit and gave an identical state hash, summary and series.
- **Scale and speed:** 5 seeds per cell, so no significance tests. The chart and the ranges quoted here are min–max across seeds; RESULTS.md reports medians with interquartile ranges. Ten 90-second runs of one scenario took 117–133 s headless, one process per scenario, on a shared 16-core laptop.
- **Run coverage:** this methodology describes the five-seed evidence freeze. An expanded matrix includes S4, seeds 6–20 and 100-drone S1/S2 repeats; see [`results/full/`](results/full/n200/RESULTS.md).

</details>

### Where Encore ties or loses

No seed is a loss on nPWC in this run (0 LOSS rows in [`results/RESULTS.md`](results/RESULTS.md)); S5 has no verdict by design. It ties when nothing fails (S0) and when only the radio fails (S3). It always sends more: 4 messages per drone-second against none. Repairs cost a median of 25 (S1) and 33 (S2) slot changes per run, at most 2 per drone. It has slightly more collisions after a kill (17 and 16 against 14). In S5 it has many more (103 against 14, with the two worlds flying different formation changes), because the half of the swarm that adopts the new score after reconnection joins a formation change already in progress at close to full speed ([#123](https://github.com/durhacko/Pihh/issues/123)). nPWC wins rest on our own slot order; plain coverage ties by physics, because both worlds lose the same drones.

**Gate tests.** The pre-registered healing tests (G1) and dissemination tests (G4) run in CI on the real world, the real radio and the real Encore brain. Details are in the [test section](#tests-and-reproducibility).


## The question

A drone show is one picture made by hundreds of machines. Most shows are pre-programmed: each drone flies its own precomputed path from a show file ([Skybrush](https://docs.skybrush.io/public/faq/latest/overview.html) works this way), and a ground station handles setup and abort, not real-time control. If a drone drops out, its part of the picture is simply missing.

> *Can independent agents keep a coherent shared performance when their information and their communication are imperfect?*

Encore explores that question in simulation. Each drone gets the same preloaded score, roster size and algorithm, and reads a shared show clock. From then on it acts only on that, its own body, and what it can sense and hear. There is no central controller during the show. The environment can break things: kill drones, jam the radio, cut the swarm in two, drop packets. Every metric is measured against a pre-programmed baseline flying the same show, with the same seed and the same failures.

Encore invents no new algorithm. It combines known ideas (gossip, local failure suspicion, priority slot claims) into an inspectable drone-show simulation that you can break, and it compares measured recovery against a static pre-uploaded baseline.

## Quick start

You need **Node.js 22.12 or later** and a browser with WebGL. No drones, accounts, keys or network access are needed after install.

```bash
git clone https://github.com/durhacko/Pihh.git encore
cd encore
npm ci            # once; the only step that needs the internet
npm run build
npm run preview
```

Open **http://127.0.0.1:4173/?seed=101&split=1**, or the address Vite prints if port 4173 is taken. On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm`. On WSL, run npm from a Linux path (`cd ~/...`), not from a `\\wsl.localhost\...` path in Windows. `npm ci` may print deprecation and `npm audit` warnings about development tools; they don't affect the build (`npm audit --omit=dev` reports none).

For development with hot reload: `npm run dev`, then open the printed address (Vite's default is port 5173).

**To see the core comparison immediately:** use the `?seed=101&split=1` URL, then press <kbd>D</kbd> for the scripted demo.

| URL option | Effect |
|---|---|
| `?seed=N` | Reproducible seed (default 1) |
| `?split=1` | Encore on top, static below, one camera |
| `?arm=static` | Single view of the static world |
| `?q=low` | Lowest render quality for slow machines: no plain heartbeat lines, no halos, pixel ratio 1, static view at half rate in split. Rendering only |
| `?n0=100`, `150` or `200` | Roster size (default 200; other values are ignored) |

## A 90-second tour

1. **Open** `/?seed=101&split=1`. Encore is on top, the static baseline below; both start from the same word formation.
2. **Press <kbd>D</kbd>** to play the scripted demo. Watch the shared kill at 20 s, the local repair, and the new score spreading under a jam at 64 s.
3. **Take control:** press <kbd>K</kbd> to kill nearby drones, <kbd>J</kbd> to toggle a radio jam, <kbd>C</kbd> for belief colours and <kbd>M</kbd> for measured outcomes. Use <kbd>Space</kbd> to pause and <kbd>R</kbd> to reset.

### Scripted demo timeline

| Simulated time | Event |
|:--|:--|
| **0 s** | The drones form ENCORE |
| **12 s** | Radio X-ray reveals sampled real deliveries |
| **20 s** | The same 20 drones are killed in both worlds; Encore neighbours begin repair |
| **48 s** | Transition to the preloaded sphere |
| **61–73 s** | A jam isolates part of the swarm; belief colours show what each drone knows |
| **64 s** | A new helix score is injected into one drone and spreads by gossip (briefly shown at 0.5× speed) |
| **90 s** | Demo ends; press <kbd>D</kbd> to run it again |

<details>
<summary><strong>All controls, keyboard shortcuts and disruption options</strong></summary>

| Key | Action |
|---|---|
| <kbd>K</kbd> | Kill every live drone within the region radius of the selected one: 6 m by default, 3–16 m with the **Region radius** slider under Disrupt. The same drones die in both worlds. With no live drone selected, click where the centre should be |
| <kbd>J</kbd> | Jam the radio in a fixed sphere of the jam radius around it: 12 m by default, 4–30 m with the **Jam radius** slider under Disrupt (set it before jamming: the slider is hidden while a jam is on). With no live drone selected, click a centre. Press <kbd>J</kbd> again to lift the jam |
| <kbd>P</kbd> | Partition the swarm along the plane x = 0 (press again to reconnect) |
| <kbd>I</kbd> or <kbd>F</kbd> | Open the Composer: choose text, sphere or double helix, pick the target drone, then press **Inject**. Nothing is sent until then |
| <kbd>X</kbd> | Radio X-ray: a sample of the radio messages actually sent: every heartbeat that carries a claim and every score message, new or resent to a drone on an older score (up to 24 receivers each); up to 3 receivers of about one in four other heartbeats; and a short stub at the sender for messages that were lost, jammed or partitioned. With a drone selected, only its own links and stubs are drawn (the counter says "filtered to #N"). If the frame rate stays below 27 fps for a few seconds, plain heartbeat lines are the first thing dropped; `?q=low` drops them too |
| <kbd>C</kbd> | Colour drones by the score version they believe |
| <kbd>Space</kbd> / <kbd>R</kbd> | Play or pause / reset to the seed |
| <kbd>[</kbd> <kbd>]</kbd> | Slower or faster (0.25× to 4×) |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Camera: front, ¾, top |
| <kbd>.</kbd> | Step one tick |
| <kbd>B</kbd> | Cycle Encore → Split → Static |
| <kbd>M</kbd> | Metrics: both worlds compared, including which brain each world flies |
| <kbd>G</kbd> / <kbd>T</kbd> | Ghost slots (observer view) / show timeline |
| <kbd>/</kbd> or <kbd>`</kbd> | Command console (for example `inspect 20`) |
| <kbd>D</kbd> / <kbd>?</kbd> | Scripted demo / help |
| <kbd>H</kbd> | Hide or show all controls (performance view); <kbd>Esc</kbd> brings them back |

The **Disrupt** popover in the dock has *Destroy a region*, *Kill selected drone*, *Kill 10% at random*, jam, partition, the region and jam radii, and packet loss as a slider (0–100% in steps of 5).

Click a live drone to select it before using <kbd>K</kbd> or <kbd>J</kbd>. With no selection, click to place the event centre. Use <kbd>?</kbd> for in-app help. The metrics readout at the upper right gives coverage, alive count, current show phase and frame rate.

</details>

**Try this:** kill a region and compare the two worlds' nPWC 15 seconds later. Then jam a region and inject a composition outside it with belief colours on. A drone that leaves the jam can adopt the new score even before the jam is lifted.

## What the simulation includes

**Simulation and 3D view**
- A deterministic 20 Hz world: 200 drones with clamped speed and acceleration, ideal short-range sensing and a radio with range, packet loss and latency ([`src/sim`](src/sim)).
- A preloaded show: the word ENCORE, then a sphere, then a double helix, with paced flight between formations.
- Three.js stage with orbit camera and three presets, a split view (<kbd>B</kbd> or `?split=1`), a drone inspector, a composer, a command console, a show timeline and a 90-second scripted demo (<kbd>D</kbd>).

**Decentralised behaviour** ([`src/agent/encoreBrain.ts`](src/agent/encoreBrain.ts))
- One brain per drone, with private state. It sees only its own body, its inbox and anonymous neighbours.
- **Local repair:** a drone that senses an important slot empty, and hears nobody holding it, claims it over the radio. The best bid wins, and the drone flies in. Low-priority detail around the hole is given up, so that part of the picture thins instead of keeping a hole.
- **Score dissemination:** a new composition reaches one drone and spreads by store-and-forward gossip, rate-limited, with anti-entropy for drones that missed it.
- **Silence is not death:** radio silence alone never makes a vacancy. A drone that has heard no other drone for 2 s counts as deaf: it drops its claim and starts none, though a claim that completes within those first 2 s can still commit.

**Disruption you can apply**
- Kill a region, a selected drone or a random 10%; jam the radio around a drone; partition the swarm along a plane; set packet loss from 0 to 100%; inject a new composition into one drone.
- Every disruption goes to both worlds as the same environment event. The interface can never set a drone's slot, target or belief.

**Measurement**
- A read-only observer per world: priority-weighted coverage (nPWC), plain coverage, shape error, duplicate slots, slot changes, messages and deliveries, collisions and near-misses, and score versions.
- A headless batch runner for scenarios S0–S5, which writes replayable JSON run records and a results table ([`src/cli`](src/cli)).

## How Encore works

Two parts of the program are easy to confuse. The **environment** is centralised: one process simulates physics, sensing, the radio and the faults, and the observers measure everything. The **decisions** are not: each drone runs its own instance of the brain, sees only its own input, and can affect other drones only by radio messages and by where it flies (one brain module runs every drone, each with its own private state). This split is enforced by tests, not by convention ([`tests/boundaries.test.ts`](tests/boundaries.test.ts), [`tests/isolation`](tests/isolation)).

```mermaid
flowchart TB
    OP["Operator / demo script<br/>kill · jam · partition · inject score"]

    subgraph SIM["CENTRALISED SIMULATOR · src/sim"]
        W["Physics & show clock<br/>20 Hz · positions · faults"]
        I["Local sensing & radio<br/>8 m neighbours · 15 m broadcasts"]
        W -->|"derive individual inputs"| I
    end

    subgraph DEC["DECENTRALISED DECISIONS · src/agent"]
        B["200 independent drone brains<br/>private state · repair · gossip"]
    end

    OBS["Read-only observers<br/>measure from snapshots"]
    UI["3D stage · HUD · run records"]

    OP -->|"environment faults"| W
    OP -.->|"new score to ONE drone"| B
    I -->|"own body, nearby motion, delivered inbox"| B
    B -->|"movement commands + HB/SCORE"| W
    W -.->|"world snapshots only"| OBS
    OBS --> UI

    classDef control fill:#293A55,stroke:#9FBFFF,color:#FFFFFF,stroke-width:2px;
    classDef sim fill:#113B4A,stroke:#63D5DA,color:#FFFFFF,stroke-width:2px;
    classDef agent fill:#4B321F,stroke:#FFC47D,color:#FFFFFF,stroke-width:2px;
    classDef read fill:#1C4235,stroke:#84E4B7,color:#FFFFFF,stroke-width:2px;
    class OP control;
    class W,I sim;
    class B agent;
    class OBS,UI read;
    style SIM fill:#0C2834,stroke:#4898B0,color:#EAF9FF,stroke-width:1px
    style DEC fill:#35261C,stroke:#CF9A64,color:#FFF5E7,stroke-width:1px
```

**Follow the arrows:** the simulator supplies each drone only its **own local input**; drone brains return motion commands and broadcasts; the observer only reads snapshots. Dashed arrows mean **out-of-band injection or read-only observation**, not instructions sent to the swarm. One orange box stands for **200 separate brain instances**, not one shared brain.

### What each drone knows

| A drone gets | A drone never sees |
|---|---|
| The shared show clock and its own position and velocity | Other drones' ids, slots, state or beliefs, except what they broadcast |
| Messages delivered to it this tick | Who is alive: ground truth lives only in the world and the observer |
| Neighbours within 8 m, as relative position and velocity, with no id and no slot | Jam or partition geometry, lost packets and wall-clock time |
| At start: its id and launch slot, the roster size, the preloaded score, the parameters and a private random seed | Any other drone's output from the same tick |

Drones exchange only two kinds of message, both one-hop broadcasts within 15 m. A **heartbeat** (`HB`, 4 times a second) carries the sender's id and position, the slot it holds, when it took it, the score version it flies and, while it is claiming, the slot it wants with its current slot as the bid. A **`SCORE`** message carries a whole composition. The radio never relays. Spreading across the swarm is the drones' own doing.

### Repair: from a failure to a refilled slot

Slots are numbered by importance. The formation is ordered by farthest-point sampling, so any prefix of the slots is an evenly spread version of the shape. When a drone fails:

1. **Detect.** A neighbour within 6 m senses the slot empty for 2 s *and* has heard no heartbeat holding it for 3 s. Silence alone is not enough.
2. **Gate.** On its own heartbeat ticks, the neighbour may act only if it has been settled at its slot for 1 s, the formation has been in a hold for at least 2 s, its target has been stable for 6 s, every drone it heard in the last 2 s flies the same score version, and it has heard *someone* in the last 2 s.
3. **Claim.** It announces a claim in its heartbeats for 1 s. If two drones want the same slot, the one whose current slot is least important wins; on a tie, the lower id wins. Claims only ever move a drone to a more important slot.
4. **Commit and fly.** The winner takes the slot and flies there. Its old, less important slot may in turn be claimed by a nearby drone holding an even less important one, so the vacancy moves down the priority order, one short hop at a time, until it sits in a low-priority slot that nobody nearby wants.
5. **Recover from mistakes.** If two drones end up holding one slot, the earlier holder keeps it once they hear each other, and the other drone returns to its previous slot. A drone that sees its target already occupied gives way.

<details>
<summary><b>Sequence diagrams: repair and score dissemination</b></summary>

Repair, simplified: H holds an important slot and fails. N and R are neighbours; M is further out.

```mermaid
sequenceDiagram
    participant W as World
    participant H as Drone H (slot 3)
    participant R as Drone R (slot 10)
    participant N as Drone N (slot 12)
    participant M as Drone M (slot 20)
    H-->>N: HB {slot 3}
    W->>H: KILL (H stops sensing and sending at once)
    Note over N,R: slot 3 sensed empty for 2 s and no HB for slot 3 for 3 s
    R-->>N: HB {slot 10, claim slot 3}
    N-->>R: HB {slot 12, claim slot 3}
    Note over R: N's current slot is less important, so N's bid wins and R drops its claim
    Note over N: after the 1 s claim window: commit, fly to slot 3
    N-->>M: HB {slot 3, heldSince now}
    Note over M: slot 12 is now empty and silent, so M may claim it
```

Score dissemination, as tested in T18: A and C are 20 m apart, out of radio range; B sits between them.

```mermaid
sequenceDiagram
    participant Op as Operator uplink
    participant A as Drone A
    participant B as Drone B
    participant C as Drone C
    Op->>A: SCORE (new version)
    Note over A: strictly newer, so adopt it and schedule a resend after random jitter
    A-->>B: SCORE
    Note over C: out of A's range
    Note over B: adopt, schedule own resend (rate-limited, never cancelled)
    B-->>C: SCORE
    alt the SCORE to C was lost
        C-->>B: HB {old version}
        Note over B: anti-entropy: B hears an older version and sends the score again
        B-->>C: SCORE
    end
    Note over A,C: the new movement starts 3 s after injection by the shared clock
```

</details>

<details>
<summary><b>Parameters (contract defaults at 200 drones)</b></summary>

| Parameter | Value | Meaning |
|---|---|---|
| Tick | 50 ms (20 Hz) | Simulation step |
| `rSense` / `rRadio` / `rClaim` | 8 m / 15 m / 6 m | Sensing range / radio range / furthest slot a drone may claim |
| `hbPeriod` | 5 ticks (0.25 s) | Heartbeat period |
| `tVacant` / `tSuspect` | 2 s / 3 s | Slot must be sensed empty / unheard for this long |
| `claimWindow` | 1 s | Contention window before commit |
| `claimGap` | 6 slots | Claim only a slot at least 7 places more important |
| `tStable` / `tDeaf` | 6 s / 2 s | Target stability before repair / silence that makes a drone "deaf" |
| `scoreResendMin` / `scoreLead` | 2 s / 3 s | Minimum gap between a drone's SCORE sends / lead time of a new movement |
| `loss` / latency | 5% / 1–2 ticks | Default per-receiver packet loss / radio latency |
| `vMax` / `aMax` | 8 m/s / 8 m/s² | Speed and acceleration limits |

All values: [`src/contracts/params.ts`](src/contracts/params.ts), explained in [contracts and algorithms](docs/design/contracts-and-algorithms.md).

</details>

### The baseline, and why the comparison is fair

The **static baseline** models a pre-uploaded show. Each drone keeps its launch slot for the whole show, flies the preloaded score, never reads its inbox and sends nothing. Both brains use the same steering and paced-flight code. In both the app and the batch runner, the two worlds share the seed, parameters, preloaded score, scripted events, world code and observer code. **Only the brain differs.** In the app, a region kill is resolved once to drone ids from the Encore world's positions, and the same ids die in both worlds; after Encore has moved drones, a later region kill can remove drones from different places in the static world. The results table counts a seed as a fair pair only if commit, parameter hash and events all match.

The baseline is the floor for message cost (zero) and is immune to radio faults by construction. Encore pays for its adaptivity with messages, slot changes and some extra near-misses; [the results](#results-at-a-glance) reports those costs beside the wins.

## Tests and reproducibility

```bash
npm ci
bash scripts/check.sh     # typecheck, lint, all tests, production build, docs link check
npm test                  # tests only
```

CI runs `scripts/check.sh` on every pull request and on pushes to `main` (Node 24.11.0). On Windows, run `check.sh` from Git Bash, or run `npm run check` and then `python scripts/check_links.py`.

| What is tested | Where |
|---|---|
| **Isolation.** `src/agent` imports only contracts and score; the core imports no `three` and no DOM; brains use no clock and no `Math.random` | [`tests/boundaries.test.ts`](tests/boundaries.test.ts) (T01) |
| **Locality (T02), order independence (T03) and replay (T04)** on the real world for every brain, including the real Encore brain. **T05:** a full-show jam leaves the static baseline unchanged | [`tests/isolation`](tests/isolation) (T02–T05) |
| **Healing gate G1.** 40 drones on a text formation, real world, real radio at 20% packet loss, real Encore brain, contract parameters for 40 drones with no overrides, seeds 1–5 and 101–105. Null run: no slot changes. Clumped kill of 5: final nPWC above static, no duplicate lasting over 3 s, at most 3 commits per kill, every commit to a more important slot, no commits in the last 10 s. 35 s full jam: no slot changes | [`tests/g1`](tests/g1) (T08–T10) |
| **Dissemination gate G4.** Two-hop relay; all 200 drones adopt at 20% loss; nothing crosses a jam or partition until it lifts; after a partition the later version wins everywhere | [`tests/g4`](tests/g4) (T16, T18) |
| **The brains in detail.** Every repair gate, claim contention, duplicate resolution, physical yield, gossip rules | [`tests/agent`](tests/agent) |
| **World, radio and faults.** Loss statistics, latency, jam, partition, injection, collision accounting | [`tests/sim`](tests/sim) |
| **Observer, scenarios and runner.** Metric definitions, read-only observer, replayable run records, fair-pair rule | [`tests/observer`](tests/observer), [`tests/cli`](tests/cli) |
| **App.** Controls, readout and Metrics, X-ray, belief colours, inspector, composer, console, timeline and scripted demo, against a fake DOM in Node | [`tests/app`](tests/app) |

To re-run the evidence, check out the evidence commit and write to a new directory (about 6 minutes for all five scenarios in one process on the freeze machine; 10 at `571c8e4`):

```bash
git checkout 0b2f8f3 && npm ci
npm run eval -- --scenario min --seeds 1-5 --arms static,encore --n0 200 --out rerun/
npm run eval -- --report rerun/    # compare with the generated part of results/RESULTS.md
```

Don't write into `results/`: it holds the committed records and hand-written notes, and the runner refuses to overwrite a record from a different commit or parameter set. From the same commit, a re-run gives an identical state hash. In the browser, `window.encore.stateHashes()` returns each world's state hash, so two loads with the same seed and the same actions can be compared.

**Not covered:** there are no browser, GPU or end-to-end tests. The isolation mutation check ([`tests/isolation/check-mutations.mjs`](tests/isolation/check-mutations.mjs)) runs by hand, not in CI. Repair is gated at 40 drones; at 200 drones it is measured by the evidence run but not asserted in a test. Across all 40 kill centres of seed 1 at `0b2f8f3` (the same result as at `571c8e4`), 38 of 40 meet every G1 condition; 2 finish their last repair just after the 20 s quiet limit (20.2 s).

## Neptune North challenge and sponsor tools

Encore was built for the **Neptune North** challenge at DurHack 2026, with the event theme **Composition**: drones compose an image, and a timed score composes images into a show. Neither the challenge brief nor the theme wording was published online. We address both as they were reported to the team, and we don't claim to meet a brief we could not read ([event notes](docs/competition/BRIEF.md)).

The engineering claim it supports is narrow and checkable. Independent actors, each with local sensing, one-hop radio, a shared clock and a preloaded score, keep a recognisable shared picture through the failures and radio faults we tested. Low-priority detail is given up, so the picture thins rather than keeping a hole. Each drone reports its last 20 decisions, which the inspector shows beside the observer's ground truth.

**Sponsor APIs: none are used.** Encore makes no network calls at run time, by requirement ([NFR-04](docs/specification/requirements.md)). There is no Gemini, MongoDB or TigerData integration. A design for Gemini-generated formations has been proposed ([#117](https://github.com/durhacko/Pihh/issues/117)) and is not implemented.

## Built with

| | Exact version ([`package.json`](package.json)) | Used for |
|---|---|---|
| [TypeScript](https://www.typescriptlang.org/) (strict) | 5.9.3 | All code; its parser powers the import-boundary test |
| [Three.js](https://threejs.org/) | 0.181.1 | 3D rendering (WebGL) and orbit controls |
| [Vite](https://vite.dev/) | 7.2.2 | Dev server, build and preview |
| [Vitest](https://vitest.dev/) | 4.0.9 | Tests |
| [ESLint](https://eslint.org/) and [typescript-eslint](https://typescript-eslint.io/) | 9.39.1 / 8.46.4 | Lint; bans DOM, network, clock and `Math.random` in the simulation core |
| [tsx](https://tsx.is/) | 4.23.15 | Runs the headless batch runner |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | 5.2.8 | Offline UI fonts (Inter, JetBrains Mono) |

Also: `@types/node` 24.10.1 and `@types/three` 0.181.0. Python 3 (standard library only) runs the docs link checker. GitHub Actions runs CI. The simulation core (`src/contracts`, `src/score`, `src/agent`, `src/sim`, `src/observer`) has no runtime dependencies.

```text
src/contracts/   shared types and parameters (the boundary between drone and world)
src/score/       compositions -> priority-ordered formation slots
src/agent/       drone brains: Encore, the static baseline, shared steering
src/sim/         the world: physics, sensing, radio, environment events
src/observer/    read-only metrics
src/app/         Three.js app: stage, dock, readout and Metrics, X-ray, inspector, composer, console, timeline, scripted demo
src/cli/         headless scenarios, batch runner, results table
```

## Documentation

| | |
|---|---|
| [System architecture](docs/design/system-architecture.md) | Components, the information rules, the tick, the two-world comparison |
| [Contracts and algorithms](docs/design/contracts-and-algorithms.md) | Types, parameters, messages, composition format, the repair algorithm, motion, baseline |
| [Evaluation and tests](docs/validation/evaluation-and-tests.md) | Metrics, scenarios S0–S5, fairness rules, pre-registered pass lines, test list |
| [Results](results/RESULTS.md) | The generated results table, provenance and hand-written notes |
| [Experience and demo](docs/design/experience-and-demo.md) | Views, layers, controls and the scripted demo |
| [Requirements](docs/specification/requirements.md) | Requirements with acceptance checks, including the claims we must not make |
| [Decisions and risks](docs/planning/decisions-and-risks.md) | Architecture decision records and the risk register |
| [Evidence and assumptions](docs/context/evidence-and-assumptions.md) | Prior art and every simplifying assumption |
| [Docs index](docs/INDEX.md) | Everything else, including the team workflow |

## Limitations

- **A simulation, not flight software.** The drones are logically separate agents in one process, with isolation enforced by tests. Sensing is ideal, the radio is a range-limited sphere with random loss and latency, the clock is shared, and there is no wind, drag or physical collision response. Nothing here has flown.
- **Repair is local and greedy.** A hole is noticed only by drones within 6 m that can sense it. A wiped-out region heals inward from its rim, and an island that no survivor can sense is never detected. Low-priority detail is given up, so the image thins instead of staying whole.
- **Repair is deliberately slow and sometimes paused.** It takes about 3 s to detect a vacancy and 1 s to contend, plus flight. Repair waits during formation changes, inside a jam, and for 6 s after any new score.
- **Partitions can keep two scores alive** until the halves reconnect, and a partition during a formation change looks like mass failure to the half left behind.
- **Collisions are counted, not prevented,** and the counts are lower bounds.
- **Drones are assumed honest.** Any drone can inject a score, and messages are not authenticated. Drones that fail vanish; a drone that fails but stays in place is not modelled.
- **The evidence is bounded.** The initial comparison has five seeds per scenario, and the expanded matrix has 20; these are simulations at fixed parameters and selected drone counts, not statistical proof of general flight performance.

**Next steps.** Reduce reconnection collisions ([#123](https://github.com/durhacko/Pihh/issues/123)); evaluate more seeds, drone counts and scenarios (including S0 at 100 drones); add a central-controller baseline alongside the static one.

## Team and credits

Built at DurHack 2026 by **Arnav Chitriv** ([@reverez](https://github.com/reverez)), **William Pimentel** ([@wpimento](https://github.com/wpimento)) and **Haris Mohammed** ([@sirahmo](https://github.com/sirahmo)). Who did what is recorded in the [issues](https://github.com/durhacko/Pihh/issues?q=is%3Aissue) and [pull requests](https://github.com/durhacko/Pihh/pulls?q=is%3Apr).

**AI use** (credited as required by the event rules, [BRIEF R4](docs/competition/BRIEF.md#4-submission-and-rules)). Most of the code and documentation in this repository was written by AI coding agents, directed by the team. The team chose the idea, made the design decisions, split the work into GitHub issues and decided what to merge.
- **Claude Code** (Anthropic; Claude Opus 5.5 and Claude Fable 5.2 models) ran in Arnav's sessions, including an orchestrator session that handed issues to parallel worker sessions. It did the contracts, score, steering and baseline, the Encore brain and its G1 tests, score gossip, the app integration, the scripted demo, the interface modules, the evaluation runner and the evidence run, and most of the documentation. Commits carry a `Co-Authored-By: Claude …` trailer.
- **OpenAI Codex** ran in William's and Haris's sessions, as reported by the team. It did the scaffold and CI, the world and radio faults, the renderer and X-ray layers, the controls, the observer, the isolation tests and the comparison HUD. Codex adds no commit trailer.

Prior art that shaped the design is listed in [evidence and assumptions](docs/context/evidence-and-assumptions.md). The 5×7 dot font, all images and the diagrams in this README were made for this project or cropped from its recorded simulator output. The banner is drawn with the app's own formation font by [`make-hero.mjs`](docs/assets/readme/make-hero.mjs), the chart is drawn from the run records by [`make-charts.mjs`](docs/assets/readme/make-charts.mjs).

## License

[Apache License 2.0](LICENSE).
