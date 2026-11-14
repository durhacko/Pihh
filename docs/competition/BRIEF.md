# DurHack 2026: Competition brief

Purpose: the single source of truth for event facts. Other docs link here instead of restating them.
Researched 2026-11-14 ~15:00 GMT by a research agent. **Status key:** ✅ verified for 2026 · 🕘 previous year (2025), not verified for 2026 · ❓ unverified or inferred · ❌ not found online.

> **Highest-value gap:** sponsor challenge briefs and the "Composition" theme wording are **not published online**. Someone must capture them in person (opening-ceremony slides, sponsor booths, Discord) and add them here. Tracked as a P0 issue.

## 1. Schedule (GMT)

| ID | Fact | Status | Source |
|---|---|---|---|
| S1 | Check-in 09:30–10:30 Sat 14 Nov; event ends 17:30 Sun 15 Nov | ✅ | https://api.durhack.com/meta/event-timings |
| S2 | Devpost submissions open Sat 14 Nov 12:00 | ✅ | https://durhack-26.devpost.com/details/dates |
| **S3** | **Submission deadline: Sun 15 Nov 11:00 GMT** | ✅ | same |
| S4 | Winners announced Sun 15 Nov 17:00 | ✅ | same |
| S5 | Hacking started around 12:00 Sat (24h event) | ❓ | inferred from S2 and the FAQ |
| S6 | Judging/expo time, format and pitch length | ❌ | must fall between 11:00 and 17:00 Sun. The detailed schedule is only on Instagram (instagram.com/durhackevent) |

Note: the MLH listing shows 14:30Z–23:00Z, which conflicts with the above. Treat it as a listing error.

## 2. Theme

| ID | Fact | Status | Source |
|---|---|---|---|
| T1 | Theme is **"Composition"** | ❓ | Team handoff. It does not appear on Devpost, durhack.com or the site repo. **Confirm the wording and how it is judged** (is it a judging criterion, a prize, or flavour?) |
| T2 | Devpost tags: Beginner Friendly / Open Ended / Social Good | ✅ | Devpost overview |
| T3 | Venue "Guilds": Skyline, Plaza, Metro (city art), "DurHack Dino" mascot | ✅ | durhack.com |

## 3. Judging

| ID | Fact | Status | Source |
|---|---|---|---|
| **J1** | **Criteria: Creativity/Innovation · Polish/Completion · Technical Competence/Execution · Research/Learning** | ✅ | Devpost overview |
| J2 | FAQ wording: "creativity, technical accomplishments, polish and usefulness" | ✅ | github.com/ducompsoc/durhack `client/src/config/faqs.tsx` |
| J3 | Judging is in person; judges are "DurHack Selected Judges" | ✅ | https://durhack-26.devpost.com/rules |
| J4 | Probably expo-style pairwise ranking (org runs a fork of the "Jury" app) | ❓ | github.com/ducompsoc/durhack-jury |

**Implication:** prepare a 60–90 second table pitch that hits all four J1 criteria, and a live demo a judge can touch.

## 4. Submission and rules

| ID | Fact | Status | Source |
|---|---|---|---|
| R1 | Submit on Devpost (in-person ticket holders, 18+, students) | ✅ | /rules |
| R2 | Code submission not mandatory, but **a GitHub link is preferred**. Repo is currently private and must be made public, or access granted, before submitting. | ✅ | /rules |
| R3 | **Public frameworks/libraries must be listed in the README** | ✅ | /rules |
| R4 | **AI/LLM use allowed but must be "credited explicitly"** (applies to our coding agents too) | ✅ | /rules |
| R5 | **No work on the project before the event** | ✅ | /rules |
| R6 | Teams of up to 4. Multiple challenges per project allowed. Multiple projects per team "not recommended". No cross-posting to other hackathons. | ✅ | /rules, FAQ |
| R7 | MLH Code of Conduct applies; IP stays with the team | ✅ | FAQ, Devpost |
| R8 | Video or specific Devpost form fields | ❌ | not stated; check the Devpost form early |

## 5. Prize tracks

Devpost lists titles and prizes only. **No challenge briefs, eligibility or required tech are published (❌ for all sponsor briefs).**

| ID | Track | Prize | Status | Notes |
|---|---|---|---|---|
| P1 | DurHack 1st / 2nd | Monitors, keyboards, £100 cards / receipt-printer cameras | ✅ | Overall |
| P2 | Spirit of the Dino | Dino set, keyrings | ✅ | |
| P3 | Marshall Wace (two listings, both "Challenge 2") | MW stash + Meta Quest 3 / TBC | ✅ title | Brief ❌. Platinum sponsor. |
| P4 | SGX FX "Protect Your Assets" (Ch 1), "Get Creative" (Ch 2) | TBC | ✅ title | "SGX" lead **verified as SGX FX**. Brief ❌. Likely linked to Platinum sponsor bidfx ❓ |
| P5 | P&G Challenge 1 and 2 | TBC | ✅ title | Brief ❌ |
| P6 | Accenture | Keyboard, Sony headphones, bag | ✅ | Brief ❌ |
| P7 | **Neptune North** | £1000 team voucher + keyboards | ✅ | Brief ❌. 2025: "Anticipate macroeconomic data" with alternative high-frequency data 🕘 |
| P8 | **QRT** | TBC | ✅ title | Brief ❌. 2025: security/AWS CTF and a carbon/fairness location optimiser, £500 per person 🕘 |
| P9 | **RS** | TBC | ✅ title | Brief ❌. **Arduino UNO Q link ❓**: RS distributes the UNO Q but no source ties it to DurHack |
| P10 | Waterstons | Pi Pico + Inventors Kit | ✅ | Brief ❌ |
| P11 | MLH: Gemini API, ElevenLabs, Entire, Solana, Tiger Data, Vultr, MongoDB Atlas, DEV writing | Various | ✅ | https://mlh.io/events/durhack-2026/prizes. Cheap to add if the stack fits (e.g. Gemini, ElevenLabs, MongoDB). |

Sponsor tiers ✅ (durhack.com): Platinum: Marshall Wace, QRT, bidfx · Gold: Accenture, RS Group, Neptune North, Waterstons · Silver: Newton.

**Observation:** 4–5 of the sponsor tracks are finance or trading firms (MW, QRT, SGX FX/bidfx, Neptune North). Their briefs could heavily change which idea is best. Capture them before deciding.

## 6. Resources

| ID | Fact | Status |
|---|---|---|
| H1 | "Expert mentors, a hardware library, and great APIs" | ✅ Devpost |
| H2 | Hardware loan system exists (org `robotics-inventory` repo); **inventory not published** | ❓ |
| H3 | Vultr cloud credits; MongoDB Atlas $50 student credit | ✅ MLH |

## 7. To capture in person (add here with source "opening ceremony" / "booth, <name>, <time>")

- [ ] Theme wording and whether/how it's judged
- [ ] Each sponsor brief: P3, P4, P5, P6, P7, P8, P9, P10
- [ ] Hardware library inventory (is the UNO Q available? servos? LED strips?)
- [ ] Judging time, format, pitch length
- [ ] Devpost form fields (video required?)
