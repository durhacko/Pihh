# Development workflow and cross-laptop coordination

Purpose: how work moves from an issue to `main` for three humans on three laptops, each driving AI agents. Agent rules are in [`AGENTS.md`](../../AGENTS.md); this file covers the human side, merging and recovery. What to build, and in what order, is in [`../planning/development-plan.md`](../planning/development-plan.md).

## How the laptops coordinate

- **GitHub is the only channel between laptops.** No agent can start, message or control an agent on another laptop. Each human starts their own agent sessions.
- Arnav's session also runs an **orchestrator** that creates issues, keeps labels in sync and spawns local sub-agents. Those sub-agents exist only on Arnav's machine. They work through issues and PRs like everyone else.
- While a session is active, an agent re-checks GitHub at natural stopping points (before starting, before opening a PR, when blocked): `gh issue list --assignee @me`, `gh pr list`, and the contract log command in `AGENTS.md`.

## The loop

1. **Pick** a READY issue (no `status:` label) in your lane, P0 first. Dependencies must be closed, or the issue names a fixture to build against.
2. **Claim** it: assign yourself, add `status:in-progress`, comment with the branch name.
3. **Branch** from fresh `main`: `<type>/<issue#>-<slug>`.
4. **Build** only what the acceptance criteria ask, inside the issue's allowed files.
5. **Check**: `scripts/check.sh` and `python scripts/check_links.py`.
6. **PR** with the template: `Closes #N`, requirement IDs, evidence, handoff block. Label the issue `status:in-review`.
7. **Review and merge** (rules below). Squash-merge, delete the branch.
8. **Verify**: the integrator runs the checks and the demo path on `main` and adds `status:verified`.

Keep PRs under about 400 changed lines and 2 hours of work. A branch older than 3 hours is a risk: split it or merge what works behind a flag.

## Branch names

`feat/` new behaviour · `fix/` bug fix · `docs/` documentation · `test/` tests or harness · `chore/` tooling, CI, deps · `spike/` throwaway experiment under `research/experiments/`.

Example: `feat/14-radio-medium`.

## Branching strategy

- `main` is **always buildable and demoable**. Nothing merges that breaks `scripts/check.sh` or the demo path.
- Short-lived branches only. No `develop`, no stacked PRs more than one deep.
- **Branch protection is not available** (private repo on a free org plan; the API returns 403). "PR-only" is a convention. The manual fallback: nobody pushes to `main`, and CI must be green before merging.
- CODEOWNERS is not used: two of the three GitHub handles are still unconfirmed.

## Who may merge

| PR type | Needs | Who merges |
|---|---|---|
| Normal PR inside one work package | CI green + a skim by any human other than the author | The author, after the skim |
| `[contract]` PR (`src/contracts/**`, contracts doc) | CI green + approval from the contract owner (Arnav) | Arnav |
| Touches `package.json`, build config, CI, or `src/app/main.ts` | CI green + a skim by the owner of that file (see the plan) | The author, after the skim |

Ping the team when the PR opens. After 10 minutes with green CI and no reviewer, the author may self-merge a non-contract PR and note it in the PR. Agents never merge without their human saying so.

## Answers to the coordination questions

| Question | Answer |
|---|---|
| How do I learn an upstream contract changed? | Contract changes only happen in `[contract]` PRs. The owner comments on every dependent open issue after merging. Agents also run the contract log command (`AGENTS.md` §0) before each session and each PR. |
| How do I tell others I'm blocked? | Handoff comment on the issue with `STATUS: BLOCKED`, add `status:blocked`, and @-mention the human who can unblock. |
| Who resolves conflicting implementations? | Inside a work package: its owner. Across packages or on contracts: Arnav, within 15 minutes, recorded in [`decisions-and-risks.md`](../planning/decisions-and-risks.md). |
| Who may merge? | See the table above. |
| How is half-finished work handed over? | Push the branch, post the handoff block on the issue, remove `status:in-progress` if you're stopping for good. |
| How are tests and failures reported? | In the PR's "Tests run" section with exact commands. A failure on `main` becomes a `type:bug` issue labelled P0 if it breaks the demo path. |
| What if the orchestrator is unavailable? | Nothing depends on it. Issues, labels and docs carry the state; humans create issues from the templates and keep going. Williams is backup integrator if Arnav is unreachable for 30 minutes. |
| How is the final working version protected? | After each verified end-to-end run, the integrator tags `demo-good-<n>` and pushes the tag. Feature freeze is 08:30 Sun: after that only fixes merge. The submission is built from a tag, and the last `demo-good` tag is the fallback. |

## Merge conflicts

1. **Prevent:** each issue lists its allowed files, and work packages own separate directories.
2. **Resolve:** the author of the later PR rebases. If the conflict is in someone else's logic, talk for five minutes instead of guessing.
3. **Revert fast:** if `main` breaks, revert the offending squash commit first and fix on a branch.

## Integration rule

Get the thin end-to-end slice working first (gate G2 in the plan), then widen. A feature isn't done until it runs inside the integrated app in sim mode. Don't polish a component that isn't wired in.

## Starting your agent on an issue (bootstrap prompt)

From your clone (or a worktree, see `AGENTS.md` §5):

```bash
git checkout main && git pull
claude    # or your agent of choice
```

Paste:

> You are a coding agent for <your name> on the Encore project (repo durhacko/Pihh). Follow AGENTS.md exactly. Read AGENTS.md, docs/CURRENT_STATE.md and docs/design/contracts-and-algorithms.md, then run `gh issue view <N> --comments`. Claim issue #<N>, create branch `<type>/<N>-<slug>`, and implement only its acceptance criteria inside its allowed files, with the tests it lists. Never import anything into src/agent except src/contracts and src/score. Run scripts/check.sh, then open a PR with `Closes #<N>` and the handoff block. Ask me before any contract change or anything out of scope. If you're blocked, post a BLOCKED handoff on the issue and stop.

To pick up whatever is next instead of a specific issue, replace the issue number with: "run `gh issue list --assignee @me --state open` and take the highest-priority READY one".
