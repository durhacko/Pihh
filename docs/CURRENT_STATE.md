# Current state

> **Canonical snapshot. Keep it short and edit in place; it is not a log.** Last updated: 2026-11-14 ~15:40 GMT by Arnav's agent (bootstrap).

## Phase: **M0, selecting the idea** (no idea selected)

| Key time (GMT) | |
|---|---|
| Now | Sat ~15:40 |
| M0 idea selected | **Sat 17:00** |
| M1 architecture agreed | Sat 18:30 |
| M2 first end-to-end demo | Sat 22:00 |
| M3 stable MVP | Sun 04:00 |
| M4 polish / **feature freeze** | Sun 08:30 |
| M5 minimal Devpost submission | Sun 10:00 |
| **Hard deadline (Devpost)** | **Sun 11:00** ([BRIEF S3](competition/BRIEF.md#1-schedule-gmt)) |
| Winners announced | Sun 17:00 |

Milestone times are proposals set by the bootstrap agent. Change them in GitHub milestones and here.

## Active work (the board = [open issues](https://github.com/durhacko/Pihh/issues), filtered by milestone and P0)

| Issue | Owner | Status |
|---|---|---|
| [#1](https://github.com/durhacko/Pihh/issues/1) Capture theme, sponsor briefs, judging format in person | Haris | **Ready, P0, due 16:15** |
| [#2](https://github.com/durhacko/Pihh/issues/2) Hardware library check + feasibility spike | Williams | **Ready, P0, due 16:30** |
| [#3](https://github.com/durhacko/Pihh/issues/3) DECISION: select the idea | Arnav (facilitator), all | Needs decision, **17:00** |
| [#4](https://github.com/durhacko/Pihh/issues/4) Architecture + contracts + MVP scope | Arnav | Blocked by #3 |
| [#5](https://github.com/durhacko/Pihh/issues/5) Stack scaffold + check.sh + CI | Williams | Blocked by #3 |
| [#6](https://github.com/durhacko/Pihh/issues/6) M2 end-to-end slice | Arnav | Blocked by #4, #5 |
| [#7](https://github.com/durhacko/Pihh/issues/7) Demo plan, pitch, backup video | Haris | Blocked by #3 |
| [#8](https://github.com/durhacko/Pihh/issues/8) Devpost submission | Haris | Later (M5) |
| [#9](https://github.com/durhacko/Pihh/issues/9) Optional Projects board | Arnav | P2 |

## Idea status

7 candidates in [IDEA_BACKLOG](ideation/IDEA_BACKLOG.md). Preliminary (low-confidence) shortlist: **C03 Patchwork, C06 Thirds, C01 Encore / C02 Fugue**. See [CANDIDATE_COMPARISON](ideation/CANDIDATE_COMPARISON.md). The biggest unknown is the **sponsor briefs** (#1).

## Known facts that constrain us

- Deadline Sun 11:00 on Devpost. GitHub link preferred. **Frameworks must be listed and AI use credited explicitly in the README.** No pre-event work. ([BRIEF §4](competition/BRIEF.md#4-submission-and-rules))
- Judging criteria: Creativity, Polish/Completion, Technical, Research/Learning ([J1](competition/BRIEF.md#3-judging)).
- "Composition" theme wording is **unverified online** ([T1](competition/BRIEF.md#2-theme)).

## Blockers / open questions

- GitHub handles inferred, not confirmed: Haris = `sirahmo`, Williams = `wpimento`. Confirm in #3.
- No branch protection (free private org). PR-only is by convention.
- No Projects board (token scope). Issues + labels + milestones are the board (#9).
- Repo is **private**: decide on public vs judge access before submission (#8).

## Stack / interfaces

None yet, by design. Chosen at M1 (#4, #5).
