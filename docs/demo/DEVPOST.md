# Devpost submission text

> **Draft. Ready to paste once the placeholders are filled.** Owner: Arnav ([#8](https://github.com/durhacko/Pihh/issues/8)). Deadline: Sun 15 Nov 11:00 GMT; team target 10:15 ([BRIEF S3](../competition/BRIEF.md#1-schedule-gmt)). Paste each section below the line into the Devpost field of the same name.

**How to paste.**

- Don't paste this box, any heading, or any line that starts with **NOTE:**.
- A line that starts with **FALLBACK:** replaces the `[IF …]` text just above it when that gate did not pass. Paste only the text inside its quotes.
- Fill every placeholder or delete the sentence it sits in. Never paste a bracket.

**Placeholders.**

- `[RESULT: …]`: a number from `results/RESULTS.md`. That file is generated at the frozen revision by `npm run eval -- --report results/ --report-out results/RESULTS.md`. Quote each number with its seed count, using the [wording rules](../validation/evaluation-and-tests.md#8-bias-risks-and-reporting-wording).
- `[IF G1]` / `[IF G4]` / `[IF …]`: keep the text only if that gate passed or that condition holds ([evaluation §7](../validation/evaluation-and-tests.md#7-gates)). Otherwise use the FALLBACK line.
- `[HUMAN: …]`: only a team member can supply this.

Before pasting, check every sentence against [requirements §5 "Claims we must not make"](../specification/requirements.md#5-claims-we-must-not-make).

---

## Project name

Encore

## Tagline

A simulated drone light show with no conductor mid-show: 200 drones each decide from what they sense and hear, and refill important gaps after failures.`[IF G4: …and pass new scores drone to drone.]`

**NOTE:** G1 passed, so "try to" was dropped. Repair is partial, so putting it back is defensible. Append the `[IF G4]` clause only if G4 passed. Confirm the tagline length limit on the Devpost form (H1); it is not documented in the brief.

## Inspiration

A drone light show is usually a recording. Each drone flies a trajectory computed before take-off, and the ground station mainly starts and aborts the show. In a show without spare drones, a drone that drops out leaves its pixel dark.

We wanted to know what a show looks like if nobody conducts it during the performance. Each drone would know only its own state, the score it was loaded with, what it senses nearby and what it hears on short-range radio. Could the survivors keep the important parts of the picture readable? Could a new piece reach the whole swarm drone to drone?

We read the theme, Composition (as reported to the team), on two levels. Individual drones compose an image, and a timed score composes the images into a show.

**NOTE:** The pre-computed-trajectory model is from the Skybrush docs ([EV-09](../context/evidence-and-assumptions.md#12-prior-art)). The theme wording is not verified online ([BRIEF T1](../competition/BRIEF.md#2-theme)). If it is confirmed at the venue, "(as reported to the team)" may be dropped.

## What it does

**Encore is a simulation, not real drones. No hardware is involved.** About 200 drones run as logically independent agents inside one TypeScript program on one laptop. The program simulates the air and the radio; it does not tell any drone what to do. Each drone's brain sees only its own body, the anonymous nearby positions it senses and the messages delivered to it. There is no central controller during the show. The score and the roster are written beforehand and loaded onto every drone.

The same seed runs two worlds side by side. Both get the same score, physics and failures.

- **Encore:** every drone decides locally.
- **Static baseline:** every drone flies its preloaded score and sends nothing, like a conventional pre-programmed show.

You can:

1. **Watch the score.** The swarm forms text, then 3D shapes, on a shared clock.
2. **Break it.** Click a drone and remove the region around it, or kill 10% of the drones at random. In the Encore world, nearby survivors infer a vacancy when a slot they can see is empty and they hear no heartbeat holding it. They can be wrong, and then they yield. The winners move into more important slots and give up less important detail, so the image thins instead of keeping a hole. The static world keeps the hole until its next formation.
3. **Jam the radio, or split the swarm, and send a new composition to one drone.** `[IF G4]` The new score spreads along real radio messages as far as the radio allows, and no further. Drones that are cut off keep flying the score they have and catch up when the jam lifts. The static world can't adopt a new score at all.
   **FALLBACK:** "You can jam the radio, split the swarm and send a new composition to one drone; spreading it drone to drone is designed but not demonstrated in this build."
4. **Look inside.** An X-ray view draws the radio messages actually sent. A belief view colours each drone by the score version it believes.

Both worlds are measured by identical observers, which show:

- **priority-weighted coverage (nPWC):** how much of the image's important detail is filled, weighted by our own slot order;
- **plain coverage;**
- **shape error:** the distance from the target shape to the nearest drone;
- **messages, slot changes, collisions and near-misses.**

## How we built it

- **TypeScript end to end.** Vite builds it and Three.js draws the 3D view. Everything runs in the browser or in Node, with no backend and no network at runtime.
- **The world** steps every drone at 20 Hz. It owns the physics, idealised short-range sensing and a disc radio model with packet loss, latency, jamming spheres and fixed partitions. Collisions and near-misses are counted from true positions and have no physical effect.
- **Each drone's brain** is a function from its own inputs to an action. An import-boundary test fails CI if any brain file imports world code or uses `Math.random`, `Date` or `performance`. A differential test kills a drone beyond radio and sensing range and checks that a distant drone's inputs, outputs and state stay unchanged. It runs against the Encore brain, the static baseline and a probe brain.
- **Healing is a local priority claim, implemented and tested headless.** Three pre-registered tests on 40 drones with 20% packet loss pass on ten seeds. The clumped-kill result depends on where the kill lands:
  - In a sweep of all 40 kill centres × 5 seeds (at PR #103, before pacing and gossip), 183 of 200 runs met all five conditions. The other 17 finished their last repair 0.2–1.7 s after the 20 s window.
  - After pacing and gossip, 38 of 40 centres met them on seed 1.
  - At 200 drones, the evaluation run (5 seeds) is summarised under Accomplishments. Slots are ordered so that any prefix is an even thinning of the shape. A drone that senses an empty, more important slot nearby, and has heard nobody holding it, announces a claim in its heartbeat for one second. Among rival claimants, the drone whose own slot matters least wins, which moves holes outward and down in priority. When two drones hold the same slot, it is settled over the radio (the earlier holder keeps it) or by one drone yielding when it sees the slot taken. A drone that hears no radio never claims.
- **Scores spread by gossip.** This is implemented, and a three-drone relay test passes on the real world model: the middle drone passes a new score on to a drone the injected drone cannot reach. `[IF G4: It is also tested across jams and partitions.]` A drone rebroadcasts a new score when it adopts it, plus a rate-limited refresh when it hears a stale heartbeat. Versions are ordered by issue time.
- **A headless batch runner** replays fixed scenarios with explicit failure ids. It writes one JSON run record per scenario, arm and seed, and records replay to the same state hash. The scenarios are a null run, a random kill, a regional kill, a radio cut, a partition with failures, and an injection during a partition. We wrote down the thresholds and the win/tie/loss rule before any evaluation seed ran.
- **Built by a three-person team directing AI coding agents.** Claude Code and OpenAI Codex wrote most of the code and documents under our direction, one GitHub issue and pull request at a time. GitHub Copilot co-authored the initial scaffold. We reviewed every pull request and decided what to merge. Details are in the README's "AI use" section: https://github.com/durhacko/Pihh#ai-use

Encore invents no new algorithm. It combines known ideas (gossip, local failure suspicion, priority slot claims) into an inspectable drone-show simulation that you can break, and it compares measured recovery against a static pre-uploaded baseline.

## Challenges we ran into

- **Repair is local and greedy by design.** Only drones near a hole compete for it, so the loss spreads over the neighbourhood, not the whole formation. We expect priority-weighted coverage to stay below what a global reassignment would reach; we have not run that comparison. A wiped region with no survivor close enough to sense it is never noticed.
- **Nothing is repaired inside a jam.** A drone that hears no radio never claims a slot, because radio silence alone is not evidence that a neighbour died. So jammed drones that can see a hole leave it until the jam lifts. We chose fewer false repairs over faster repair.
- **Partitions are expected to cause churn.** By design, two drones that can't hear each other can both claim the same slot until they meet or reconnect. A group cut off during a formation change would treat the departed drones as dead and repair its old formation, then unwind on reconnection. `[RESULT: S5 slot changes and duplicate-slot seconds, and collisions, both arms (#123), or delete this sentence]`
- **Collisions in formation changes.** Our own batch runner found collisions even in the static baseline, which has no coordination at all. In one deterministic run of the no-event scenario, the static arm recorded about 60 collisions and 310 near-misses. They come from crossing traffic in the shared motion code during transitions ([#80](https://github.com/durhacko/Pihh/issues/80)). Pacing each drone's target along its path cut this to 14 collisions and 250 near-misses (200 drones; the run is identical for seeds 1–5; counts are lower bounds at a 20 Hz sample rate). Depth lanes and an earlier sidestep were measured and did not help. We report collisions for both worlds rather than hide them. In the evaluation run (200 drones, 5 seeds, medians), static vs Encore recorded 14 vs 14 collisions with no failures, 14 vs 17 after a random kill and 14 vs 16 after a regional kill. `[RESULT: S5 collisions, both arms (#123)]`
- **Keeping the comparison fair.** Both worlds share the seed, score, physics, steering and an identical list of failures with explicit drone ids. Only the brain differs.
- `[HUMAN: optional, one real moment from the night, in your own words]`

## Accomplishments that we're proud of

- **Locality is tested, not just claimed.** A test rejects any brain file that imports world code or reads randomness or the clock. A differential test checks that a distant failure leaves a drone's inputs unchanged, for the Encore brain and the static baseline.
- **Deterministic replay.** The same seed and events give the same state hash, so every number taken from a run record can be regenerated.
- **A pre-registered evaluation that keeps its ties and costs.** In simulation, with 200 drones and 5 paired seeds per scenario:
  - **Regional kill:** median final nPWC 0.997 for Encore vs 0.909 for static. Encore was ahead on all 5 seeds and behind on none.
  - **Regional kill, during the hold:** worst-case shape error 2.39 m vs 7.03 m.
  - **Regional kill, recovery:** Encore reached nPWC ≥ 0.95 in a median of 9.25 s, flight time included, on every seed; static never did.
  - **Random kill:** 0.997 vs 0.912, ahead on all 5.
  - **Null run and radio cut:** level on every seed.
  - **The other side of the ledger:** plain coverage ties at 0.900 in both kill scenarios, because the same drones die in both worlds. nPWC uses our own priority order. Encore spends 4 messages per drone per second, and 25–33 slot changes per run, where static spends none.
- `[IF G4]` **Score dissemination across a partition.** `[RESULT: S5 share of drones on the injected side that adopted by tick 600; no adoption on the far side before reconnection; median time to one version after reconnection (tVersion); and collisions, both arms (#123)]`
  **FALLBACK:** delete this item.
- `[HUMAN: optional, e.g. "three people, one night, N merged pull requests"]`

## What we learned

- **Split the loss in two.** Dead drones cost capacity under any algorithm. A better arrangement of the survivors can win back only the coordination loss on top of that. Planning to report the two separately keeps us from crediting the algorithm for what the failures decided.
- **Radio silence is not death.** We chose a rule that avoids false repairs (a drone that hears nothing never claims a slot), knowing it costs repair inside a jam. Writing that trade-off down early kept the demo honest.
- **Metrics can flatter you.** nPWC uses our own priority order, so we show plain coverage beside it, which can't favour Encore. We show shape error too, though our slot order makes any thinned prefix score well on worst-case shape error by construction.
- **Measure both sides the same way.** The collision count was a surprise, and we only saw it because the static baseline is measured exactly like Encore.
- `[HUMAN: optional, one thing about directing many AI agents in parallel through GitHub issues]`

## What's next

- Cut the remaining transition collisions (14 per no-event run after pacing (200 drones), [#80](https://github.com/durhacko/Pihh/issues/80)) further, for example by sidestepping on time to contact.
- Let a jammed drone repair holes it can see without hearing radio, and measure whether that causes more false repairs.
- Model drones that fail in place as obstacles, along with sensing noise and clock drift. All three are idealised now.
- Compare against an oracle global reassignment as an upper bound.
- `[IF only the 5-seed minimum ran]` Run the full matrix of 20 seeds per scenario.
- Real flight would first need a safety layer and a hardware-in-the-loop simulator. This is a proof of concept, not flight software.

## Built with

typescript, three.js, webgl, vite, vitest, eslint, typescript-eslint, tsx, node.js, python, github-actions, claude-code, openai-codex, github-copilot

**NOTE:** These are Devpost tags; enter them one by one. Exact library versions are in the README's "Built with" section.

## Links and media

- GitHub: https://github.com/durhacko/Pihh
- Video: `[HUMAN: link to the backup demo video, at most 2 minutes, if recorded]`
- Images: `[HUMAN: 3–5 screenshots from a rehearsed build, saved in assets/]`

**NOTE:** The repo must be public, or judges given access, before submitting ([checklist](SUBMISSION_CHECKLIST.md) H5).

## Prize tracks

**NOTE:** Tick these on the Devpost form. Entering several tracks is allowed ([BRIEF R6](../competition/BRIEF.md#4-submission-and-rules)).

- Neptune North. `[HUMAN: once the brief is captured at the venue, add one sentence on how Encore addresses it as worded. Until then, claim no fit; see BRIEF P7.]`
- `[HUMAN: any other track the team decides to enter]`
