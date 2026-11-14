# Evidence and assumptions

Purpose: the register of what we know, what we assume and what is still open, so every claim in the pitch, README and Devpost text has a traceable status. Status: **current at Sat 14 Nov ~19:00 GMT; no simulation result exists yet.** Owner: Product / Research role (assumption changes are reviewed by the Architect / Integrator).

- IDs: `EV-` evidence, `AS-` assumptions, `OQ-` open questions. The original research packet was never received ([research-handoff.md](research-handoff.md)), so its numbering is not used.
- Status: **verified** = primary source read · **partly verified** = abstract, search or news summary only · **unverified** = team-reported, from memory, or not yet run.
- The "How we word it" column in §2 is binding for the pitch, README, Devpost and in-app text.

## 1. Evidence

### 1.1 Event facts

Details and URLs are in [BRIEF](../competition/BRIEF.md); the IDs in the source column are its row IDs.

| ID | Claim | Source | Status | Impact |
|---|---|---|---|---|
| EV-01 | Submission closes Sun 15 Nov 11:00 GMT on Devpost | BRIEF S3 | verified | Fixes every gate time; submit target 10:15 |
| EV-02 | Judged on creativity, polish, technical competence, research/learning | BRIEF J1 | verified | Pitch must hit all four; §1.2 serves "research" |
| EV-03 | README must list libraries; AI use must be credited; no pre-event work; GitHub link preferred | BRIEF R2–R5 | verified | Both README sections are MUST; make the repo public before submitting |
| EV-04 | No loan hardware is confirmed | BRIEF H2 | unverified | Simulation only |
| EV-05 | Judging time, format and pitch length | BRIEF S6, J4 | unverified | Plan a 60–90 s table pitch and a demo a judge can operate |
| EV-06 | Theme is "Composition" | team-reported (BRIEF T1) | unverified | Use the word; build nothing only for the theme |
| EV-07 | A Neptune North prize track exists | BRIEF P7 | verified (title and prize only) | Primary target track |
| EV-08 | The Neptune North brief asks for decentralised coordination, independent decision-making and resilience to interrupted communication | team-reported ([selection decision](../ideation/SELECTION_DECISION.md)) | unverified | The concept was chosen on this. Say "addresses the brief as we understood it" |

### 1.2 Prior art

Source for all rows: agent desk research 14 Nov, from the pages linked. Read the primary source before naming any of these in the pitch (SHOULD).

| ID | Claim | Source | Status | How Encore differs |
|---|---|---|---|---|
| EV-09 | Skybrush: each drone flies a precomputed trajectory from a show file; the ground station does setup and abort, not real-time control | https://docs.skybrush.io/public/faq/latest/overview.html | verified (docs) | This is the model for our static baseline, not a competitor |
| EV-10 | Commercial shows (Intel, Verity) are centrally pre-planned; failures are handled by spares or abort | agent recollection, no source | unverified | Do not cite specifics |
| EV-11 | CBBA (Choi, Brunet, How, IEEE T-RO 2009): decentralised auction plus consensus with a convergence proof | https://dspace.mit.edu/handle/1721.1/52330 | verified (abstract) | We use a far simpler least-important-bidder claim, with no proof and no optimality bound |
| EV-12 | SwarMer / Flying Light Specks: decentralised relative localisation; failures covered by dark standby drones | https://arxiv.org/abs/2312.04571v1 | partly verified (search summaries) | We have no spares; survivors give up low-priority slots |
| EV-13 | DASH / S-DASH (Rubenstein and Shen, 2008–2010): identical controller on every robot; a damaged shape re-forms at a smaller scale | https://users.cs.northwestern.edu/~mrubenst/ICRA08.pdf · https://users.cs.northwestern.edu/~mrubenst/IROS10.pdf | partly verified (search summaries) | Closest concept. We keep the scale and thin the density, and add a timed score and radio faults |
| EV-14 | Mean-shift shape assembly (Sun et al., Nature Communications 2023): distributed assembly and repair of one shape | DOI 10.1038/s41467-023-39251-5 | partly verified (news summary) | Ours is a multi-formation timed score with persistent priority indices |

**Positioning sentence (MUST, used as written):** "Encore invents no new algorithm. It combines known ideas (gossip, local failure suspicion, priority slot claims) into an inspectable drone-show simulation that you can break, and it compares measured recovery against a static pre-uploaded baseline."

### 1.3 Our own results

