# Risk register

Purpose: the practical risks that could stop us from submitting a working demo. Review at each milestone. P = probability, I = impact (H/M/L).

| # | Risk | P | I | Owner | Mitigation | Trigger | Fallback |
|---|---|---|---|---|---|---|---|
| 1 | Idea selection drags on and eats build time | M | H | Arnav | 20-minute timeboxed decision meeting; preliminary scores ready | No decision by 17:00 Sat | Take the top preliminary candidate that passes the gates |
| 2 | Scope too large for about 20 hours | H | H | Arnav | MVP must/should/cut list in `product/MVP_SCOPE.md`; feature freeze 08:30 Sun | M2 not reached by 22:00 Sat | Cut to must-haves; drop all stretch |
| 3 | Sponsor briefs unknown, so we optimise for the wrong track | H | M | Haris | Capture briefs in person now (BRIEF §7) | Briefs still missing at decision time | Decide on the official criteria; treat sponsors as a bonus |
| 4 | "Composition" theme misread, or not actually judged | M | M | Haris | Confirm wording with organisers | — | Re-weight per the framework |
| 5 | Hardware unavailable or broken | M | H | Williams | Hardware is stretch only; sim/mock first | Device not in hand by M1 | Sim mode in the demo |
| 6 | External API/Wi-Fi failure during judging | M | H | Williams | Every external dependency has a mock or offline mode; own hotspot | Flaky at a rehearsal | Offline mode, recorded video |
| 7 | Agents create incompatible interfaces | M | H | Arnav | `INTERFACES.md` contract-first at M1; `[contract]` PR rule | Integration PR fails | Arnav arbitrates within 15 minutes |
| 8 | Lots of parallel work, no integration | M | H | Arnav | E2E slice first (M2); PRs under 4 hours old; rebase every ~2 hours | Components "done" but not wired in | Integration swarm: all three on wiring |
| 9 | Merge conflicts or a broken `main` (no branch protection) | M | M | Arnav | PR-only convention, small PRs, CI link check | `main` doesn't run | Revert the offending squash commit |
| 10 | Demo unreliable live | M | H | Haris | Known-good demo path; rehearse 3 times; scripted start | A rehearsal fails | Backup video plus screenshots |
| 11 | Missing submission assets (README credits, AI credit, video, public repo) | M | H | Haris | `SUBMISSION_CHECKLIST.md` starts at M3 | Not started by 08:00 Sun | Minimal Devpost submitted by 10:00, then improved |
| 12 | Single point of failure (one person holds key knowledge or hardware) | M | M | All | Handoffs in PRs; backup integrator = Williams | Someone unreachable for 30+ minutes | Backup owner takes over from the handoff |
| 13 | Overinvesting in research and docs | M | M | Arnav | Process is already "done enough"; docs updated only when state changes | Docs PRs outnumber feature PRs after M1 | Freeze docs except CURRENT_STATE and demo |
| 14 | Fatigue overnight degrades quality | H | M | All | Staggered sleep (2 people working at any time); no big merges 03:00–06:00 | — | Lock `main` to the demo path |
| 15 | Rules breach: AI not credited, pre-event work | L | H | Haris | README "Built with / AI credit" section; all work dated in git | — | — |
