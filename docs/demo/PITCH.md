# Encore: live pitch and judge questions

Use with the scripted show in [`DemoScript.ts`](../../src/app/ui/DemoScript.ts). These are **simulation-clock** times at seed 101 and 200 simulated drones, not promises about wall-clock playback. The script briefly sets playback to 0.5× after the injection; leave room for that in a live pitch. Read the actual caption and observer values before quoting a number. If a beat reports a failure, describe the failure instead of reading the planned line.

## Spoken walk-through

| Sim time | On screen | Say |
|---|---|---|
| 0–12 s | Launch: the preloaded ENCORE formation | “This is Encore: 200 simulated drones, each with its own brain. They share a score and clock, but each decides from nearby sensing and delivered messages.” |
| 12–20 s | X-ray, then split view | “X-ray shows logged radio messages. Below, the static brain follows the same physics and failures without radio.” |
| 20–49 s | The same regional kill in both arms; local repair; sphere movement | “We remove the same part of a letter in both worlds. Nearby Encore drones claim important empty slots; the static hole remains. Then the shared clock moves both toward a sphere.” |
| 49–64 s | Sphere, then jam over its top | “This cap is jammed. Drones inside keep flying but cannot exchange messages across it. Their belief colours show what each knows.” |
| 64–73 s | Inject a helix score into one drone; score moves through radio; movement begins | “We inject a helix score into one drone below the jam. Real SCORE messages spread it to connected drones; cut-off drones keep the old score. Static cannot adopt it.” |
| 73–82 s | Jam lifts; versions reunite | “Jam off: the version reaches the separated drones and they join the new formation. These colours come from each drone’s recorded belief.” |
| 82–90 s | Audience view and measured readout | “The readout measures both arms. Encore repairs some gaps and relays scores, but it also sends more messages and can pay a collision cost.” |

The beat times, seed, roster, region kill, jam and injection above come from the [demo script](../../src/app/ui/DemoScript.ts). The world and brain information boundary is specified in the [contracts](../design/contracts-and-algorithms.md). The show is software only under [NFR-10](../specification/requirements.md).

## Three-minute judge Q&A

Use the questions that are asked; the time boxes total three minutes if all are needed. Keep the live observer readout visible for questions about this particular run.

| Time | Likely question | Answer |
|---|---|---|
| 0:00–0:30 | Is there really no conductor? | “One program simulates the world and the radio. It schedules environment events and advances time. The Encore decision function receives only its own body, anonymous nearby sensing and messages delivered to it. It cannot import world or observer code. Each drone starts with the score and roster, so this is logical autonomy inside a simulation, not physical distributed hardware.” See [contracts §4](../design/contracts-and-algorithms.md) and [boundary tests](../../tests/boundaries.test.ts). |
| 0:30–1:00 | What is the measured advantage? | “In the five-seed, 200-drone minimum matrix, the regional kill S2 ended at median priority-weighted coverage 0.997 for Encore versus 0.909 for static; Encore’s median recovery time was 9.25 seconds, including flight. Plain coverage was 0.900 for both: no drone was replaced. The priority weights are ours, so read that win beside the shape metrics.” These figures are from [RESULTS.md, S2](../../results/RESULTS.md). |
| 1:00–1:30 | Does repair always work? | “No. It is local and greedy: an unsensed hole can remain, and a deaf drone will not claim. In the broader seed-1 sweep, 38 of 40 kill centres met all five conditions; two missed the quiet-last-ten-seconds condition by a small margin. That is outside the narrower G1 gate, and we keep the miss visible.” The [G1 sweep](../../results/RESULTS.md) records the 38-of-40 result; the rule is in [contracts §8](../design/contracts-and-algorithms.md). |
| 1:30–2:00 | What does the new-score demo prove? | “The operator injects one version into one drone; later adoption follows delivered SCORE messages. A jam blocks that route until it lifts. Static deliberately ignores injection, so its non-adoption is a capability difference, not an nPWC win. In the separate S5 partition test, all 200 Encore drones eventually adopted, with a median version-convergence time of 0.4 seconds after reconnection across five seeds.” See [RESULTS.md, S5](../../results/RESULTS.md) and the [score contract](../design/contracts-and-algorithms.md). |
| 2:00–2:30 | What did Encore lose? | “The S5 partition run found a serious motion cost: median 103 Encore collisions versus 14 static collisions, and 809 versus 250 near-misses, across five seeds. Late adopters steered toward a point already far along the new movement. The separate S5 arms also fly different formations, so their final shape metrics are not a like-for-like win.” Figures and caveat: [RESULTS.md, S5](../../results/RESULTS.md); diagnosis: [issue #123](https://github.com/durhacko/Pihh/issues/123). |
| 2:30–3:00 | Is it safe, and what did the team build? | “No flight-safety claim: this has idealised sensing and radio, and counted contacts do not damage simulated drones. It runs offline with no hardware or external service. We combined established ideas into a testable show and directed AI coding agents through issues and pull requests; the README discloses the tools and libraries. We would need safety engineering and hardware-in-the-loop work before real flight.” See [assumptions](../context/evidence-and-assumptions.md), [NFR-10](../specification/requirements.md) and [README AI use](../../README.md). |

## Presenter checks

- Start the real scripted demo with **D** and confirm the seed, roster and caption. The [demo script](../../src/app/ui/DemoScript.ts) uses seed 101 and 200 simulated drones; it reports late or failed beats.
- The [five-seed results](../../results/RESULTS.md) are headless measurements, not measurements of the live seed-101 show. Quote the live readout only for the live run, and label the matrix numbers as five-seed results.
- Keep the S5 collision cost beside any S5 adoption claim. The jam in this pitch and the partition in S5 are different scenarios.
- The reported “Composition” theme wording and sponsor briefs still need venue confirmation in the [competition brief](../competition/BRIEF.md); make no sponsor-fit claim.
