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

## Fallbacks

| If this fails | Do this | Evidence boundary |
|---|---|---|
| Playback/controls misbehave | Reset to the rehearsed seed using tested UI or the console above; reload the production URL if necessary | No repair claim from an unrehearsed reset |
| Split is too slow | Reopen without `split=1`; show both arms' recorded results separately when available | Report the actual laptop observation, not fixture fps |
| Healing/dissemination is unproven | Show the working shared-world/failure path; explain the mechanism as design and follow the fallback ladder | No staged repair or invented communication result |
| WebGL or all live paths fail | Play a labelled offline backup only if it exists; otherwise show source and real headless evidence with limits | No video/screenshots supplied by this drafting increment |

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
