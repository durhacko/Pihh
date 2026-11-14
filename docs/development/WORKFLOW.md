# Development workflow

Purpose: how work moves from idea to `main` for three humans plus their AI agents. Agent-specific rules are in [`AGENTS.md`](../../AGENTS.md).

## The loop

1. **Pick** an issue from the board (Issues filtered by milestone + `P0` first). It must have exactly one assignee (the human accountable).
2. **Check dependencies**: the issue's "Depends on" list must be closed or explicitly mocked.
3. **Claim**: add `status:in-progress`, comment with your branch name.
4. **Branch** from fresh `main`: `<type>/<issue#>-<slug>`.
5. **Build** the scope, nothing more.
6. **Check**: run the checks that exist.
7. **PR** with the template, `Closes #N`, handoff at the bottom. Label the issue `status:in-review`.
8. **Review**: any one other human skims the diff (≤10 min). Agents can pre-review, but a human clicks merge.
9. **Merge**: squash-merge into `main`. Delete the branch.
10. **Update**: the issue auto-closes. If state changed, edit `docs/CURRENT_STATE.md` in the same PR.

Target PR size is under about 400 changed lines and under about 3 hours of work. Integrate small and often. A branch older than 4 hours is a risk.

## Branch names

| Prefix | Use |
|---|---|
| `feat/` | new behaviour |
| `fix/` | bug fix |
| `research/` | idea research, candidate write-ups |
| `spike/` | throwaway feasibility experiments (`research/experiments/`) |
| `docs/` | documentation only |
| `test/` | tests or demo harness |
| `chore/` | tooling, CI, deps |

Example: `feat/24-audio-engine`, `research/3-candidate-feasibility`.

## Branching strategy

- `main` = **known-good, demoable**. Nothing merges that breaks the demo path.
- Short-lived feature branches only. No `develop` branch, no release branches.
- Tag demo milestones: `git tag m2-first-e2e && git push --tags`.
- **Branch protection is not available** (private repo on a free org plan, API returns 403). So the "PR only, no direct pushes to `main`" rule is enforced by convention. Exception: a 1-line hotfix during the final hour, announced in chat first.

## Review rules (fast)

- Reviewer checks: does it do what the issue says, does `main` still run, are there secrets, are any contracts changed?
- If a review takes more than 15 minutes to arrive, the author pings the team. If 30 minutes pass with no review and checks are green, the author may self-merge **non-contract** PRs and note it in the PR.
- PRs titled `[contract]` need an approving comment from each affected component owner.

## Merge conflicts and disputes

1. **Prevent**: one issue = one owner; issues list the files/dirs they expect to touch; check `gh pr list` before editing shared files.
2. **Resolve**: the author of the *later* PR rebases and resolves. If the conflict involves someone else's logic, pair for 5 minutes (call or chat) rather than guessing.
3. **Contract disagreements**: Arnav (integration lead) makes the call within 15 minutes, recorded in `docs/DECISIONS.md`.
4. **Product/scope disagreements**: 5-minute discussion. If there's no consensus, use the evaluation framework, then a majority vote. Record it in `docs/DECISIONS.md`.

## Integration (post-selection)

- **First goal at M2 is a thin end-to-end slice**: minimal input → core behaviour → visible output, even if every part is stubbed.
- Every component ships with a **mock/simulated mode** for any hardware or external API, so the demo never depends on one live dependency.
- Integrate into the running app **before** polishing any component.
- Keep a **known-good demo path** documented in `docs/demo/DEMO_PLAN.md` and re-run it after every merge to `main` once M2 is reached.

## Launching your agent on an issue

From your clone (or a worktree, see `AGENTS.md` §4):

```bash
git checkout main && git pull
claude    # or your agent of choice
```

Then paste:

> You are working on durhacko/Pihh issue #<N> for <your name>. Follow AGENTS.md exactly: read AGENTS.md, docs/CURRENT_STATE.md and `gh issue view <N> --comments`, claim the issue, create branch `<type>/<N>-<slug>`, implement only the acceptance criteria, run checks, open a PR with `Closes #<N>` and the handoff block. Ask me before any product decision, contract change, or anything outside scope.
