# Encore: live pitch and judge questions

Use this with the scripted show in [`DemoScript.ts`](../../src/app/ui/DemoScript.ts).
- All times are **simulation-clock** times at seed 101 with 200 simulated drones. They are not promises about wall-clock playback.
- The script plays at 0.5× from the injection (64 s) until the new movement starts (67 s); leave room for that in a live pitch.
- Read the actual caption and observer values before quoting a number.
- If a beat reports a failure, describe the failure instead of reading the planned line.

## Spoken walk-through

| Sim time | On screen | Say |
|---|---|---|
| 0–12 s | Launch: the preloaded ENCORE formation | “This is Encore: 200 simulated drones, each with its own brain. They share a score and a clock, but each one decides from what it senses nearby and the messages delivered to it.” |
| 12–20 s | X-ray on at 12 s; split view at 16 s (static baseline below) | “X-ray shows logged radio heartbeats, sampled. Below, the static brain follows the same physics and failures without radio.” |
| 20–48 s | The same regional kill in both arms at 20 s; at 23 s X-ray turns off so the hole and its refill show; from 48 s the shared clock moves both arms towards a sphere | “We remove the same part of a letter in both worlds. Nearby Encore drones claim the important empty slots; the static hole remains. Then the shared clock moves both towards a sphere, with no message needed.” |
| 48–64 s | The sphere forms; at 61 s a jam over its top cap, with X-ray and belief colours back on | “This cap is jammed. Drones inside keep flying but cannot exchange messages across it. Their belief colours show what each one knows.” |
| 64–73 s | 64 s: a helix score injected into one drone below the jam (0.5× playback); 67 s: the new movement starts (1×) | “We inject a helix score into one drone below the jam. Real SCORE messages spread it to the connected drones; cut-off drones keep the old score. Static cannot adopt it.” |
| 73–82 s | Jam off at 73 s; the versions reunite | “Jam off: the new version reaches the separated drones, and they join the new formation by the clock. These colours come from each drone’s recorded belief.” |
| 82–90 s | Split audience view, X-ray off; the readout shows nPWC for both arms | “The readout measures both arms. Encore repairs some gaps and relays scores, but it also sends more messages and can pay a collision cost.” |

The beat times, seed, roster, regional kill, jam and injection above come from the [demo script](../../src/app/ui/DemoScript.ts). The information boundary between the world and the brains is specified in the [contracts](../design/contracts-and-algorithms.md). The show is software only, under [NFR-10](../specification/requirements.md).

## Three-minute judge Q&A

Use the questions that are asked. The time boxes total three minutes if all are needed. Keep the live observer readout visible for questions about this particular run.

| Time | Likely question | Answer |
|---|---|---|
| 0:00–0:30 | Is there really no conductor? | “One program simulates the world and the radio. It schedules environment events and advances time. The Encore decision function receives only its own body, anonymous nearby sensing and the messages delivered to it, and it cannot import world or observer code. Each drone starts with the score and the roster, so this is logical autonomy inside a simulation, not physically distributed hardware.” See [contracts §4](../design/contracts-and-algorithms.md) and the [boundary tests](../../tests/boundaries.test.ts). |
| 0:30–1:00 | What is the measured advantage? | “In the five-seed, 200-drone minimum matrix, the regional kill S2 ended at a median priority-weighted coverage of 0.997 for Encore against 0.909 for static. Encore’s median recovery time was 9.25 seconds, including flight. Plain coverage was 0.900 for both: no drone was replaced. The priority weights are ours, so read that win beside the shape metrics.” The figures are from [RESULTS.md, S2](../../results/RESULTS.md). |
| 1:00–1:30 | Does repair always work? | “No. It is local and greedy: an unsensed hole can remain, and a deaf drone will not claim. In a sweep of a clumped kill of 5 drones over every kill centre, at 40 drones, 20% radio loss and seed 1, 38 of the 40 centres met all five conditions. The other two missed the ‘quiet for the last ten seconds’ condition by a small margin. That sweep goes beyond the G1 gate, and we keep the miss visible.” Source: `tests/g1/g1.beyond.test.ts` at commit 571c8e4, quoted in the [RESULTS.md notes](../../results/RESULTS.md); the rule is in [contracts §8](../design/contracts-and-algorithms.md). |
| 1:30–2:00 | What does the new-score demo prove? | “The operator injects one version into one drone; after that, adoption follows delivered SCORE messages. A jam blocks that route until it lifts. Static deliberately ignores injection, so its non-adoption is a capability difference, not an nPWC win. In the separate S5 partition test, all 200 Encore drones eventually adopted, and one version remained a median of 0.4 seconds after reconnection, across five seeds. The same S5 run had a median of 103 Encore collisions against 14 for static, and 809 near-misses against 250; that comparison is not like-for-like, because the two arms fly different formation changes.” See [RESULTS.md, S5 and its notes](../../results/RESULTS.md), [issue #123](https://github.com/durhacko/Pihh/issues/123) and the [score contract](../design/contracts-and-algorithms.md). |
| 2:00–2:30 | What did Encore lose? | “The S5 partition run found a serious motion cost: a median of 103 Encore collisions against 14 for static, and 809 near-misses against 250, across five seeds. That comparison is not like-for-like: static flies a different formation change, its preloaded one, while Encore’s drones fly the injected one. The cause is that late adopters steered towards a point already far along the new movement. The S5 final shape metrics are not a like-for-like comparison either.” Figures and caveats: [RESULTS.md, S5 and its notes](../../results/RESULTS.md); diagnosis: [issue #123](https://github.com/durhacko/Pihh/issues/123). |
| 2:30–3:00 | Is it safe, and what did the team build? | “We make no flight-safety claim: the sensing and radio are idealised, and counted contacts do not damage simulated drones. It runs offline with no hardware or external service. We combined established ideas into a testable show and directed AI coding agents through issues and pull requests; the README discloses the tools and libraries. Safety engineering and hardware-in-the-loop work would be needed before real flight.” See the [assumptions](../context/evidence-and-assumptions.md), [NFR-10](../specification/requirements.md) and [README AI use](../../README.md). |

## Presenter checks

- Start the real scripted demo with **D** (or the dock’s Show button), and confirm the seed, roster and caption. Pressing **D** again stops it. The [demo script](../../src/app/ui/DemoScript.ts) uses seed 101 and 200 simulated drones, and it reports late or failed beats.
- The [five-seed results](../../results/RESULTS.md) are headless measurements, not measurements of the live seed-101 show. Quote the live readout only for the live run, and label the matrix numbers as five-seed results.
- Keep the S5 collision cost, with its not-like-for-like caveat, beside any S5 adoption claim. The jam in this pitch and the partition in S5 are different scenarios. Counted collisions and near-misses are lower bounds, because contacts are sampled at 20 Hz.
- The reported “Composition” theme wording and the sponsor briefs still need venue confirmation in the [competition brief](../competition/BRIEF.md); make no claim of fitting a sponsor brief.
