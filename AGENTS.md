# AGENTS.md — Operating protocol for AI coding agents

This is the **single canonical protocol** for every AI agent (Claude Code, Codex, Cursor, etc.) working in this repo. `CLAUDE.md` points here. Humans should read it too.

Agents do **not** share memory, sessions or filesystems. The only shared state is **GitHub**: issues, PRs, and files committed to `main`. If it isn't in GitHub, other agents can't see it.

## 0. Ground rules

- Work only on **one GitHub issue** at a time, assigned to your human. No issue → ask your human to create one (`.github/ISSUE_TEMPLATE/`).
- **Never commit to `main` directly.** Branch → PR → merge.
- **Stay in scope.** Out-of-scope findings become a comment on the issue or a new issue, not drive-by edits.
- **Do not change shared contracts** (`docs/architecture/INTERFACES.md`, once it exists, or any file marked `CONTRACT`) without a PR that says so in the title (`[contract]`) and an ack from the owner of each affected component.
- **Never commit secrets.** Use `.env` (gitignored); document variable *names* in `.env.example`.
- **The idea is not decided until `docs/ideation/SELECTION_DECISION.md` says so.** Before then, only research, docs, and clearly-labelled throwaway spikes under `research/experiments/`.
- Do not make product decisions, spend money, change repo permissions, or force-push. Ask your human.
- Report honestly: say what was tested and what wasn't.

## 1. On starting work

1. Read, in order: this file → `docs/CURRENT_STATE.md` → your issue (`gh issue view <N> --comments`) → any docs the issue links.
2. Check the issue isn't already claimed: it should be assigned to your human, with no other open PR linked (`gh pr list --search "<N>"`).
3. Claim it: `gh issue edit <N> --add-label status:in-progress` and comment `Started by <human>'s agent on branch <branch>`.
4. Create an isolated branch (or worktree, see §4): `<type>/<issue#>-<slug>`, e.g. `feat/24-audio-engine`.
5. Read the existing code you'll touch. Don't guess at structure.
6. Pick the smallest change that meets the acceptance criteria.

## 2. While working

- Commit small and often, with messages that reference the issue (`#24`).
- Pull/rebase from `main` at least every ~2 hours, and always before opening a PR: `git fetch && git rebase origin/main`.
- If you need to edit a file that another open PR is changing (`gh pr list` → check files), **stop and comment on both PRs/issues** before touching it.
- Add a test or a runnable check with each piece of behaviour where practical (see `docs/quality/TEST_STRATEGY.md`).
- Pin dependency versions explicitly.
- Blocked? Comment on the issue with `Blocked: <reason>`, add label `status:blocked`, tell your human.
- Record significant decisions as a line in `docs/DECISIONS.md` (or an ADR in `docs/architecture/adr/` if it affects other components).

## 3. On completion

1. Run every check that exists (`scripts/check.sh` once a stack exists; `python scripts/check_links.py` always).
2. Review your own diff (`git diff origin/main...`) for accidental changes, debug code, secrets, large binaries.
3. Update docs you made stale. Update `docs/CURRENT_STATE.md` **only** for state changes others need to know (new component works, interface changed, blocker).
4. Open a PR using the template: `gh pr create --fill` then edit, or `gh pr create --title "..." --body-file ...`. Body must contain `Closes #<N>`.
5. Post the handoff (below) as the last section of the PR body. Set the issue label to `status:in-review`.

### Handoff format (paste into the PR, or as an issue comment if stopping mid-task)

```text
Issue:            #N
Branch:           type/N-slug
PR:               #M (or "not opened")
Owner:            <human>
Objective:        <one line>
Completed:        <bullets>
Files changed:    <key paths>
Tests run:        <commands>
Results:          <pass/fail, honestly>
Interfaces affected: <none | which contract and how>
Outstanding risks:   <bullets>
Dependencies:     <issues/PRs this needs or unblocks>
Next action:      <the very next concrete step>
```

## 4. Parallel agents on one machine: worktrees

If a human runs more than one agent, give each its own worktree so they never share a working directory:

```bash
git worktree add ../Pihh-wt/<issue#>-<slug> -b <type>/<issue#>-<slug> origin/main
cd ../Pihh-wt/<issue#>-<slug>
# ...work, commit, push, PR...
# after merge:
git worktree remove ../Pihh-wt/<issue#>-<slug> && git branch -d <type>/<issue#>-<slug>
```

Naming: `../Pihh-wt/<issue#>-<slug>` (sibling of the main clone, never inside it). Prune with `git worktree prune`.

## 5. Ownership lanes (provisional)

See `docs/development/TEAM_ROLES.md`. In short: Arnav = architecture/integration, Haris = research/product/demo, Williams = core systems/reliability. Lanes guide who picks what; they don't restrict anyone.

## 6. Where things live

`docs/INDEX.md` is the map. Don't create new top-level docs without adding them to the index. Don't duplicate facts: link to the one place they live.
