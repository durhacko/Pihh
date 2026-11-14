# AGENTS.md — Operating protocol for AI coding agents

This is the **single canonical protocol** for every AI agent (Claude Code, Codex, Cursor, etc.) on every laptop. `CLAUDE.md` points here. Humans should read it too.

Agents do **not** share memory, sessions or filesystems. The only shared state is **GitHub**: issues, PRs, and files on `main`. A message in an AI chat window is not project state. If it isn't in GitHub, it didn't happen.

**Project:** Encore, a 3D simulation of a decentralised drone light show. Read [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) for where things stand and [`docs/INDEX.md`](docs/INDEX.md) for the map.

## 0. Ground rules

- Work on **one GitHub issue** at a time, assigned to your human. No issue → ask your human to create one.
- **Never commit to `main` directly.** Branch → PR → merge.
- **Stay inside the issue's "Allowed files".** Anything else becomes a comment or a new issue, not a drive-by edit.
- **Never commit secrets.** There should be none: Encore runs fully offline.
- **Software only.** No hardware, no network calls and no external services, in code, tests or the demo ([NFR-10](docs/specification/requirements.md)). Everything about a drone is simulated.
- Do not make product decisions, change repo settings, or force-push. Ask your human.
- Report honestly: say what was tested and what wasn't. Never fake a result in the renderer or in metrics.

### The three Encore rules (break one and the project's claim is false)

1. **Agent isolation.** Code under `src/agent/` (the Encore brain and the static baseline brain) may import only from `src/contracts/` and `src/score/`. A drone's decision function receives only its `AgentInput` and returns an `AgentOutput`. It never sees the world, another drone's state, or ground truth. See [contracts §1](docs/design/contracts-and-algorithms.md).
2. **The observer never decides.** `src/observer/` and `src/app/` may read everything, but may change the simulation only by scheduling **environment events** (kill, jam, partition, inject a score into one drone, pause). They never set a drone's slot, target or belief.
3. **Nothing is invented on screen.** Every message spark, belief colour and metric comes from a real simulation event or state.

### Shared contracts

`src/contracts/**` and [`docs/design/contracts-and-algorithms.md`](docs/design/contracts-and-algorithms.md) are **CONTRACT** files, owned by Arnav. To change one:

1. Open an issue or PR titled `[contract] …` saying what changes and which work packages it affects.
2. The contract owner approves. The PR updates the doc and the types together.
3. After merge, the owner comments on every open issue that depends on it. **Before each work session and before opening a PR, run `git log --oneline -5 origin/main -- src/contracts docs/design/contracts-and-algorithms.md`** to see whether a contract changed under you.

Need something the contract doesn't give you? Don't work around it locally. Ask via a `[contract]` issue and build against a fixture meanwhile.

## 1. Task states (how GitHub shows who has what)

| State | How it looks on GitHub |
|---|---|
| BACKLOG | Open issue, label `status:blocked` (a dependency isn't merged yet) |
| READY | Open issue, no status label. Assigned = reserved for that human for 15 minutes after it becomes READY; after that, or if unassigned, anyone may claim |
| CLAIMED / IN_PROGRESS | Assignee set **and** label `status:in-progress`, with a claim comment naming the branch |
| BLOCKED | Label `status:blocked` plus a comment saying on what |
| IN_REVIEW | PR open with `Closes #N`; label `status:in-review` |
| MERGED | Issue closed by the merged PR |
| VERIFIED | Closed issue with label `status:verified`: the integrator ran the checks and the demo path on `main` afterwards |

**Claim before you work**, so two laptops never build the same thing:

```bash
gh issue edit <N> --add-assignee @me --add-label status:in-progress
gh issue comment <N> --body "STATUS: CLAIMED by <human>'s agent. BRANCH: <type>/<N>-<slug>"
```

**Release rule** (this is what "a lane with nobody active" means): a READY issue that its assignee has not claimed within 15 minutes of becoming READY is free to anyone. An issue that is `status:in-progress` with no commit, PR or comment for 30 minutes is free to anyone. Say so on the issue when you take it.

## 2. On starting work

1. `git checkout main && git pull`.
2. Read, in order: this file → `docs/CURRENT_STATE.md` → your issue (`gh issue view <N> --comments`) → the docs the issue links (always the contracts doc).
3. Check the issue's dependencies are closed, or that it says which fixture to build against.
4. Claim it (§1) and create the branch: `<type>/<issue#>-<slug>`, e.g. `feat/14-radio-medium`. Use a worktree if you run several agents on one machine (§5).
5. Read the code you'll touch. Pick the smallest change that meets the acceptance criteria.

## 3. While working

- Commit small and often, referencing the issue (`#14`).
- Rebase on `main` at least every 90 minutes and before opening a PR: `git fetch && git rebase origin/main`.
- Write the tests the issue lists. Keep `main` buildable: a PR that fails `scripts/check.sh` doesn't merge.
- Blocked? Comment on the issue using the handoff format, add `status:blocked`, tell your human.
- A design decision that others must know goes in [`docs/planning/decisions-and-risks.md`](docs/planning/decisions-and-risks.md), in the same PR.

## 4. On completion

1. Run `scripts/check.sh` (typecheck, lint, tests, build) and `python scripts/check_links.py`.
2. Review your own diff (`git diff origin/main...`) for stray files and anything outside your allowed files.
3. Open a PR with the template. The body must contain `Closes #<N>`, the requirement IDs it covers, and the handoff block. Set the issue to `status:in-review`.
4. A human other than the author reviews and merges (rules in [`docs/development/WORKFLOW.md`](docs/development/WORKFLOW.md)).
5. Update `docs/CURRENT_STATE.md` in the same PR **only** if team-visible state changed (a gate passed, a contract changed, a new blocker).

### Handoff format (PR body, and any issue comment that reports status)

```text
STATUS:           CLAIMED | IN_PROGRESS | BLOCKED | IN_REVIEW | DONE
ISSUE:            #N
OWNER:            <human>
BRANCH/PR:        type/N-slug, PR #M (or "not opened")
COMPLETED:        <bullets>
BLOCKERS:         <none | what, and who can unblock>
CONTRACT CHANGES: <none | which type/message and how>
TEST EVIDENCE:    <commands run and results, honestly>
NEXT ACTION:      <the very next concrete step, for whoever picks this up>
```

If your session is about to end mid-task, push your branch and post this block on the issue. That is what makes the work recoverable by another agent.

## 5. Several agents on one machine: worktrees

```bash
git worktree add ../Pihh-wt/<issue#>-<slug> -b <type>/<issue#>-<slug> origin/main
cd ../Pihh-wt/<issue#>-<slug>
# ...work, commit, push, PR...
git worktree remove ../Pihh-wt/<issue#>-<slug> && git branch -d <type>/<issue#>-<slug>   # after merge
```

Worktrees live beside the main clone (`../Pihh-wt/`), never inside it.

## 6. Where things live

`docs/INDEX.md` is the map. Don't add a doc without adding it to the index. Don't restate facts that live elsewhere: link to them.
