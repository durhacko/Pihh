# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md) first and follow it.** It is the canonical protocol for all AI agents in this repo. This file only adds Claude Code specifics.

Then read [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md), [`docs/design/contracts-and-algorithms.md`](docs/design/contracts-and-algorithms.md) and your assigned issue (`gh issue view <N> --comments`).

## Claude Code specifics

- Use `gh` for all GitHub interaction. Repo: `durhacko/Pihh`.
- For parallel sessions on one machine, use a git worktree per issue (`AGENTS.md` §5).
- Stack: TypeScript (strict), Vite, Three.js, vitest, Node 20+. The simulation core (`src/contracts`, `src/score`, `src/agent`, `src/sim`, `src/observer`) must not import `three` or touch the DOM.
- `src/agent/**` imports only `src/contracts` and `src/score`. No `Math.random`, `Date` or `performance` there.
- Keep `docs/CURRENT_STATE.md` short. It is a snapshot, not a log.

## Commands

```bash
python scripts/check_links.py      # internal Markdown links (CI runs this)
scripts/check.sh                   # typecheck + lint + tests + build (exists after issue #5)
gh issue list --assignee @me       # your work
gh issue view <N> --comments       # issue context
git log --oneline -5 origin/main -- src/contracts docs/design/contracts-and-algorithms.md   # did a contract change?
```
