# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md) first and follow it.** It is the canonical protocol for all AI agents in this repo. This file only adds Claude Code specifics.

Then read [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) and your assigned issue (`gh issue view <N> --comments`).

## Claude Code specifics

- Use `gh` for all GitHub interaction (issues, PRs, labels). Repo: `durhacko/Pihh`.
- For parallel sessions on one machine, use a git worktree per issue (`AGENTS.md` §4), or Claude Code's worktree isolation.
- Keep `CURRENT_STATE.md` short. It is a snapshot, not a log.
- Before the idea is selected, don't scaffold a language, framework or CI for a stack. That happens in the M1 issues.
- Stack-specific commands (install, run, test) will be added here **after** the stack is chosen.

## Commands

```bash
python scripts/check_links.py      # validate internal Markdown links (CI runs this too)
gh issue list --assignee @me       # your work
gh issue view <N> --comments       # issue context
```
