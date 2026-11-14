# Initial synthesis: bootstrap handoff

```text
Issue:            (bootstrap, no issue)
Branch:           docs/0-bootstrap-coordination
PR:               see git log / PR list ("Bootstrap coordination system")
Owner:            Arnav (agent)
Objective:        Make the repo the team's coordination system and speed up idea selection
Completed:        Repo audit; AGENTS/CLAUDE/CONTRIBUTING; docs tree; source-backed competition brief;
                  7 candidate write-ups + framework + preliminary scores; issue forms, PR template,
                  docs CI; 26 labels; milestones M0–M5; issues #1–#9 assigned
Files changed:    see PR
Tests run:        python scripts/check_links.py
Results:          see PR
Interfaces affected: none (no stack yet)
Outstanding risks:   sponsor briefs + theme unverified online; GitHub handles for Haris/Williams inferred;
                     no branch protection; no Projects board
Dependencies:     #1, #2 → #3 decision → #4, #5 → #6
Next action:      Haris starts #1, Williams starts #2, Arnav prepares and runs #3 at ~16:40
```

## Repository audit (before bootstrap, 2026-11-14 ~15:00)

- `main` @ `ae7c374` "Initialize project scaffold": README, Apache-2.0 LICENSE, empty `docs/ src/ tests/ assets/` (`.gitkeep`). All preserved.
- No issues, PRs, workflows, project boards, or custom labels. Default GitHub labels kept.
- Collaborators: `reverez` (Arnav Chitriv, verified), `wpimento` (profile name William Pimentel → Williams, inferred), `sirahmo` (no profile name → Haris, inferred by elimination).
- Repo is private in the `durhacko` org; the viewer has ADMIN access. Branch protection API: 403 (needs Pro or a public repo). Projects: token lacks the `project` scope.
- Local `refs/agents/*` checkpoint refs exist (from the local agent host). Left untouched.

## Key findings that should change the team's behaviour

1. **Deadline is Sun 11:00 GMT**, not end of day. Aim for a minimal submission at 10:00.
2. **README must list frameworks and explicitly credit AI use**, or we break the rules.
3. **Official judging criteria** are Creativity, Polish/Completion, Technical, and Research/Learning. The evaluation weights were adjusted to match.
4. **Sponsor briefs aren't online.** 4–5 tracks are finance firms. Capture the briefs before deciding (#1).
5. **"Composition" isn't stated anywhere official online.** Confirm it and how it's judged.