| ID | Claim | Source | Status | Impact |
|---|---|---|---|---|
| EV-15 | Local-claim healing settles, and on a regional kill ends with higher nPWC than the static baseline | none: nothing has been run | unverified | Tested first at gate G1, reported at G5 ([evaluation](../validation/evaluation-and-tests.md)). Every `Params` default is a design value until then |
| EV-16 | On a random kill both arms look similar, because farthest-point order interleaves priorities in space | reasoning from [contracts §6](../design/contracts-and-algorithms.md#6-composition-from-recipe-to-slots) | unverified | Show the regional kill; report the random kill honestly as "little difference" |

## 2. Assumptions

AS-01 to AS-04 are the assumptions the contract calls A1–A4. Limits that follow from the algorithm itself (not from the model) are in [contracts §8.5](../design/contracts-and-algorithms.md#85-known-limits-state-these-dont-hide-them).

| ID | Assumption | Why we make it | Risk if a judge challenges it | How we word it |
|---|---|---|---|---|
| AS-01 | Synced clock: every drone reads the same `tick` | A timed score needs a shared time base; there is no time to model drift | "That is a central clock" | "Drones share a time reference, as satellite time would give them. Drift is not modelled" |
| AS-02 | Ideal anonymous sensing: exact relative position and velocity of every live drone within `rSense`; no noise, no occlusion, no ids | A vacancy must rest on physical evidence, not on radio silence | With noise, only `tVacant` and `rOcc` guard against false vacancies | "Idealised short-range sensing. A drone never learns who it sees" |
| AS-03 | Disc radio: delivery within `rRadio`, uniform latency, independent `loss`; jam is a sphere, partition is a plane | Simple, deterministic, enough to show loss, jam and partition | Real links fade and fail in bursts; results do not transfer to hardware | "A disc radio model with configurable loss, jams and partitions" |
| AS-04 | Collisions have no physical effect: pairs closer than `dCollide` are counted, nothing breaks | Keeps the kill set identical in both arms | "Your drones fly through each other" | "We count collisions and near-misses and report them. We make no safety claim" |
| AS-05 | Killed drones leave the airspace at the kill tick | A dark hovering drone cannot be told from a live jammed one by sensing | A stuck drone is never replaced and becomes an obstacle | "We model drones that drop out, not ones that fail in place" |
| AS-06 | Honest drones: every message is trusted, any drone accepts an uplink | No time for a security model | One forged `SCORE` with a late `issuedTick` redirects the swarm | "No security model; agents are assumed honest" |
| AS-07 | One process: drones are logically separate actors, isolated by rules I1–I8 | A real network adds risk and no demo value | "This is not a distributed system" | "Logically autonomous agents in one simulation. Nothing runs on drones" |
| AS-08 | Preloaded data (`n0`, own id, launch slot, first score, parameters) is not live state (I4) | Any drone could carry it before take-off | "The roster is central" | "No central controller during the show; the score and roster are authored and loaded beforehand" |
| AS-09 | Slot order equals visual importance | Farthest-point order makes any prefix an even thinning | A thinned word may look worse than a holed one | "Priority is a geometric rule, not a perception study" |
| AS-10 | Failures come in bursts during a hold and then stop | The settling argument and `canHeal` both need it | Kills during a transition are noticed late; continuous churn is untested | "Repair is tested for failures during a hold" |

## 3. Open questions

Roles are defined in [TEAM_ROLES](../development/TEAM_ROLES.md).

| ID | Question | Owner role | Needed by |
|---|---|---|---|
| OQ-01 | Exact Neptune North brief wording and how it is judged (EV-08) | Product / Research | before the pitch is written |
| OQ-02 | Theme wording, and whether it is a judging criterion (EV-06) | Product / Research | before the pitch is written |
| OQ-03 | Judging time, format, pitch length; is a video required on Devpost (EV-05) | Product / Research | Sun 08:30 |
| OQ-04 | Does the research packet contradict this register or the [requirements](../specification/requirements.md)? | Architect / Integrator | when the packet is pasted |
| OQ-05 | Do the default parameters pass G1, or do timers and `claimGap` need retuning at small `n0`? (EV-15) | Architect / Integrator | G1, Sat 23:30 |
| OQ-06 | Does each formation still read well with 80–90% of its slots filled? (AS-09) | Product / Research | G2, Sun 00:30 |
| OQ-07 | Team TypeScript and Three.js experience, and laptop frame rate at the default `n0` ([feasibility](../analysis/feasibility-and-scope.md)) | Systems / Validation | G2, Sun 00:30 |
