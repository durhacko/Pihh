# Demo plan

> **Draft pitch and rehearsal plan; not a rehearsed demo.** Owner: Haris ([issue #7](https://github.com/durhacko/Pihh/issues/7)). Drafting is authorized on #7; video and three-person rehearsal remain pending. Scripted beats live in [experience §9](../design/experience-and-demo.md#9-scripted-demo), implemented by #27. Check [current state](../CURRENT_STATE.md) and GitHub before presenting. Judging is in person; exact format and pitch length remain unverified ([BRIEF S6/J4](../competition/BRIEF.md#3-judging)).

## 60–90 second table pitch

Draft for roughly 90 seconds with action pauses; shorten the technical explanation for a 60-second slot. Timings are not rehearsed. Brackets are presenter directions, not spoken results.

1. **Hook — 10 s:** “What happens to a light show when some drones disappear? We are exploring whether nearby survivors can keep its important detail readable.”
2. **Composition — 15 s:** “Encore is a software simulation. Each drone sees nearby motion and received radio messages. A timed score composes their decisions into text and shapes. Score and roster are preloaded; there is no central controller during the show.”
3. **Demonstration — 30 s:** [Show only a verified path below.] “Both sides receive the same failures. Our repair rule asks nearby survivors to give up less important slots. Radio silence alone is not evidence of a vacancy. Cut-off drones keep flying their current score.” [The Encore arm flies the Encore brain and the other arm the static baseline. Check the **Brains** row in the Metrics popover (click the readout at the top right, or press **M**) before speaking, and describe only what the screen shows.]
4. **Technical depth — 20 s:** “Encore invents no new algorithm. It combines known ideas (gossip, local failure suspicion, priority slot claims) into an inspectable drone-show simulation that you can break, and it compares measured recovery against a static pre-uploaded baseline.”
5. **Learning — 15 s:** “We separate lost capacity from coordination loss and count collisions rather than promise safety. Results must come from paired run records, including ties and losses. We show only results actually measured.”

Beat 4 uses the [evidence register's positioning sentence](../context/evidence-and-assumptions.md#12-prior-art). It describes the approach, not a completed evaluation. Do not name prior-art systems without reading their primary sources. Composition is our interpretation of the reported theme; do not claim verified theme or sponsor fit.

Quote a numerical result only with its `RunRecord`, revision, seed count and limits. Test counts, renderer fixtures and design targets are not recovery measurements. If repair fails, follow the [honest fallback ladder](../planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1) and say so.

## Current run path and verification boundary

Source checked at `9f78902` (14 Nov 2026, after #107): the app builds two real worlds in lockstep. The **Encore arm flies the Encore brain**: it heals, gossips scores and sends radio. The other arm flies the static pre-programmed baseline. The **Brains** row of the Metrics popover shows the brain kind each world actually runs (`config.brain.kind`). Radio faults (Disrupt in the dock), injection (Compose), X-ray and belief colours (Lenses, or **X** and **C**) are wired through the one action controller. The scripted demo (**Show** in the dock, or **D**) is described below. This paragraph covers wiring only; recovery results still need their own run records.

`bash scripts/check.sh` passes on `main` after #120 (typecheck, lint, tests, build, internal links). Re-run it at the rehearsal build and record the result here. That is engineering verification, not a recovery result or rehearsal. **The browser steps below are a source-based candidate path, not independently rehearsed by this document's author.** Record a browser pass below before calling it known-good.

Prepare dependencies before going offline (Node 22.12+ and Python 3 required):

```bash
npm ci
bash scripts/check.sh
npm run build
npm run preview -- --host 127.0.0.1
```

On PowerShell use `npm.cmd` if execution policy blocks `npm`. Keep preview running; open Vite's printed loopback address with `?seed=101&split=1`. The local server is part of the app. Installation needs internet once; runtime needs no external services. This was checked on a fresh clone at `9f78902` (15 Nov, about 00:00) in WSL, by an agent session; the log is in [#8](https://github.com/durhacko/Pihh/issues/8#issuecomment-6886715532). With networking removed (a separate network namespace with only loopback), `npm run preview` served the page, `?seed=101&split=1` and its assets to `curl`. A scan of the bundle found no external URL it loads: the only two are a three.js source comment and the SVG namespace. No browser loaded the page offline. Still to do: the same in a real browser with Wi-Fi off on the presentation laptop.

1. Read the brain labels. Open Metrics (click the readout at the top right, or press **M**): its **Brains** row shows which brain each arm flies (Encore arm / static arm), read from the live worlds (`config.brain.kind`). Expect **Encore brain / static brain**. If it says otherwise, do not describe any difference as healing. The readout itself shows nPWC, alive, the score phase and fps; in split view it shows both arms (Encore / static).
2. Use camera presets **1**, **2**, **3**, or the Front, ¾ and Top buttons under Lenses › Camera; check orbit/zoom on the presentation laptop. Switch worlds with **Encore · Split · Static** in the dock (or **B**, which cycles Encore → Split → Static). Record actual fps during rehearsal (the readout's fps), not a target or fixture measurement.
3. For a development check, use the console below. It schedules identical explicit failure ids in both worlds; describe it as a failure-input check, not repair.

```js
window.encore.reset(101);
window.encore.setPlaying(false);
window.encore.alive(); // capture actual before counts
window.encore.killIds([0, 1, 2]);
window.encore.setPlaying(true);
```

After simulation advances, pause and read `window.encore.alive()` again. Both arms should have lost those three ids. Restart with `window.encore.reset(101)` and `window.encore.setPlaying(true)`. Stop preview with Ctrl+C.

4. G1 and G4 are met (#103, #21). In the app, the belief view is checked for both a jam and a partition (#132, merged as #136). The script is in the app (press D): rehearse the [canonical script](../design/experience-and-demo.md#9-scripted-demo). When you claim dissemination, state its cost in the same breath: in the partition scenario, Encore records a median of 103 collisions against 14 for static. That is not like-for-like: Encore flies the injected BRAVO change, while static flies its preloaded sphere change (RESULTS.md; #123). Kill during a hold. Jamming does not freeze flight; a drone leaving a geometric jam may adopt before jam-off. Fixed partition groups stay isolated wherever they fly.
5. Check reset/seed behavior, equal failure events, radio lines from real logs and the observer-backed readout and Metrics popover against a matching headless record. Run the script twice unattended before using it for judging. No such pass is recorded here.

Startup time, browser fps, offline pass and reset demonstration: **not measured/rehearsed here**. Needs: one laptop on mains power; external screen optional. No drone equipment or external runtime services.

## Known-good demo path

> **Scripted, not yet rehearsed by a person.** The 90-second script ([experience §9](../design/experience-and-demo.md#9-scripted-demo), #27) runs unattended and gives the same result each time in headless tests. It had two headless-browser runs before the #114 retiming and the Encore brain, and none since (see Verification below). No presenter rehearsal is recorded (see below).

**Run it.** Open the production preview, then press **Show** in the dock or **D**. The script resets both worlds to its own seed, sets 1×, turns X-ray, belief colours and tethers off, shows the Encore view, and plays, so neither the seed nor `?split=1` in the URL matters. Its captions appear above the dock. A line under each caption shows progress and any problem.
- **Stop:** press **D** (or **Show**) again. The script stops, and the show resets to seed 101 in the Encore view. The reset discards any event the script had already scheduled, up to 3 s ahead. The show keeps playing.
- **Run again:** there is no Restart button. Press **D** (or **Show**) to start from the beginning: once after the end, or twice while it runs (stop, then start).
- **Outside reset:** a reset or seed change from the dock, the keys or the console stops the script.
- **Wrong roster:** the script is written for 200 drones. Only `?n0=100` or `?n0=150` changes the roster; then the script refuses to start and says so in a toast. Reload without `?n0=`. Any other `?n0=` value is ignored and the app runs 200.
- **Problems:** a beat that failed, or went out late, is toasted once and stays in the caption's sub-line for the rest of the run.

**Frozen inputs.** These are defined in `src/app/ui/DemoScript.ts`. They assume the default roster, n0 = 200 (the script refuses any other), and the default preloaded score: ENCORE text, then sphere, then helix. `tests/app/demo.test.ts` checks the seed, the beat ticks, and the measured facts below.

| Input | Value |
|---|---|
| Seed | `101` |
| Regional kill | Sphere centre (-35, 30.4, 0), radius 6 m, over half of the first **E** during its hold. Resolved on the Encore world to 20 ids (10% of n0), all from the first E. The ids stay the same throughout the 3 s before the kill, when the script sends it. The same `KILL` goes into both arms at tick 400 |
| Jam | `JAM_ON` centre (0, 39, 0), radius 6 m, at tick 1220 (61 s); `JAM_OFF` at tick 1460 (73 s). With paced steering targets (#96) the sphere is formed from tick 1216: every live drone is within `rOcc` of its own target, in both arms. So the jam starts on the formed sphere and covers its top cap, reaching down to y = 33 on the axis: 18 of 180 live drones, measured with either brain |
| Injection | `INJECT_SCORE` with recipe helix into drone 151, at tick 1280 (64 s). Drone 151 holds one of the eight lowest sphere slots: at the injection it is at y ≈ 21.1, 18 m from the jam centre, in both arms. It flew in the last **E**, far from the kill |

**Differences from experience §9:**
- **Formation change:** it is the preloaded sphere at 48 s, because the default score has no helix before 93 s. The injected score is therefore a helix rather than a sphere.
- **Split view:** the split beat at 16 s switches the stage to split view (Encore above, static below), and the final beat at 82 s sets split view again, in case the presenter changed it. Starting or stopping the script returns to the Encore view.
- **Ghost slots:** the script has no ghost beat. Ghost slots exist in the app (**G**, or Lenses) and can be shown by hand.

**Beats** (sim seconds at 1×; 20 ticks per second):

The "Encore arm" column was measured headless on `9f78902`: seed 101, the script's own events, and the app's default brains (Encore brain in the Encore arm).

| t (s) | Tick | Action | Static baseline arm | Encore arm (`BRAIN_DEPENDENT_BEATS` captions), measured |
|---|---|---|---|---|
| 0 | 1 | Reset, Audience camera | Launch into ENCORE | Same |
| 12 | 240 | X-ray on | No radio lines: the static brain sends nothing | Sampled heartbeats |
| 16 | 320 | Switch to split view | Below | Above |
| 20 | 400 | Regional `KILL` | 20-drone hole in the first E; alive 180 / 200 | Same ids, same tick |
| 21–48 | 420 | Caption only | The hole stays; nPWC 0.931 | 8 survivors claim vacated slots by 30 s, so part of the hole refills; nPWC 0.931 → 0.972 by 48 s |
| 48 | 963 | Preloaded sphere movement | Re-forms as a sphere, formed from tick 1216 | Same |
| 61 | 1220 | `JAM_ON`; belief colours; select drone 151 | Jam sphere on the formed cap | The 18 drones inside are deaf by 64 s |
| 64 | 1280 | `INJECT_SCORE` (helix) into drone 151, selected again as the injection is sent at 61 s, so a presenter's click cannot change the target; 0.5× | Nothing changes; the static brain ignores injection | 162 of 180 drones adopt within 1 s; none of the 18 inside the jam do |
| 67 | 1340 | 1× (new movement starts) | Still a sphere | Adopters fly the helix; the cut-off cap keeps the sphere |
| 73 | 1460 | `JAM_OFF` | Jam sphere gone | All 180 hold the new score within 1 s and join the helix by the clock |
| 82 | 1640 | X-ray and belief colours off; Audience; split view | Final view; the readout shows nPWC for both arms | Helix above, sphere below |
| 90 | 1800 | End | "End of the 90-second demo" | |

The brain note in the caption's sub-line follows the brains the live worlds actually fly (their `config.brain.kind`, the same source as the Metrics popover's Brains row). It appears only when the Encore arm is not flying the Encore brain, so with the Encore brain in the app it no longer shows.

**Verification so far.**
- Headless, `tests/app/demo.test.ts`. These run over the same event path as the browser: the real controls binder, the demo talking to it by DOM events only, and status refreshed periodically.
  - Every world beat lands as a valid `EnvEvent` on its exact tick in both worlds.
  - Each caption appears on its own beat's tick, never early.
  - Two runs from the demo's own reset end with identical `stateHash` values, HUD samples and event logs, even when status arrives only every 7 ticks.
  - Stop, including inside the 3 s window before an event, restart and an outside reset work.
  - A failed or late beat is reported. The headless test reads it from the demo bar component; the shell toasts it and keeps it in the caption's sub-line, which #113 checked in a browser.
  - The jam starts on the formed sphere, and the injection target is low and outside the jam in both arms at the injection tick.
- Two headless Chromium runs of the #104 version of the script (old jam ticks, static brain in both arms), split view, 1440×900, software WebGL. These have not been repeated since the #114 retiming and the Encore brain:
  - the whole script ran with no page errors;
  - alive went from 200 to 180 in both arms at the kill;
  - each caption appeared on its beat;
  - the runs ended at tick ~1800 after 105–111 s real time, which includes the 0.5× section;
  - they rendered 8–16 fps on software WebGL. That says nothing about a laptop GPU: record real fps at rehearsal.
- The app shell (#113), headless Chrome at 1440×900 and 1280×720 with real input:
  - no clipping, overlap or dock overflow in 12 measured states, including the demo, split view, Metrics, Disrupt, the composer, the console and the timeline;
  - the n0 = 100 refusal, and the split beat with its return to the Encore view, checked in the browser.
  - Screenshots stayed local to that session and are not attached.

**Not yet verified:** a presenter rehearsal, a run on the presentation laptop, an offline run, and the shell below 1280×720.

## Fallbacks

| If this fails | Do this | Evidence boundary |
|---|---|---|
| Playback/controls misbehave | Reset to the rehearsed seed using tested UI or the console above; reload the production URL if necessary | No repair claim from an unrehearsed reset |
| A toast or the caption's sub-line says a step "went out at … s, so this run is off-script", or that a step "failed" | Press **D** twice (stop, then start) at 1× and keep the tab in front. Do not quote numbers from that run | Only a run with no such message is the canonical one |
| The scripted demo stops or misbehaves mid-run | Press **D** to stop; the show resets to seed 101. Then drive similar beats by hand with the keys and the dock (a sequence follows this table) | Hand-driven events land on different ticks and centre on the drone you select, not on the script's fixed points. The script kills and jams 6 m. **K** destroys every live drone within the Disrupt popover's **Region radius** (6 m by default, the same as the script) and **J** jams a sphere of its **Jam radius** (12 m by default). To match the script's jam, set **Jam radius** to 6 m before pressing **J**. Say so |
| Split is too slow | Press **Encore** in the dock, or **B** twice (split → static → Encore), to show one world; show both arms' recorded results separately when available. A running demo switches back to split at its 16 s beat, so stop it first (**D**) | Report the actual laptop observation, not fixture fps |
| Repair or spread does not show in this run | Say what the headless tests and the evaluation show (G1; G4 with the relay test and S5; [RESULTS](../../results/RESULTS.md)) and that this run did not show it; never stage it | Quote only the tests and results, with their limits and costs |
| WebGL or all live paths fail | Play a labelled offline backup only if it exists; otherwise show source and real headless evidence with limits | No video/screenshots supplied by this drafting increment |

**Hand-driven sequence** for the third fallback row (the scripted demo stops or misbehaves). In split view, click drones in the **Encore pane** (the top one). Picks are answered only there. K and J act around a drone selected in the Encore pane; with a drone selected in the static pane they refuse, with the toast "Faults are centred in the Encore world: select in the Encore pane."
1. Once the word holds, click a drone in the middle of the first E, then press **K**. With a live drone selected, K destroys the region around it (the **Region radius** slider under Disrupt, 6 m by default); otherwise it asks for a click on the centre.
2. After the sphere forms, click a drone at its top and press **J**. This jams the **Jam radius** around it (12 m by default; the script uses 6 m).
3. Press **F** (or **Compose** in the dock) and choose **Double helix**. Under Transmit, press **Pick in stage** and click a drone at the bottom, or type its id. Then press **Inject … into drone N**. The console does the same with `form helix` then `inject --pick`.
4. Press **J** again to lift the jam.

## Judging traceability

Criteria come from [BRIEF J1](../competition/BRIEF.md#3-judging). Expected observations are rehearsal targets, not results.

| Criterion / track | System feature | Expected observation | Evidence and current limit |
|---|---|---|---|
| Creativity / Innovation | Timed score plus local priority claims | Damage becomes thinner detail when repair succeeds | [Contracts §8](../design/contracts-and-algorithms.md#8-healing-local-claims-adr-007); G1 passed (#103, 40 drones). It depends on where the kill lands: 38 of 40 kill centres on seed 1, after pacing and gossip, in the committed test `tests/g1/g1.beyond.test.ts` (CI). Separately, 183 of 200 (40 centres × seeds 1–5, before pacing and gossip) come from an opt-in sweep (`G1_WIDE`) reported in a PR #103 comment; that is not a committed record. At 200 drones ([RESULTS](../../results/RESULTS.md), #122), Encore was ahead on end nPWC (our own priority labels) on 5 of 5 seeds in the random and regional kills. Plain coverage ties at 0.900. Encore costs 4 msgs/drone-s, a median of 25 and 33 slot changes and a few more collisions (17 and 16 vs 14). No new-algorithm claim |
| Polish / Completion | 3D view, reset, repeatable demo | Readable formations and reliable reset | [Visual acceptance](../design/experience-and-demo.md#11-visual-acceptance-criteria); browser rehearsal/video pending |
| Technical Competence / Execution | Isolated brains, radio, read-only observer | Logs and beliefs explain actual decisions | T01–T05/T14 in [evaluation](../validation/evaluation-and-tests.md#6-automated-tests); component tests do not establish complete UI wiring |
| Research / Learning | Paired baseline and loss split | Wins/ties/losses, censored recovery and collisions | [Evaluation procedure](../validation/evaluation-and-tests.md#5-procedure); [RESULTS](../../results/RESULTS.md) (#122): S0–S3 and S5 at 200 drones, 5 seeds; S5's collision cost in #123; S4 and 20 seeds not run |
| Reported theme: Composition | Parts form images; movements form a score | Theme interpretation explained from the system | [BRIEF T1](../competition/BRIEF.md#2-theme): wording/judging unverified |
| Neptune North | Brief not captured; feature mapping pending #1 | No sponsor-specific claim before brief capture | [BRIEF P7](../competition/BRIEF.md#5-prize-tracks), #1: track title/prize verified; fit/eligibility unverified |

## Anticipated questions

| Question | Answer (owner) |
|---|---|
| What is new? | A breakable, inspectable composition of known ideas, not a new algorithm or proof. Use the positioning sentence. Arnav owns algorithm explanation; Haris owns pitch wording. |
| Is one program secretly controlling everything? | One runtime simulates physics/radio. Brains get their own body, anonymous sensing and delivered messages, with preloaded score/roster and shared clock. Import/locality tests enforce separation. Logically autonomous agents in one simulation; nothing runs on drones. |
| What is idealised? | Exact anonymous sensing, shared clock and disc radio. No security model; killed drones disappear rather than hover as obstacles. See [assumptions](../context/evidence-and-assumptions.md#2-assumptions). |
| Does it detect death or repair any damage? | It infers a vacancy from empty sensing plus missing heartbeats; it can be wrong and yield. Repair is local and greedy, paused during transitions/deafness/version disagreement. A hole nobody senses may remain. Never say “always converges.” |
| Is it safe to fly? | No safety claim or flight software. Collisions/near-misses are counted from simulated true positions and cause no damage. Quote only the displayed run's recorded counts. |
| Is the baseline fair? | Same seed, score, physics, steering and explicit failures. Static keeps flying, sends nothing and ignores injection by definition. Non-adoption is a capability difference, not a recovery win. Each arm has its own valid reference score. |
| Does Encore win? | At 200 drones over 5 paired seeds ([RESULTS](../../results/RESULTS.md), #122), Encore was ahead on the random and regional kills on 5 of 5 seeds each (end nPWC about 0.997 vs 0.91) and level on the null run and the radio cut. There were no losses on that measure. Plain coverage ties at 0.900, and nPWC uses our own priority labels. Encore costs more radio messages, slot changes and a few collisions (17 and 16 vs 14). In the partition scenario (S5), every Encore drone adopted the new score, while static adopted none. Encore recorded a median of 103 collisions, against 14 for static, which flies a different formation change. About 80% came after the partition healed, and nearly all involved a drone that adopted late (one or both) (#123). Report ties and costs with the wins. Our geometric priority weighting is paired with coverage and label-independent shape distance. Arnav's sessions own the records (#26) and their interpretation. |
| What did you build versus libraries and AI? | Point to README “Built with” and “AI use” and the commits. Update disclosures before submission (#8); do not describe AI-generated work as unaided. |
| Does it meet the sponsor/theme brief? | It addresses them as reported to the team; wording/eligibility are unverified (#1). No confirmed sponsor-fit claim. |

## Rehearsal record — none completed

Issue #7 requires three full rehearsals by different people. Each real entry must identify build, seed, offline condition, duration, failure/reset behavior and follow-up issues. Agent tests are not presenter rehearsals.

| Presenter | Build / seed / date | Full run and reset evidence | Outcome |
|---|---|---|---|
| Haris | Not run | Not recorded | Pending |
| Arnav | Not run | Not recorded | Pending |
| Williams | Not run | Not recorded | Pending |

## Backup video record — no recording available

- Recorder: [`scripts/demo/README.md`](../../scripts/demo/README.md) records the scripted demo automatically in headless Chrome, as a fallback for the human backup video (#131, #148). It refuses to record on software WebGL unless given `--allow-software`, so record on a laptop GPU. No recording from it is listed here yet, and its output still needs the offline playback checks below.
- Recording build/tag, seed, duration and file path: **not recorded**.
- Offline copy played on laptop 1 / laptop 2: **neither verified**.
- Source run records for numerical claims/captions: **not attached**.
- Next: record at most two minutes from a working rehearsed build, play the actual file offline on two laptops, then add path/build/seed/duration and verification details here. Keep #7 open until video and three rehearsals exist. Timing remains in the [plan](../planning/development-plan.md#gates-and-times-gmt) and [submission checklist](SUBMISSION_CHECKLIST.md).
