# Submission checklist

Owner: Arnav, reassigned from Haris at 21:45 Sat ([#8](https://github.com/durhacko/Pihh/issues/8)). **Hard deadline: Sun 15 Nov 11:00 GMT on Devpost** ([BRIEF S3](../competition/BRIEF.md#1-schedule-gmt)). Target: a minimal submission in by **10:15** (gate G6), then improve it until 10:50.

Ticked means true on `main`. Unticked items say what is missing. The paste-ready Devpost text and its placeholder legend are in [DEVPOST.md](DEVPOST.md).

## Only a human can do these

An agent can't log in to Devpost, change repo visibility, record the screen or present. These need a team member.

| # | Action | Who | By |
|---|---|---|---|
| H1 | Log in to Devpost, open the DurHack 2026 form, note its required fields (is a video required? It probably asks for guild, room and table row and column: [R8](../competition/BRIEF.md#4-submission-and-rules)) and save a draft | Arnav | 08:00 |
| H2 | Invite Haris and William Pimentel to the Devpost project; each accepts | Arnav, then each member | 08:00 |
| H3 | Decide which prize tracks to tick: Neptune North and any others ([R6](../competition/BRIEF.md#4-submission-and-rules)) | Team | 08:00 |
| H4 | Capture the Neptune North brief and the theme wording at the venue (opening slides, sponsor booth, Discord) and add them to [BRIEF](../competition/BRIEF.md) §7 | Any team member | ASAP |
| H5 | Make `durhacko/Pihh` **public**, or give the judges access. This is an org admin setting | Arnav | 10:00 |
| H6 | Run the demo from a fresh clone on a second laptop, following the README | Haris or Williams | 08:30 |
| H7 | Take 3–5 screenshots from the rehearsed build and save them in `assets/` | Any team member | 09:00 |
| H8 | Record the backup video (at most 2 minutes), upload it, and copy the file to two laptops; play it offline on both | Any team member | 09:00 |
| H9 | Fill the `[HUMAN: …]` placeholders in [DEVPOST.md](DEVPOST.md) and the README, including any hand-written code in "AI use" | Arnav | 10:00 |
| H10 | Paste the text into Devpost, attach links and images, and press **Submit** (not draft). Screenshot the confirmation | Arnav | 10:15 |
| H11 | Run three full rehearsals, each by a different person, and record them in the [demo plan](DEMO_PLAN.md#rehearsal-record--none-completed) | Team | 09:00 |
| H12 | Present at judging | Team | After 11:00 |
| H13 | Supply Haris's surname for the README team line, and have William and Haris confirm the Codex credit | Haris, William | 10:00 |

## Before 08:00 Sun
- [ ] Devpost form fields checked and a draft saved (H1)
- [ ] All three team members joined the Devpost project (H2)
- [ ] Sponsor tracks decided (H3)

## README (rules R2–R4)
- [x] What it is, how the reported theme Composition fits, and that it is a simulation with no hardware
- [x] A 30-second run path for judges (`npm ci`, then `npm run build`, then `npm run preview`)
- [ ] Run path verified on a fresh clone by a second person (H6). An agent check passed on a fresh WSL clone at `9f78902` (15 Nov, about 00:00), with networking off for the preview ([log in #8](https://github.com/durhacko/Pihh/issues/8#issuecomment-6886715532)). The human run on the demo laptop is still needed.
- [x] **"Built with"**: every public library at its exact pinned version, plus Node.js, Python and the GitHub Actions used in CI ([R3](../competition/BRIEF.md#4-submission-and-rules))
- [x] **"AI use"**: Claude Code, OpenAI Codex and GitHub Copilot, with what each was used for ([R4](../competition/BRIEF.md#4-submission-and-rules))
- [ ] "AI use" confirmed by a human, including any hand-written code (H9)
- [x] Team members named (Haris's surname still to add: H13)
- [x] "Where Encore ties or loses" section with the pre-registered cases
- [ ] Results filled in from `results/RESULTS.md`. S0–S3 are filled from the evaluation run (#122). S5 waits for #123.
- [ ] Status box and `[IF G1]` / `[IF G4]` lines resolved at feature freeze (08:30)

## Repo
- [ ] Repo made **public**, or judges given access (H5)
- [x] No secrets in history. Checked on `main` at `bcccf2f` (14 Nov, ~23:00): `git log -p | grep -iE "api[_-]?key|secret|token"` gives 16 added lines, all prose or code identifiers, and no `.env`, key or credential file is tracked. Re-run before tagging.
- [ ] Final commit tagged `submission`

## Media
- [ ] Screenshots in `assets/` (H7). The harness captures the states (`node scripts/perf/run.mjs --shots`, [QA.md](QA.md)); a person picks which to use.
- [ ] Demo video (at most 2 min) uploaded and linked, if required or useful (H8)
- [ ] Backup video available offline on two laptops (H8)

## Devpost
- [x] Text drafted: title, tagline, Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next, Built with ([DEVPOST.md](DEVPOST.md))
- [ ] Every `[RESULT: …]`, `[IF …]` and `[HUMAN: …]` placeholder resolved (H9)
- [ ] Repo link, video link and images added (H5, H7, H8)
- [ ] Prize tracks selected (H3)
- [ ] **Submitted** (not draft) before 11:00, with a screenshot of the confirmation (H10)
