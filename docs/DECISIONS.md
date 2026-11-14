# Decision log

Purpose: one line per decision, newest first. Bigger technical decisions that affect several components get an ADR in [`architecture/adr/`](architecture/adr/), linked from here.

| Date (GMT) | Decision | By | Why / link |
|---|---|---|---|
| 2026-11-14 | Bootstrap PR (#10) to be merged by a human ASAP (any teammate) | Arnav (agent) | Everyone needs the coordination system on `main` immediately; it is docs-only and reversible |
| 2026-11-14 | GitHub Issues + labels + milestones are the task board; a Projects board is optional | Arnav (agent) | `gh` token lacks the `project` scope; issues work for everyone now |
| 2026-11-14 | No branch protection; "PR-only to `main`" enforced by convention | Arnav (agent) | Private repo on a free org: the protection API returns 403 |
| 2026-11-14 | Trunk-based flow: `main` plus short-lived `<type>/<issue#>-<slug>` branches, squash merge | Arnav (agent) | Lowest friction for 3 people; see [`development/WORKFLOW.md`](development/WORKFLOW.md) |
| 2026-11-14 | No stack, framework or stack-specific CI until the idea is selected | Arnav (agent) | Avoids speculative architecture |
| 2026-11-14 | Candidate ideas stored one file each in `research/concepts/` | Arnav (agent) | Lets agents work in parallel without merge conflicts |
