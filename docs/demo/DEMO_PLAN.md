# Demo plan

> **Draft pitch and rehearsal plan; not a rehearsed demo.** Owner: Haris ([issue #7](https://github.com/durhacko/Pihh/issues/7)). Drafting is authorized on #7; video and three-person rehearsal remain pending. Scripted beats live in [experience §9](../design/experience-and-demo.md#9-scripted-demo), implemented by #27. Check [current state](../CURRENT_STATE.md) and GitHub before presenting. Judging is in person; exact format and pitch length remain unverified ([BRIEF S6/J4](../competition/BRIEF.md#3-judging)).

## 60–90 second table pitch

Draft for roughly 90 seconds with action pauses; shorten the technical explanation for a 60-second slot. Timings are not rehearsed. Brackets are presenter directions, not spoken results.

1. **Hook — 10 s:** “What happens to a light show when some drones disappear? We are exploring whether nearby survivors can keep its important detail readable.”
2. **Composition — 15 s:** “Encore is a software simulation. Each drone sees nearby motion and received radio messages. A timed score composes their decisions into text and shapes. Score and roster are preloaded; there is no central controller during the show.”
3. **Demonstration — 30 s:** [Show only a verified path below.] “Both sides receive the same failures. Our repair rule asks nearby survivors to give up less important slots. Radio silence alone is not evidence of a vacancy. Cut-off drones keep flying their current score.” [If both arms still use static brains: “This build shows shared simulation and failure input. Repair and score dissemination are not demonstrated here.”]
4. **Technical depth — 20 s:** “Encore invents no new algorithm. It combines known ideas (gossip, local failure suspicion, priority slot claims) into an inspectable drone-show simulation that you can break, and it compares measured recovery against a static pre-uploaded baseline.”
5. **Learning — 15 s:** “We separate lost capacity from coordination loss and count collisions rather than promise safety. Results must come from paired run records, including ties and losses. We show only results actually measured.”

Beat 4 uses the [evidence register's positioning sentence](../context/evidence-and-assumptions.md#12-prior-art). It describes the approach, not a completed evaluation. Do not name prior-art systems without reading their primary sources. Composition is our interpretation of the reported theme; do not claim verified theme or sponsor fit.

Quote a numerical result only with its `RunRecord`, revision, seed count and limits. Test counts, renderer fixtures and design targets are not recovery measurements. If repair fails, follow the [honest fallback ladder](../planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1) and say so.

## Current run path and verification boundary

Source checked at `5bc311d` (14 Nov 2026): the app constructs two real worlds but **both run the static baseline** until the Encore brain is integrated. The controls binder exists; the bootstrap disables radio-fault/injection capability and supplies no display callbacks. Observer, X-ray and control components being on main does not establish complete UI wiring. The scripted demo key, sample-driven comparison HUD and interactive inspector are not asserted available here.

The full headless pipeline at this revision passed 316 tests, typecheck, lint, build and internal links in #71/PR #73. That is engineering verification, not a recovery result or rehearsal. **The browser steps below are a source-based candidate path, not independently rehearsed by this document's author.** Record a browser pass below before calling it known-good.

Prepare dependencies before going offline (Node 22.12+ and Python 3 required):

```bash
npm ci
bash scripts/check.sh
npm run build
npm run preview -- --host 127.0.0.1
```

On PowerShell use `npm.cmd` if execution policy blocks `npm`. Keep preview running; open Vite's printed loopback address with `?seed=101&split=1`. The local server is part of the app. Installation needs internet once; runtime needs no external services. A production browser check with networking off is pending.

1. Read the brain-status badge. At this revision it must disclose **STATIC BRAIN IN BOTH ARMS**. Show both moving views and actual alive counts; do not describe a difference as healing.
2. Use camera presets `1`, `2`, `3` or their buttons; check orbit/zoom on the presentation laptop. Record actual fps during rehearsal, not a target or fixture measurement.
3. For a development check, use the console below. It schedules identical explicit failure ids in both worlds; describe it as a failure-input check, not repair.

```js
window.encore.reset(101);
window.encore.setPlaying(false);
window.encore.alive(); // capture actual before counts
window.encore.killIds([0, 1, 2]);
window.encore.setPlaying(true);
```

After simulation advances, pause and read `window.encore.alive()` again. Both arms should have lost those three ids. Restart with `window.encore.reset(101)` and `window.encore.setPlaying(true)`. Stop preview with Ctrl+C.

4. Once G1/G4 evidence and UI integration exist, rehearse the [canonical script](../design/experience-and-demo.md#9-scripted-demo). Kill during a hold. Jamming does not freeze flight; a drone leaving a geometric jam may adopt before jam-off. Fixed partition groups stay isolated wherever they fly.
5. Check reset/seed behavior, equal failure events, radio lines from real logs and observer-backed HUD against a matching headless record. Run the script twice unattended before using it for judging. No such pass is recorded here.

Startup time, browser fps, offline pass and reset demonstration: **not measured/rehearsed here**. Needs: one laptop on mains power; external screen optional. No drone equipment or external runtime services.

## Known-good demo path

> **Scripted, not yet rehearsed by a person.** The 90-second script ([experience §9](../design/experience-and-demo.md#9-scripted-demo), #27) runs unattended and gives the same result each time in headless tests. It has had one headless-browser run. No presenter rehearsal is recorded (see below).

**Run it.** Open the production preview with `?split=1`, then press **D** or **Run demo** in the bar at the bottom. The script resets both worlds to its own seed, sets 1×, turns X-ray and belief colours off, and plays, so the seed in the URL does not matter.
- **Stop:** press **D** again. The script stops and the show resets to seed 101. The reset discards any event the script had already scheduled, up to 3 s ahead. The show keeps playing.
- **Restart:** resets and runs the script from the start.
- **Outside reset:** a reset or seed change from the control panel, the keys or the console stops the script.

**Frozen inputs.** These are defined in `src/app/ui/DemoScript.ts`. They assume the default roster, n0 = 200, and the default preloaded score: ENCORE text, then sphere, then helix. `tests/app/demo.test.ts` checks the seed, the beat ticks, and the measured facts below.

| Input | Value |
|---|---|
| Seed | `101` |
| Regional kill | Sphere centre (-35, 30.4, 0), radius 6 m, over half of the first **E** during its hold. Resolved on the Encore world to 20 ids (10% of n0), all from the first E. The ids stay the same throughout the 3 s before the kill, when the script sends it. The same `KILL` goes into both arms at tick 400 |
| Jam | `JAM_ON` centre (0, 39, 0), radius 6 m, at tick 1080; `JAM_OFF` at tick 1360. It covers the top cap of the sphere, reaching down to y = 33 on the axis: 18 of 180 live drones with today's static brain |
| Injection | `INJECT_SCORE` with recipe helix into drone 151, at tick 1160. Drone 151 holds one of the eight lowest sphere slots (y ≈ 21), well below the jam. It flew in the last **E**, far from the kill |

**Differences from experience §9:**
- **Formation change:** it is the preloaded sphere at 48 s, because the default score has no helix before 93 s. The injected score is therefore a helix rather than a sphere.
- **Split view:** it is a page option (`?split=1`). The script cannot toggle it, so the split beat is a caption only.
- **Ghost slots:** they are not wired in this build, so there is no ghost beat.

**Beats** (sim seconds at 1×; 20 ticks per second):

| t (s) | Tick | Action | What the screen shows today | Encore brain only (`BRAIN_DEPENDENT_BEATS`) |
|---|---|---|---|---|
| 0 | 1 | Reset, Audience camera | Launch into ENCORE | |
| 12 | 240 | X-ray on | Dimmed drones; no radio lines, because the static brain sends nothing | Sampled heartbeats |
| 16 | 320 | Caption only (split is a URL option) | Static arm below | |
| 20 | 400 | Regional `KILL` | Same 20-drone hole in the first E in both arms; alive 180 / 200 | |
| 21–48 | 420 | Caption only | Hole stays in both arms | Hole refills from its rim above |
| 48 | 963 | Preloaded sphere movement | Both arms re-form as a sphere | |
| 54 | 1080 | `JAM_ON`; belief colours; select drone 151 | Jam sphere on the cap; one belief colour | Deaf rings inside the jam |
| 58 | 1160 | `INJECT_SCORE` (helix) into drone 151, which is selected again as the injection is sent (at 55 s), so a click since 54 s cannot change the target; 0.5× | Nothing changes; the static brain ignores injection | New colour spreads along `SCORE` lines; the jam stops it at the cap |
| 61 | 1220 | 1× | Still a sphere | Adopters fly the helix; cut-off drones keep the sphere |
| 68 | 1360 | `JAM_OFF` | Jam sphere gone | The new score crosses; late adopters join |
| 82 | 1640 | X-ray and belief colours off; Audience | Final view and HUD | |
| 90 | 1800 | End | "End of the 90-second demo" | |

The amber note follows the brains the live worlds actually fly (their `config.brain.kind`, the same source as the HUD's brain labels). While the Encore arm flies the static brain, every Encore-only caption carries the note "Static brain in both arms: no difference shows yet." Once the Encore brain is in the app (#107), the note goes away by itself, and those beats are the ones to re-check on screen.

**Verification so far.**
- Headless, `tests/app/demo.test.ts`. These run over the same event path as the browser: the real controls binder, the demo talking to it by DOM events only, and status refreshed periodically.
  - Every world beat lands as a valid `EnvEvent` on its exact tick in both worlds.
  - Each caption appears on its own beat's tick, never early.
  - Two runs from the demo's own reset end with identical `stateHash` values, HUD samples and event logs, even when status arrives only every 7 ticks.
  - Stop, including inside the 3 s window before an event, restart and an outside reset work.
  - A failed or late beat is reported in the bar.
- Two headless Chromium runs of this code, split view, 1440×900, software WebGL, the second after rebasing on `ac46156`:
  - the whole script ran with no page errors;
  - alive went from 200 to 180 in both arms at the kill;
  - the jam was active from tick 1080 to 1360;
  - each caption, and the static-brain note, appeared on its beat;
  - the runs ended at tick ~1800 after 105–111 s real time, which includes the 0.5× section;
  - it rendered 8–16 fps on software WebGL. That says nothing about a laptop GPU: record real fps at rehearsal.
- Layout measured at 1440×900, 1280×800 and 1000×760: the bar does not overlap the HUD, the control panel, the camera buttons, the help text or the fps readout.

**Not yet verified:** a presenter rehearsal, a run on the presentation laptop, and an offline run. The bar is laid out for windows 1280 px wide or more. From 861 to 1279 px it narrows and clips captions to two lines. Below 860 px it is hidden, but **D** still runs the script.

## Fallbacks

| If this fails | Do this | Evidence boundary |
|---|---|---|
| Playback/controls misbehave | Reset to the rehearsed seed using tested UI or the console above; reload the production URL if necessary | No repair claim from an unrehearsed reset |
| The demo bar says a step "went out at … s, so this run is off-script", or that a step "failed" | Press **Restart** at 1× and keep the tab in front. Do not quote numbers from that run | Only a run with no such message is the canonical one |
| The scripted demo stops or misbehaves mid-run | Press **D** to stop; the show resets to seed 101. Then drive similar beats by hand from the control panel (a sequence follows this table) | Hand-driven events land on different ticks and use the controls' default radii (kill 6 m, jam 15 m), not the script's; say so |
| Split is too slow | Reopen without `split=1`; show both arms' recorded results separately when available | Report the actual laptop observation, not fixture fps |
| Healing/dissemination is unproven | Show the working shared-world/failure path; explain the mechanism as design and follow the fallback ladder | No staged repair or invented communication result |
| WebGL or all live paths fail | Play a labelled offline backup only if it exists; otherwise show source and real headless evidence with limits | No video/screenshots supplied by this drafting increment |

**Hand-driven sequence** for the second fallback row:
1. Once the word holds, click a drone in the middle of the first E, then press **K**.
2. After the sphere forms, click a drone at its top and press **J**.
3. Choose "Double helix" under New composition, click a drone at the bottom, and press **I**.
4. Press **J** again to lift the jam.

## Judging traceability

Criteria come from [BRIEF J1](../competition/BRIEF.md#3-judging). Expected observations are rehearsal targets, not results.

| Criterion / track | System feature | Expected observation | Evidence and current limit |
|---|---|---|---|
| Creativity / Innovation | Timed score plus local priority claims | Damage becomes thinner detail when repair succeeds | [Contracts §8](../design/contracts-and-algorithms.md#8-healing-local-claims-adr-007); G1/#17 required; no new-algorithm claim |
| Polish / Completion | 3D view, reset, repeatable demo | Readable formations and reliable reset | [Visual acceptance](../design/experience-and-demo.md#11-visual-acceptance-criteria); browser rehearsal/video pending |
| Technical Competence / Execution | Isolated brains, radio, read-only observer | Logs and beliefs explain actual decisions | T01–T05/T14 in [evaluation](../validation/evaluation-and-tests.md#6-automated-tests); component tests do not establish complete UI wiring |
| Research / Learning | Paired baseline and loss split | Wins/ties/losses, censored recovery and collisions | [Evaluation procedure](../validation/evaluation-and-tests.md#5-procedure); #26 records/table pending, no outcome quoted |
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
| Does Encore win? | Results pending. Paired scenarios include null runs, random/regional kills, cuts and injection. Report ties/losses. Our geometric priority weighting is paired with coverage and label-independent shape distance. Williams owns records; Arnav owns interpretation. |
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

- Recording build/tag, seed, duration and file path: **not recorded**.
- Offline copy played on laptop 1 / laptop 2: **neither verified**.
- Source run records for numerical claims/captions: **not attached**.
- Next: record at most two minutes from a working rehearsed build, play the actual file offline on two laptops, then add path/build/seed/duration and verification details here. Keep #7 open until video and three rehearsals exist. Timing remains in the [plan](../planning/development-plan.md#gates-and-times-gmt) and [submission checklist](SUBMISSION_CHECKLIST.md).
