# Idea evaluation framework

Purpose: pick the idea quickly and defensibly. Scores live in [`CANDIDATE_COMPARISON.md`](CANDIDATE_COMPARISON.md). The decision is recorded in [`SELECTION_DECISION.md`](SELECTION_DECISION.md).

## Step 1: Hard gates (pass/fail, applied before scoring)

A candidate that fails any gate **cannot be selected**, whatever its score.

1. **Access gate:** every *required* piece of hardware, API, dataset or credential is confirmed in hand today, or the MVP runs fully on a sim/mock.
2. **Time gate:** a stubbed end-to-end slice (M2) is plausible within about 4 hours of selection, and the MVP is stable by about 04:00 Sun, leaving polish time before the **11:00 Sun deadline** ([BRIEF S3](../competition/BRIEF.md#1-schedule-gmt)).
3. **Rules gate:** no conflict with [BRIEF §4](../competition/BRIEF.md#4-submission-and-rules) (e.g. nothing built before the event).

## Step 2: Weighted score (1–5 per criterion)

The weights were **adjusted from the handoff's starting weights** to cover the official judging criteria ([BRIEF J1](../competition/BRIEF.md#3-judging)): Creativity, Polish/Completion, Technical, Research/Learning.

| # | Criterion | Weight | Official criterion | 5 looks like | 1 looks like |
|---|---|---:|---|---|---|
| 1 | Composition is intrinsic | 15% | Theme ([T1](../competition/BRIEF.md#2-theme), unverified) | Remove "composition" and the project stops existing | Theme is a label |
| 2 | Demo clarity and impact | 15% | (expo judging) | A judge gets it in 10 seconds and wants to touch it | Needs slides |
| 3 | Creativity and originality | 15% | Creativity/Innovation | No close prior art, or a sharp twist | Tutorial project |
| 4 | Technical depth shown | 15% | Technical Competence | Visible non-trivial algorithm or system | CRUD wrapper |
| 5 | Polish achievable by deadline | 15% | Polish/Completion | Small core, lots of time left to polish | Core done only at the deadline |
| 6 | Sponsor fit (**verified briefs only**) | 10% | Side prizes | Squarely meets a verified brief | No plausible track |
| 7 | Feasibility and robustness | 10% | — | Known tech, offline fallback | Research problem, single point of failure |
| 8 | Research/learning story | 5% | Research/Learning | Clear "we learned/measured X" | Nothing to say |

**Weighted total = Σ(score × weight)**, max 5.0.

- If the theme turns out **not** to be judged, move criterion 1's weight to criteria 2 and 3, and log the change in [`../DECISIONS.md`](../DECISIONS.md).
- Re-score criterion 6 once sponsor briefs are captured. Until then it's capped at 3 because no brief is verified.

## Step 3: Confidence and dissent

- Each score carries a confidence: **H** (evidence or a spike), **M** (informed judgement), **L** (guess).
- Each human scores independently first (5 minutes, no discussion), then compare. Where scores differ by 2 or more, discuss for 2 minutes and record any lasting disagreement in the dissent column.
- A margin under 0.3 between the top two is a tie. Break ties on demo impact, then on access and robustness, not on false precision.

## Step 4: Decision meeting (timeboxed to 20 minutes)

1. Read the shortlist (top 3 after gates), 2 minutes.
2. Independent scoring, 5 minutes.
3. Discuss gaps and counterarguments, 8 minutes.
4. Decide (consensus, else majority), 2 minutes.
5. Record in `SELECTION_DECISION.md` and close the decision issue, 3 minutes.
